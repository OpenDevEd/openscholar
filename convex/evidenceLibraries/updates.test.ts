/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import {
  createDeployedSetupFixture,
  createReadySetupFixture,
} from "../../tests/helpers/evidence-library-setup-fixture";
import {
  fetchRuntimeRelease,
  isFreshRuntimeRelease,
  RUNTIME_RELEASE_CACHE_MS,
  runtimeIncludesCommit,
} from "./runtimeReleases";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";

const RUNNING = "a".repeat(40);
const CONTRACT = EVIDENCE_LIBRARY_CONFIG_PROVENANCE.commit;
const LATEST = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;
const IMAGE = `ghcr.io/opendeved/evidence-library-runtime@${DIGEST}`;
const GITHUB = "https://api.github.com";
const GHCR = "https://ghcr.io";
const REPO = "/repos/OpenDevEd/new-el";
// A release body as new-el writes it: summary, notes, then the image line.
const LATEST_NOTES = [
  "Import problems are easier to manage.",
  "",
  "- Sources: Import issues can be dismissed and restored.",
  "- Speed: Search results load faster.",
  "",
  `Image: \`${IMAGE}\``,
  "",
].join("\n");
const LATEST_RELEASE = {
  commit: LATEST,
  summary: "Import problems are easier to manage.",
  notes: [
    "Sources: Import issues can be dismissed and restored.",
    "Speed: Search results load faster.",
  ],
};

const COMMIT_MESSAGES: Record<string, string> = {
  ["c".repeat(40)]:
    "feat(config): add tagline and share image\n\nLonger body text.",
  ["d".repeat(40)]: "  fix: trim whitespace  ",
  [LATEST]: "Dismiss source import issues (#183)",
};

type RecordedRequest = { url: URL; headers: Headers };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The library's own health answer, so the address counts as ours.
const ourHealthAnswer = () =>
  jsonResponse({
    state: "active",
    active: { revision: "r2", schemaVersion: 1 },
    rejected: null,
  });

function createGithub(input: {
  latest: string;
  imageStatus?: number;
  compareStatus?: number;
  releasesStatus?: number;
  addressAnswer?: Response;
  // How GitHub places each runtime against OpenScholar's contract commit:
  // "ahead" reads it, "behind" predates it. The running one reads it unless
  // a test says otherwise.
  contract?: { running?: string | number; latest?: string | number };
  // The commits between the running one and the latest, newest first.
  between?: string[];
  // Releases besides the running and the latest one.
  releases?: { commit: string; publishedAt: string }[];
  // When the running commit was made, read only when it was never released.
  runningCommittedAt?: string;
  // The running commit left the branch at the commit the tests call RUNNING.
  diverged?: boolean;
}) {
  const between = (
    input.between ?? [input.latest, "d".repeat(40), "c".repeat(40)]
  ).map((sha) => ({ sha, commit: { message: COMMIT_MESSAGES[sha] ?? `change ${sha}` } }));
  // What GitHub lists back from the latest commit: it does not stop at the running one.
  const history = [
    ...between,
    { sha: RUNNING, commit: { message: "the running commit" } },
    { sha: "7".repeat(40), commit: { message: "an older commit" } },
  ];
  const requests: RecordedRequest[] = [];
  const addressRequests: URL[] = [];
  const fetchImpl: typeof fetch = vi.fn(
    async (requestInput: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof requestInput === "string"
          ? requestInput
          : requestInput instanceof URL
            ? requestInput.href
            : requestInput.url,
      );
      if (url.pathname === "/api/library-config/health") {
        addressRequests.push(url);
        return input.addressAnswer ?? ourHealthAnswer();
      }
      requests.push({ url, headers: new Headers(init?.headers) });
      if (url.origin === GHCR) {
        if (url.pathname === "/token") {
          return jsonResponse({ token: "registry-bearer" });
        }
        if (
          url.pathname ===
          `/v2/opendeved/evidence-library-runtime/manifests/${input.latest}`
        ) {
          if (input.imageStatus === 404)
            return new Response(null, { status: 404 });
          if (new Headers(init?.headers).get("authorization")) {
            return new Response(null, {
              status: 200,
              headers: { "docker-content-digest": DIGEST },
            });
          }
          return new Response(null, {
            status: 401,
            headers: {
              "www-authenticate":
                'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:opendeved/evidence-library-runtime:pull"',
            },
          });
        }
      }
      if (url.origin !== GITHUB) {
        return jsonResponse({ message: "Unexpected test request" }, 500);
      }
      if (url.pathname === "/user") return jsonResponse({ login: "builder" });
      if (url.pathname === `${REPO}/releases`) {
        if (input.releasesStatus && input.releasesStatus !== 200) {
          return jsonResponse({ message: "Not Found" }, input.releasesStatus);
        }
        // GitHub can put an older release first. Publication dates determine
        // the newest stable runtime, regardless of response order.
        return jsonResponse([
          { tag_name: `runtime-${"9".repeat(40)}`, draft: true, body: "Draft" },
          { tag_name: "v1.0.0", draft: false, body: "Not a runtime release" },
          {
            tag_name: `runtime-${RUNNING}`,
            draft: false,
            published_at: "2026-09-08T10:00:00Z",
            body: "Older notes.\n\n- Records: Older note.\n",
          },
          {
            tag_name: `runtime-${"8".repeat(40)}`,
            prerelease: true,
            published_at: "2026-09-10T10:00:00Z",
            body: "Not ready",
          },
          {
            tag_name: `runtime-${input.latest}`,
            draft: false,
            published_at: "2026-09-09T10:00:00Z",
            body: LATEST_NOTES,
          },
          ...(input.releases ?? []).map(({ commit, publishedAt }) => ({
            tag_name: `runtime-${commit}`,
            draft: false,
            published_at: publishedAt,
            body: `Notes for ${commit}.`,
          })),
        ]);
      }
      if (url.pathname === `${REPO}/commits`) {
        const size = Number(url.searchParams.get("per_page") ?? 30);
        const start = (Number(url.searchParams.get("page") ?? 1) - 1) * size;
        return jsonResponse(history.slice(start, start + size));
      }
      // The first page of a comparison carries every changed file: megabytes
      // once a library is far behind. Only a later page is the comparison alone.
      if (
        url.pathname.startsWith(`${REPO}/compare/`) &&
        Number(url.searchParams.get("page") ?? 1) < 2
      ) {
        return jsonResponse({ files: "x".repeat(3 * 1024 * 1024) });
      }
      // A number is an HTTP failure instead of a placement.
      const placement = (answer: string | number) =>
        typeof answer === "number"
          ? jsonResponse({ message: "Server Error" }, answer)
          : jsonResponse({ status: answer });
      if (url.pathname === `${REPO}/compare/${CONTRACT}...${RUNNING}`) {
        return placement(input.contract?.running ?? "ahead");
      }
      if (url.pathname === `${REPO}/compare/${CONTRACT}...${input.latest}`) {
        return placement(input.contract?.latest ?? "ahead");
      }
      if (url.pathname.endsWith(`...${input.latest}`)) {
        if (input.compareStatus && input.compareStatus !== 200) {
          return jsonResponse({ message: "Not Found" }, input.compareStatus);
        }
        return jsonResponse({
          status: input.diverged ? "diverged" : "ahead",
          ahead_by: between.length,
          // Where the walk back from the latest commit stops.
          merge_base_commit: { sha: RUNNING },
          base_commit: {
            commit: {
              committer: {
                date: input.runningCommittedAt ?? "2026-09-08T09:30:00Z",
              },
            },
          },
        });
      }
      return jsonResponse({ message: "Not Found" }, 404);
    },
  );
  return { addressRequests, fetchImpl, requests };
}

describe("Evidence Library software release lookup", () => {
  it("reports no changes when the library already runs the latest commit", async () => {
    const github = createGithub({ latest: RUNNING });
    await expect(
      fetchRuntimeRelease({
        running: RUNNING,
        token: "github-token",
        fetchImpl: github.fetchImpl,
      }),
    ).resolves.toEqual({
      latest: RUNNING,
      image: IMAGE,
      changes: [],
      releases: [],
    });
    expect(github.requests).toHaveLength(5);
    expect(github.requests[0]?.headers.get("authorization")).toBe(
      "Bearer github-token",
    );
  });

  it("selects the newest stable release even when an older release is listed first", async () => {
    const github = createGithub({ latest: LATEST });
    await expect(
      fetchRuntimeRelease({
        running: RUNNING,
        token: "github-token",
        fetchImpl: github.fetchImpl,
      }),
    ).resolves.toEqual({
      latest: LATEST,
      image: IMAGE,
      changes: [
        {
          sha: "c".repeat(40),
          message: "feat(config): add tagline and share image",
        },
        { sha: "d".repeat(40), message: "fix: trim whitespace" },
        { sha: LATEST, message: "Dismiss source import issues (#183)" },
      ],
      releases: [LATEST_RELEASE],
    });
    expect(github.requests.map(({ url }) => url.pathname)).toEqual([
      `${REPO}/releases`,
      `/v2/opendeved/evidence-library-runtime/manifests/${LATEST}`,
      "/user",
      "/token",
      `/v2/opendeved/evidence-library-runtime/manifests/${LATEST}`,
      `${REPO}/compare/${RUNNING}...${LATEST}`,
      `${REPO}/commits`,
    ]);
  });

  it("names every release since the running one, however far behind the library is", async () => {
    // 300 commits behind, with a release 281 commits back: past the 250 changes one check keeps.
    const between = Array.from({ length: 300 }, (_, index) =>
      index === 0 ? LATEST : index.toString(16).padStart(40, "0"),
    );
    const middle = between[280]!;
    const github = createGithub({
      latest: LATEST,
      between,
      releases: [{ commit: middle, publishedAt: "2026-09-08T12:00:00Z" }],
    });
    const release = await fetchRuntimeRelease({
      running: RUNNING,
      token: "github-token",
      fetchImpl: github.fetchImpl,
    });
    expect(release.releases).toEqual([
      LATEST_RELEASE,
      { commit: middle, summary: `Notes for ${middle}.`, notes: [] },
    ]);
    // The newest 250, oldest first.
    expect(release.changes).toHaveLength(250);
    expect(release.changes[0]?.sha).toBe(between[249]);
    expect(release.changes.at(-1)?.sha).toBe(LATEST);
  });

  it("places a commit that was never released by when it was made", async () => {
    const unreleased = "e".repeat(40);
    const github = createGithub({
      latest: LATEST,
      // After the 8 September release, before the 9 September one.
      runningCommittedAt: "2026-09-08T18:00:00Z",
    });
    const release = await fetchRuntimeRelease({
      running: unreleased,
      token: "github-token",
      fetchImpl: github.fetchImpl,
    });
    expect(release.releases).toEqual([LATEST_RELEASE]);
  });

  it("lists what the latest release has that a diverged library does not", async () => {
    const github = createGithub({
      latest: LATEST,
      diverged: true,
      runningCommittedAt: "2026-09-08T18:00:00Z",
    });
    const release = await fetchRuntimeRelease({
      running: "e".repeat(40),
      token: "github-token",
      fetchImpl: github.fetchImpl,
    });
    expect(release.changes.map(({ sha }) => sha)).toEqual([
      "c".repeat(40),
      "d".repeat(40),
      LATEST,
    ]);
  });

  it("offers only the newest notes when GitHub does not date an unreleased commit", async () => {
    const github = createGithub({
      latest: LATEST,
      runningCommittedAt: "not a date",
    });
    const release = await fetchRuntimeRelease({
      running: "e".repeat(40),
      token: "github-token",
      fetchImpl: github.fetchImpl,
    });
    expect(release.releases).toEqual([LATEST_RELEASE]);
  });

  it("still offers the latest release when the running commit is no longer on the branch", async () => {
    const github = createGithub({ latest: LATEST, compareStatus: 404 });
    await expect(
      fetchRuntimeRelease({
        running: RUNNING,
        token: "github-token",
        fetchImpl: github.fetchImpl,
      }),
    ).resolves.toEqual({
      latest: LATEST,
      image: IMAGE,
      changes: [],
      releases: [LATEST_RELEASE],
    });
  });

  it("fails clearly when GitHub cannot be read", async () => {
    const github = createGithub({ latest: LATEST, releasesStatus: 404 });
    await expect(
      fetchRuntimeRelease({
        running: RUNNING,
        token: "github-token",
        fetchImpl: github.fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "GITHUB_UNAVAILABLE" });
  });

  it("does not offer a commit until its runtime image exists", async () => {
    const github = createGithub({ latest: LATEST, imageStatus: 404 });
    await expect(
      fetchRuntimeRelease({
        running: RUNNING,
        token: "github-token",
        fetchImpl: github.fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_IMAGE_UNAVAILABLE" });
    expect(github.requests.map(({ url }) => url.pathname)).toEqual([
      `${REPO}/releases`,
      `/v2/opendeved/evidence-library-runtime/manifests/${LATEST}`,
    ]);
  });

  it("counts only the contract commit and later commits as reading the contract", async () => {
    const answers: Record<string, Response> = {
      [`${REPO}/compare/${CONTRACT}...${LATEST}`]: jsonResponse({ status: "ahead" }),
      [`${REPO}/compare/${CONTRACT}...${RUNNING}`]: jsonResponse({ status: "diverged" }),
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      answers[new URL(String(input)).pathname] ?? jsonResponse({ message: "Not Found" }, 404),
    ) as typeof fetch;
    const reads = (runtime: string) =>
      runtimeIncludesCommit({ runtime, commit: CONTRACT, token: "token", fetchImpl });
    await expect(reads(CONTRACT)).resolves.toBe(true);
    await expect(reads(LATEST)).resolves.toBe(true);
    await expect(reads(RUNNING)).resolves.toBe(false);
    // A commit GitHub cannot place is treated as older, so a publish updates it.
    await expect(reads("f".repeat(40))).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats a release row as fresh for ten minutes", () => {
    const checkedAt = 1_000_000;
    expect(isFreshRuntimeRelease(checkedAt, checkedAt + 1)).toBe(true);
    expect(
      isFreshRuntimeRelease(
        checkedAt,
        checkedAt + RUNTIME_RELEASE_CACHE_MS - 1,
      ),
    ).toBe(true);
    expect(
      isFreshRuntimeRelease(checkedAt, checkedAt + RUNTIME_RELEASE_CACHE_MS),
    ).toBe(false);
  });
});

describe("Evidence Library update check", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T10:00:00Z"));
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("GITHUB_TOKEN", "github-token");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads GitHub once, serves the cached answer for ten minutes, then checks again", async () => {
    const fixture = await createReadySetupFixture("update-check");
    const github = createGithub({ latest: LATEST });
    vi.stubGlobal("fetch", github.fetchImpl);
    const args = { libraryId: fixture.created.libraryId };

    const first = await fixture.admin.action(
      api.evidenceLibraries.updates.check,
      args,
    );
    expect(first).toEqual({
      running: RUNNING,
      latest: LATEST,
      latestImage: IMAGE,
      changes: [
        {
          sha: "c".repeat(40),
          message: "feat(config): add tagline and share image",
        },
        { sha: "d".repeat(40), message: "fix: trim whitespace" },
        { sha: LATEST, message: "Dismiss source import issues (#183)" },
      ],
      releases: [LATEST_RELEASE],
      checkedAt: Date.now(),
      contractSupport: { commit: CONTRACT, running: true, latest: true },
    });
    expect(github.requests).toHaveLength(8);

    vi.setSystemTime(Date.now() + RUNTIME_RELEASE_CACHE_MS - 1_000);
    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, args),
    ).resolves.toEqual(first);
    expect(github.requests).toHaveLength(8);

    vi.setSystemTime(Date.now() + 2_000);
    const refreshed = await fixture.admin.action(
      api.evidenceLibraries.updates.check,
      args,
    );
    expect(refreshed.checkedAt).toBe(Date.now());
    expect(github.requests).toHaveLength(16);
    const rows = await fixture.t.run((ctx) =>
      ctx.db.query("evidenceLibraryRuntimeReleases").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ running: RUNNING, latest: LATEST });
  });

  it("refreshes a recent cached release when the owner explicitly checks again", async () => {
    const fixture = await createReadySetupFixture("update-manual-refresh");
    vi.stubGlobal("fetch", createGithub({ latest: LATEST }).fetchImpl);
    const args = { libraryId: fixture.created.libraryId };
    const cached = await fixture.admin.action(api.evidenceLibraries.updates.check, args);

    vi.setSystemTime(Date.now() + 1_000);
    const newer = "e".repeat(40);
    const github = createGithub({ latest: newer });
    vi.stubGlobal("fetch", github.fetchImpl);
    await expect(fixture.admin.action(api.evidenceLibraries.updates.check, args))
      .resolves.toEqual(cached);
    expect(github.requests).toHaveLength(0);

    const refreshed = await fixture.admin.action(api.evidenceLibraries.updates.check, {
      ...args,
      refresh: true,
    });
    expect(refreshed).toMatchObject({ latest: newer, latestImage: IMAGE, checkedAt: Date.now() });
    const requestCount = github.requests.length;
    expect(requestCount).toBeGreaterThan(0);
    await expect(fixture.admin.action(api.evidenceLibraries.updates.check, args))
      .resolves.toEqual(refreshed);
    expect(github.requests).toHaveLength(requestCount);
    const rows = await fixture.t.run((ctx) =>
      ctx.db.query("evidenceLibraryRuntimeReleases").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ running: RUNNING, latest: newer });
  });

  it("tells the owner plainly when the deployment cannot reach GitHub", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await createReadySetupFixture("update-check-no-token");
    const github = createGithub({ latest: LATEST });
    vi.stubGlobal("fetch", github.fetchImpl);
    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, {
        libraryId: fixture.created.libraryId,
      }),
    ).rejects.toThrow(/Updates cannot be checked right now\./);
    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, {
        libraryId: fixture.created.libraryId,
      }),
    ).rejects.not.toThrow(/GITHUB_TOKEN/);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("GITHUB_TOKEN"),
    );
    expect(github.requests).toHaveLength(0);
  });

  it("starts the cached release when its published image is temporarily unavailable", async () => {
    const fixture = await createReadySetupFixture("update-check-image-pending");
    const newest = "e".repeat(40);
    const github = createGithub({ latest: newest, imageStatus: 404 });
    vi.stubGlobal("fetch", github.fetchImpl);
    const cached = {
      running: RUNNING,
      latest: LATEST,
      latestImage: IMAGE,
      changes: [],
      releases: [],
      checkedAt: Date.now() - RUNTIME_RELEASE_CACHE_MS - 1,
    };
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("evidenceLibraryRuntimeReleases", cached);
    });

    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, {
        libraryId: fixture.created.libraryId,
      }),
    ).resolves.toEqual({ ...cached, checkedAt: Date.now() });

    const started = await fixture.admin.mutation(
      api.evidenceLibraries.versions.startRuntimeUpdate,
      { libraryId: fixture.created.libraryId },
    );
    expect(started).toMatchObject({
      status: "running",
      from: RUNNING,
      to: LATEST,
    });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(started.operationId)),
    ).resolves.toMatchObject({
      runtimeUpdate: {
        from: RUNNING,
        to: LATEST,
        toImage: IMAGE,
      },
    });
  });

  it("keeps working when two cold checks left two rows for the same commit", async () => {
    const fixture = await createReadySetupFixture("update-check-duplicate");
    const github = createGithub({ latest: LATEST });
    vi.stubGlobal("fetch", github.fetchImpl);
    const stale = Date.now() - RUNTIME_RELEASE_CACHE_MS - 1;
    await fixture.t.run(async (ctx) => {
      for (const latest of [RUNNING, LATEST]) {
        await ctx.db.insert("evidenceLibraryRuntimeReleases", {
          running: RUNNING,
          latest,
          latestImage: IMAGE,
          changes: [],
          releases: [],
          checkedAt: stale,
        });
      }
    });
    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, {
        libraryId: fixture.created.libraryId,
      }),
    ).resolves.toMatchObject({ latest: LATEST, checkedAt: Date.now() });
    const rows = await fixture.t.run((ctx) =>
      ctx.db
        .query("evidenceLibraryRuntimeReleases")
        .withIndex("by_running", (query) => query.eq("running", RUNNING))
        .collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ latest: LATEST, checkedAt: Date.now() });
    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, {
        libraryId: fixture.created.libraryId,
      }),
    ).resolves.toMatchObject({ latest: LATEST, checkedAt: Date.now() });
    expect(github.requests).toHaveLength(8);
  });

  it("finds software too old for OpenScholar's contract and tells the publish dialog", async () => {
    const fixture = await createReadySetupFixture("update-check-contract");
    vi.stubGlobal(
      "fetch",
      createGithub({ latest: LATEST, contract: { running: "behind" } }).fetchImpl,
    );
    const args = { libraryId: fixture.created.libraryId };
    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.publishRuntime, args),
    ).resolves.toBe("current");

    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, args),
    ).resolves.toMatchObject({
      contractSupport: { commit: CONTRACT, running: false, latest: true },
    });
    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.publishRuntime, args),
    ).resolves.toBe("update");
  });

  it("asks GitHub again when a fresh row was checked against another contract", async () => {
    const fixture = await createReadySetupFixture("update-check-new-contract");
    const github = createGithub({ latest: LATEST });
    vi.stubGlobal("fetch", github.fetchImpl);
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("evidenceLibraryRuntimeReleases", {
        running: RUNNING,
        latest: LATEST,
        latestImage: IMAGE,
        changes: [],
        releases: [],
        checkedAt: Date.now(),
        contractSupport: { commit: "0".repeat(40), running: false, latest: true },
      });
    });
    const args = { libraryId: fixture.created.libraryId };
    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.publishRuntime, args),
    ).resolves.toBe("current");
    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, args),
    ).resolves.toMatchObject({
      contractSupport: { commit: CONTRACT, running: true },
    });
    expect(github.requests.length).toBeGreaterThan(0);
  });

  it("forgets an old release's contract answer when the new one cannot be checked", async () => {
    const fixture = await createReadySetupFixture("update-check-contract-unknown");
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("evidenceLibraryRuntimeReleases", {
        running: RUNNING,
        latest: "9".repeat(40),
        latestImage: IMAGE,
        changes: [],
        releases: [],
        checkedAt: Date.now() - RUNTIME_RELEASE_CACHE_MS - 1,
        contractSupport: { commit: CONTRACT, running: false, latest: false },
      });
    });
    vi.stubGlobal(
      "fetch",
      createGithub({ latest: LATEST, contract: { running: "behind", latest: 500 } }).fetchImpl,
    );
    const args = { libraryId: fixture.created.libraryId };
    const checked = await fixture.admin.action(api.evidenceLibraries.updates.check, args);
    expect(checked).toMatchObject({ latest: LATEST });
    expect(checked).not.toHaveProperty("contractSupport");
    const [row] = await fixture.t.run((ctx) =>
      ctx.db.query("evidenceLibraryRuntimeReleases").collect(),
    );
    expect(row).not.toHaveProperty("contractSupport");
    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.publishRuntime, args),
    ).resolves.toBe("current");
  });

  it("asks GitHub again within ten minutes while no release reads the contract", async () => {
    const fixture = await createReadySetupFixture("update-check-unreleased");
    const github = createGithub({ latest: LATEST, contract: { running: "behind", latest: "behind" } });
    vi.stubGlobal("fetch", github.fetchImpl);
    const args = { libraryId: fixture.created.libraryId };
    await fixture.admin.action(api.evidenceLibraries.updates.check, args);
    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.publishRuntime, args),
    ).resolves.toBe("unreleased");
    const asked = github.requests.length;

    await fixture.admin.action(api.evidenceLibraries.updates.check, args);
    expect(github.requests.length).toBeGreaterThan(asked);
  });

  it("refuses the check for a member who cannot manage the library", async () => {
    const fixture = await createReadySetupFixture("update-check-denied");
    const github = createGithub({ latest: LATEST });
    vi.stubGlobal("fetch", github.fetchImpl);
    const member = fixture.t.withIdentity({
      subject: "user_someone_else",
      o: { id: fixture.clerkOrganizationId, rol: "org:member" },
    });
    await expect(
      member.action(api.evidenceLibraries.updates.check, {
        libraryId: fixture.created.libraryId,
      }),
    ).rejects.toThrow(/access denied/);
    expect(github.requests).toHaveLength(0);
  });

  it("refreshes the release row for a running commit without a signed-in owner", async () => {
    const fixture = await createReadySetupFixture("update-refresh");
    const github = createGithub({ latest: LATEST });
    vi.stubGlobal("fetch", github.fetchImpl);
    await expect(
      fixture.t.action(internal.evidenceLibraries.updates.refresh, {
        running: RUNNING,
      }),
    ).resolves.toMatchObject({ running: RUNNING, latest: LATEST });
    const rows = await fixture.t.run((ctx) =>
      ctx.db.query("evidenceLibraryRuntimeReleases").collect(),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("Evidence Library address notices", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports the old address of a library that was moved while setting up", async () => {
    const fixture = await createDeployedSetupFixture("address-notice");
    const movedTo = "https://climate-evidence-2-lib.libraries.example.test";

    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.getAddressNotice, { libraryId: fixture.created.libraryId }),
    ).resolves.toBeNull();

    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.created.setupOperationId, {
        addressMove: {
          from: fixture.created.publicAddress,
          to: movedTo,
          movedAt: Date.now(),
          count: 1,
          applied: true,
        },
      });
    });

    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.getAddressNotice, { libraryId: fixture.created.libraryId }),
    ).resolves.toEqual({
      libraryId: fixture.created.libraryId,
      address: fixture.created.publicAddress,
      movedFrom: fixture.created.publicAddress,
      addressState: null,
    });
  });

  it("says nothing once the library is live at its address", async () => {
    const fixture = await createReadySetupFixture("address-notice-live");
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.created.setupOperationId, {
        addressMove: {
          from: fixture.created.publicAddress,
          to: "https://climate-evidence-2-lib.libraries.example.test",
          movedAt: Date.now(),
          count: 1,
          applied: true,
        },
      });
    });

    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.getAddressNotice, { libraryId: fixture.created.libraryId }),
    ).resolves.toBeNull();
  });
});

describe("Evidence Library address ownership check", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T10:00:00Z"));
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("GITHUB_TOKEN", "github-token");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answers the update check before the address has been asked", async () => {
    const fixture = await createReadySetupFixture("address-not-blocking");
    const github = createGithub({ latest: LATEST });
    vi.stubGlobal("fetch", github.fetchImpl);
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.created.runtimeBindingId, {
        addressState: "unreachable",
      });
    });

    await fixture.admin.action(api.evidenceLibraries.updates.check, {
      libraryId: fixture.created.libraryId,
    });
    const duringCheck = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.runtimeBindingId),
    );
    // The check came back with the software answer; the address answer is
    // still the old one because the probe has not run yet.
    expect(duringCheck).toMatchObject({ addressState: "unreachable" });

    await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);
    const afterProbe = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.runtimeBindingId),
    );
    expect(afterProbe).toMatchObject({ addressState: "ours" });
    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.getAddressNotice, { libraryId: fixture.created.libraryId }),
    ).resolves.toBeNull();
  });

  it("checks the canonical custom address instead of its redirecting platform address", async () => {
    const fixture = await createReadySetupFixture("address-canonical");
    const canonicalBaseUrl = "https://evidence.example.test";
    const github = createGithub({ latest: LATEST });
    vi.stubGlobal("fetch", github.fetchImpl);
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.created.runtimeBindingId, {
        addressState: "not-ours",
        canonicalBaseUrl,
      });
    });

    await fixture.admin.action(api.evidenceLibraries.updates.check, {
      libraryId: fixture.created.libraryId,
    });
    await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(github.addressRequests.map(String)).toEqual([
      `${canonicalBaseUrl}/api/library-config/health`,
    ]);
    const binding = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.runtimeBindingId),
    );
    expect(binding).toMatchObject({ addressState: "ours" });
  });

  it("stores that another site answers the address and tells the pages", async () => {
    const fixture = await createReadySetupFixture("address-not-ours");
    const github = createGithub({
      latest: LATEST,
      addressAnswer: new Response("<!doctype html><title>Other</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    });
    vi.stubGlobal("fetch", github.fetchImpl);

    await fixture.admin.action(api.evidenceLibraries.updates.check, {
      libraryId: fixture.created.libraryId,
    });
    await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);

    const binding = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.runtimeBindingId),
    );
    expect(binding).toMatchObject({ addressState: "not-ours" });
    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.getAddressNotice, { libraryId: fixture.created.libraryId }),
    ).resolves.toEqual({
      libraryId: fixture.created.libraryId,
      address: fixture.created.publicAddress,
      movedFrom: null,
      addressState: "not-ours",
    });
  });

  it("stores an address that nothing answers as unreachable", async () => {
    const fixture = await createReadySetupFixture("address-unreachable");
    const github = createGithub({
      latest: LATEST,
      addressAnswer: new Response("no available server", { status: 503 }),
    });
    vi.stubGlobal("fetch", github.fetchImpl);

    await fixture.admin.action(api.evidenceLibraries.updates.check, {
      libraryId: fixture.created.libraryId,
    });
    await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);
    const binding = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.runtimeBindingId),
    );
    expect(binding).toMatchObject({ addressState: "unreachable" });
  });

  it("throws away an answer about an address the library has left", async () => {
    const fixture = await createReadySetupFixture("address-late-answer");
    const binding = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.runtimeBindingId),
    );
    await fixture.t.mutation(
      internal.evidenceLibraries.updates.saveAddressState,
      {
        bindingId: binding!._id,
        askedAddress: "https://an-address-it-left.libraries.example.test",
        addressState: "not-ours",
        checkedAt: Date.now(),
      },
    );
    const after = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.runtimeBindingId),
    );
    // Setup left "ours" here; the answer about the old address is dropped.
    expect(after).toMatchObject({ addressState: "ours" });
  });
});
