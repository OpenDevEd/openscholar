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
} from "./runtimeReleases";

const RUNNING = "a".repeat(40);
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
}) {
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
        // Newest first, as GitHub lists them. The draft and the foreign tag
        // are skipped, and the release the library already runs is older
        // than the running commit's range.
        return jsonResponse([
          { tag_name: `runtime-${"9".repeat(40)}`, draft: true, body: "Draft" },
          { tag_name: "v1.0.0", draft: false, body: "Not a runtime release" },
          { tag_name: `runtime-${input.latest}`, draft: false, body: LATEST_NOTES },
          {
            tag_name: `runtime-${RUNNING}`,
            draft: false,
            body: "Older notes.\n\n- Records: Older note.\n",
          },
        ]);
      }
      if (url.pathname === `${REPO}/compare/${RUNNING}...${input.latest}`) {
        if (input.compareStatus && input.compareStatus !== 200) {
          return jsonResponse({ message: "Not Found" }, input.compareStatus);
        }
        return jsonResponse({
          status: "ahead",
          ahead_by: 3,
          total_commits: 3,
          commits: [
            {
              sha: "c".repeat(40),
              commit: {
                message:
                  "feat(config): add tagline and share image\n\nLonger body text.",
              },
            },
            {
              sha: "d".repeat(40),
              commit: { message: "  fix: trim whitespace  " },
            },
            {
              sha: input.latest,
              commit: { message: "Dismiss source import issues (#183)" },
            },
          ],
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

  it("lists the notes of each newer release and the commits behind them", async () => {
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
    ]);
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
    });
    expect(github.requests).toHaveLength(6);

    vi.setSystemTime(Date.now() + RUNTIME_RELEASE_CACHE_MS - 1_000);
    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, args),
    ).resolves.toEqual(first);
    expect(github.requests).toHaveLength(6);

    vi.setSystemTime(Date.now() + 2_000);
    const refreshed = await fixture.admin.action(
      api.evidenceLibraries.updates.check,
      args,
    );
    expect(refreshed.checkedAt).toBe(Date.now());
    expect(github.requests).toHaveLength(12);
    const rows = await fixture.t.run((ctx) =>
      ctx.db.query("evidenceLibraryRuntimeReleases").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ running: RUNNING, latest: LATEST });
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
    expect(github.requests).toHaveLength(6);
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
      fixture.admin.query(api.evidenceLibraries.updates.listAddressNotices, {}),
    ).resolves.toEqual([]);

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
      fixture.admin.query(api.evidenceLibraries.updates.listAddressNotices, {}),
    ).resolves.toEqual([
      {
        libraryId: fixture.created.libraryId,
        address: fixture.created.publicAddress,
        movedFrom: fixture.created.publicAddress,
        addressState: null,
      },
    ]);
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
      fixture.admin.query(api.evidenceLibraries.updates.listAddressNotices, {}),
    ).resolves.toEqual([]);
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
      fixture.admin.query(api.evidenceLibraries.updates.listAddressNotices, {}),
    ).resolves.toEqual([]);
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
      fixture.admin.query(api.evidenceLibraries.updates.listAddressNotices, {}),
    ).resolves.toEqual([
      {
        libraryId: fixture.created.libraryId,
        address: fixture.created.publicAddress,
        movedFrom: null,
        addressState: "not-ours",
      },
    ]);
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
