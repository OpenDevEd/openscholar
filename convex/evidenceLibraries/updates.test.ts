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
const GITHUB = "https://api.github.com";
const REPO = "/repos/OpenDevEd/new-el";

type RecordedRequest = { url: URL; headers: Headers };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The library's own health answer, so the address counts as ours.
const OUR_HEALTH_ANSWER = () =>
  jsonResponse({
    state: "active",
    active: { revision: "r2", schemaVersion: 1 },
    rejected: null,
  });

function createGithub(input: {
  latest: string;
  compareStatus?: number;
  commitsStatus?: number;
  addressAnswer?: Response;
}) {
  const requests: RecordedRequest[] = [];
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
        return input.addressAnswer ?? OUR_HEALTH_ANSWER();
      }
      requests.push({ url, headers: new Headers(init?.headers) });
      if (url.origin !== GITHUB) {
        return jsonResponse({ message: "Unexpected test request" }, 500);
      }
      if (url.pathname === `${REPO}/commits/main`) {
        if (input.commitsStatus && input.commitsStatus !== 200) {
          return jsonResponse({ message: "Not Found" }, input.commitsStatus);
        }
        return jsonResponse({
          sha: input.latest,
          commit: { message: "Merge pull request #137" },
        });
      }
      if (url.pathname === `${REPO}/compare/${RUNNING}...${input.latest}`) {
        if (input.compareStatus && input.compareStatus !== 200) {
          return jsonResponse({ message: "Not Found" }, input.compareStatus);
        }
        return jsonResponse({
          status: "ahead",
          ahead_by: 2,
          total_commits: 2,
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
          ],
        });
      }
      return jsonResponse({ message: "Not Found" }, 404);
    },
  );
  return { fetchImpl, requests };
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
    ).resolves.toEqual({ latest: RUNNING, changes: [] });
    expect(github.requests).toHaveLength(1);
    expect(github.requests[0]?.headers.get("authorization")).toBe(
      "Bearer github-token",
    );
  });

  it("lists the commits between the running and latest commit as one line each", async () => {
    const github = createGithub({ latest: LATEST });
    await expect(
      fetchRuntimeRelease({
        running: RUNNING,
        token: "github-token",
        fetchImpl: github.fetchImpl,
      }),
    ).resolves.toEqual({
      latest: LATEST,
      changes: [
        {
          sha: "c".repeat(40),
          message: "feat(config): add tagline and share image",
        },
        { sha: "d".repeat(40), message: "fix: trim whitespace" },
      ],
    });
    expect(github.requests.map(({ url }) => url.pathname)).toEqual([
      `${REPO}/commits/main`,
      `${REPO}/compare/${RUNNING}...${LATEST}`,
    ]);
  });

  it("still reports the latest commit when the running commit is no longer on the branch", async () => {
    const github = createGithub({ latest: LATEST, compareStatus: 404 });
    await expect(
      fetchRuntimeRelease({
        running: RUNNING,
        token: "github-token",
        fetchImpl: github.fetchImpl,
      }),
    ).resolves.toEqual({ latest: LATEST, changes: [] });
  });

  it("fails clearly when GitHub cannot be read", async () => {
    const github = createGithub({ latest: LATEST, commitsStatus: 404 });
    await expect(
      fetchRuntimeRelease({
        running: RUNNING,
        token: "github-token",
        fetchImpl: github.fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "GITHUB_UNAVAILABLE" });
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
      changes: [
        {
          sha: "c".repeat(40),
          message: "feat(config): add tagline and share image",
        },
        { sha: "d".repeat(40), message: "fix: trim whitespace" },
      ],
      checkedAt: Date.now(),
      addressState: "ours",
    });
    expect(github.requests).toHaveLength(2);

    vi.setSystemTime(Date.now() + RUNTIME_RELEASE_CACHE_MS - 1_000);
    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, args),
    ).resolves.toEqual(first);
    expect(github.requests).toHaveLength(2);

    vi.setSystemTime(Date.now() + 2_000);
    const refreshed = await fixture.admin.action(
      api.evidenceLibraries.updates.check,
      args,
    );
    expect(refreshed.checkedAt).toBe(Date.now());
    expect(github.requests).toHaveLength(4);
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
          changes: [],
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
    expect(github.requests).toHaveLength(2);
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

  it("reports the new address of a library that was moved while setting up", async () => {
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
        },
      });
    });

    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.listAddressNotices, {}),
    ).resolves.toEqual([
      { libraryId: fixture.created.libraryId, movedTo, addressState: null },
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
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("GITHUB_TOKEN", "github-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("stores that another site answers the address and tells the list", async () => {
    const fixture = await createReadySetupFixture("address-not-ours");
    const github = createGithub({
      latest: LATEST,
      addressAnswer: new Response("<!doctype html><title>Other</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    });
    vi.stubGlobal("fetch", github.fetchImpl);

    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, {
        libraryId: fixture.created.libraryId,
      }),
    ).resolves.toMatchObject({ addressState: "not-ours" });

    const binding = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.runtimeBindingId),
    );
    expect(binding).toMatchObject({ addressState: "not-ours" });
    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.listAddressNotices, {}),
    ).resolves.toEqual([
      {
        libraryId: fixture.created.libraryId,
        movedTo: null,
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

    await expect(
      fixture.admin.action(api.evidenceLibraries.updates.check, {
        libraryId: fixture.created.libraryId,
      }),
    ).resolves.toMatchObject({ addressState: "unreachable" });
  });

  it("says nothing to the list while the address answers as ours", async () => {
    const fixture = await createReadySetupFixture("address-ours");
    const github = createGithub({ latest: LATEST });
    vi.stubGlobal("fetch", github.fetchImpl);

    await fixture.admin.action(api.evidenceLibraries.updates.check, {
      libraryId: fixture.created.libraryId,
    });
    await expect(
      fixture.admin.query(api.evidenceLibraries.updates.listAddressNotices, {}),
    ).resolves.toEqual([]);
  });
});
