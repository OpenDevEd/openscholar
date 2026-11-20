/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { releasesBehind } from "../../lib/evidence-libraries/runtime-position";
import { fetchRuntimeCatalog, fetchRuntimeRelease, setRuntimeReleasePrerelease } from "./runtimeReleases";

const RUNNING = "a".repeat(40);
const PROMOTED = "b".repeat(40);
const UNPROMOTED = "c".repeat(40);
const IMAGE = `ghcr.io/opendeved/evidence-library-runtime@sha256:${"f".repeat(64)}`;

/** GitHub and the registry, as far as the release list needs them. `placed` answers how the newest stands against what runs. */
function github(placed = "ahead") {
  const patches: { url: string; body: unknown }[] = [];
  const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const release = (id: number, commit: string, publishedAt: string, prerelease: boolean, body: string) => ({ id, tag_name: `runtime-${commit}`, published_at: publishedAt, prerelease, draft: false, body });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "PATCH") {
      patches.push({ url: url.pathname, body: JSON.parse(String(init.body)) });
      return answer({});
    }
    if (url.pathname.endsWith("/releases")) {
      return answer([
        release(1, RUNNING, "2026-11-01T00:00:00Z", false, "Running.\n- A note"),
        release(2, PROMOTED, "2026-11-02T00:00:00Z", false, "Promoted.\n\nImage: `x`\nDatabase changes: 2"),
        release(3, UNPROMOTED, "2026-11-03T00:00:00Z", true, "Not yet.\n\nDatabase changes: 0"),
      ]);
    }
    if (url.pathname.includes("/compare/")) return answer({ status: placed, ahead_by: placed === "ahead" ? 1 : 0, merge_base_commit: { sha: RUNNING } });
    if (url.pathname.includes("/commits")) return answer([]);
    if (url.pathname === "/token") return answer({ token: "registry" });
    return new Response(null, { status: 200, headers: { "docker-content-digest": `sha256:${"f".repeat(64)}` } });
  }) as typeof fetch;
  return { fetchImpl, patches };
}

async function seedRollout(records: { small: number; big: number }) {
  const fixture = await createReadySetupFixture("rollout");
  const small = fixture.created.libraryId;
  const big = await fixture.t.run(async (ctx) => {
    const { _id, _creationTime, ...library } = (await ctx.db.get("evidenceLibraries", small))!;
    const running = (await ctx.db.get("evidenceLibraryRuntimeBindings", library.runtimeBindingId!))!;
    const { _id: _bindingId, _creationTime: _bindingTime, ...binding } = running;
    const copy = await ctx.db.insert("evidenceLibraries", { ...library, name: "Bigger" });
    const copyBinding = await ctx.db.insert("evidenceLibraryRuntimeBindings", { ...binding, libraryId: copy });
    await ctx.db.patch("evidenceLibraries", copy, { runtimeBindingId: copyBinding });
    for (const [libraryId, searchable] of [[small, records.small], [copy, records.big]] as const) {
      await ctx.db.insert("evidenceLibrarySourceStatus", {
        libraryId,
        observedAt: 1,
        sources: [{ key: "zotero-1", provider: "zotero", searchable, searchFailed: 0, changed: 0, lastSuccessAt: null, issues: {}, state: "idle" }],
        records: searchable,
      });
    }
    for (const binding of [running._id, copyBinding]) await ctx.db.patch("evidenceLibraryRuntimeBindings", binding, { runtimeCommit: RUNNING });
    await ctx.db.insert("evidenceLibraryReleaseCatalog", { commit: RUNNING, releaseId: 1, publishedAt: 1, prerelease: false, summary: "Running", notes: [] });
    await ctx.db.insert("evidenceLibraryReleaseCatalog", { commit: PROMOTED, releaseId: 2, publishedAt: 2, prerelease: false, summary: "Promoted", notes: [], databaseChanges: 1 });
    await ctx.db.insert("evidenceLibraryReleaseCatalog", { commit: UNPROMOTED, releaseId: 3, publishedAt: 3, prerelease: true, summary: "Not yet", notes: [] });
    return copy;
  });
  const start = () => fixture.t.mutation(internal.evidenceLibraries.releases.createRollout, { target: PROMOTED, targetImage: IMAGE, startedByClerkUserId: "user_site_admin" });
  const rollout = () => fixture.t.run(async (ctx) => (await ctx.db.query("evidenceLibraryRollouts").first())!);
  const operationOf = async (operationId: Id<"evidenceLibraryConfigOperations">) => (await fixture.t.run((ctx) => ctx.db.get("evidenceLibraryConfigOperations", operationId)))!;
  const finish = (operationId: Id<"evidenceLibraryConfigOperations">, status: "succeeded" | "failed") =>
    fixture.t.run((ctx) =>
      ctx.db.patch("evidenceLibraryConfigOperations", operationId, {
        status,
        configurationAttemptToken: undefined,
        configurationLeaseExpiresAt: undefined,
        ...(status === "failed" ? { error: { code: "TEST", message: "The indexer didn't become healthy", stage: "health_check" } } : {}),
      }),
    );
  const makeAdmin = () =>
    fixture.t.run(async (ctx) => {
      for (const user of await ctx.db.query("users").take(10)) await ctx.db.insert("admins", { email: user.email, userId: user._id, createdAt: 1 });
    });
  /** GitHub's answer to whether the community already holds the target is a test's to give. */
  const begin = async (reached = false, running: string | null = RUNNING) => {
    const { _id } = await rollout();
    await fixture.t.mutation(internal.evidenceLibraries.releases.beginCommunity, { rolloutId: _id, running, reached });
    return (await rollout()).operationId!;
  };
  const advance = async () => fixture.t.mutation(internal.evidenceLibraries.releases.advance, { rolloutId: (await rollout())._id });
  return { fixture, small, big, start, rollout, operationOf, finish, makeAdmin, begin, advance };
}

describe("community releases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("offers only promoted releases, unless this deployment takes prereleases too", async () => {
    const { fetchImpl } = github();
    expect((await fetchRuntimeRelease({ running: RUNNING, token: "t", fetchImpl })).latest).toBe(PROMOTED);
    vi.stubEnv("EL_OFFER_PRERELEASES", "true");
    expect((await fetchRuntimeRelease({ running: RUNNING, token: "t", fetchImpl })).latest).toBe(UNPROMOTED);
  });

  it("never offers a community an older release than the one it runs", async () => {
    const { fetchImpl } = github("behind");
    expect(await fetchRuntimeRelease({ running: UNPROMOTED, token: "t", fetchImpl })).toMatchObject({ latest: UNPROMOTED, releases: [], changes: [] });
    expect(releasesBehind(UNPROMOTED, PROMOTED, [{ commit: UNPROMOTED }, { commit: PROMOTED }])).toBe(0);
  });

  it("counts a commit the list doesn't hold as behind", () => {
    expect(releasesBehind("old", PROMOTED, [{ commit: UNPROMOTED }, { commit: PROMOTED }, { commit: RUNNING }])).toBe(2);
    expect(releasesBehind(RUNNING, PROMOTED, [{ commit: UNPROMOTED }, { commit: PROMOTED }, { commit: RUNNING }])).toBe(1);
  });

  it("lists every release with its channel and database changes, and promotes through GitHub", async () => {
    const { fetchImpl, patches } = github();
    const catalog = await fetchRuntimeCatalog({ token: "t", fetchImpl });
    expect(catalog.map(({ release, prerelease, databaseChanges }) => [release.commit, prerelease, databaseChanges])).toEqual([
      [UNPROMOTED, true, 0],
      [PROMOTED, false, 2],
      [RUNNING, false, undefined],
    ]);
    expect(catalog[1]?.release.summary).toBe("Promoted.");
    await setRuntimeReleasePrerelease({ token: "t", releaseId: 3, prerelease: false, fetchImpl });
    expect(patches).toEqual([{ url: "/repos/OpenDevEd/evidence-community/releases/3", body: { prerelease: false } }]);
  });

  it("is for site admins only", async () => {
    const { fixture, makeAdmin } = await seedRollout({ small: 1, big: 2 });
    await expect(fixture.admin.query(api.evidenceLibraries.releases.overview, {})).rejects.toThrow("Admins only");
    await expect(fixture.admin.mutation(api.evidenceLibraries.releases.steerRollout, { action: "dismiss" })).rejects.toThrow("Admins only");
    await makeAdmin();
    const overview = await fixture.admin.query(api.evidenceLibraries.releases.overview, {});
    expect(overview.latest).toBe(PROMOTED);
    expect(overview.communities.map(({ records }) => records)).toEqual([1, 2]);
  });

  it("shows each community's own total, and places one too old to report it by its sources' counts", async () => {
    const { fixture, small, big, start, rollout, makeAdmin } = await seedRollout({ small: 10, big: 100 });
    await makeAdmin();
    // The smaller community's two sources hold the same 60 records, so their counts add up to more than the bigger's,
    // whose runtime reports no total.
    await fixture.t.run(async (ctx) => {
      const statusOf = async (libraryId: typeof small) => (await ctx.db.query("evidenceLibrarySourceStatus").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).unique())!;
      const smaller = await statusOf(small);
      const source = smaller.sources[0]!;
      await ctx.db.patch("evidenceLibrarySourceStatus", smaller._id, { sources: [{ ...source, searchable: 60 }, { ...source, key: "zotero-2", searchable: 60 }], records: 60 });
      await ctx.db.patch("evidenceLibrarySourceStatus", (await statusOf(big))._id, { records: undefined });
    });

    const overview = await fixture.admin.query(api.evidenceLibraries.releases.overview, {});
    expect(overview.communities.map(({ id, records }) => [id, records])).toEqual([[small, 60], [big, null]]);
    await start();
    expect((await rollout()).queue).toEqual([small, big]);
  });

  it("moves communities smallest first, one at a time, and stops at the first failure", async () => {
    const { fixture, small, big, start, rollout, operationOf, finish, makeAdmin, begin, advance } = await seedRollout({ small: 10, big: 100 });
    await makeAdmin();
    const steer = (action: "skip" | "retry" | "stop" | "dismiss" | "stopAfterThis") => fixture.admin.mutation(api.evidenceLibraries.releases.steerRollout, { action });

    await start();
    expect((await rollout()).queue).toEqual([small, big]);
    await expect(start()).rejects.toThrow("already running");

    const first = await begin();
    const operation = await operationOf(first);
    expect(operation.libraryId).toBe(small);
    expect(operation.runtimeUpdate).toMatchObject({ from: RUNNING, to: PROMOTED, toImage: IMAGE });
    expect(operation.requestedByClerkUserId).toBe("user_site_admin");

    await advance();
    expect((await rollout()).done).toBe(0);

    await finish(first, "failed");
    await advance();
    expect(await rollout()).toMatchObject({ state: "failed", done: 0, failure: "The indexer didn't become healthy" });
    await expect(steer("dismiss")).rejects.toThrow("still going");

    await steer("retry");
    expect(await rollout()).toMatchObject({ state: "running", done: 0 });
    expect((await rollout()).failure).toBeUndefined();
    const again = await begin();
    expect(again).toBe(first);

    await finish(again, "succeeded");
    await steer("stopAfterThis");
    await advance();
    expect(await rollout()).toMatchObject({ state: "stopped", done: 1 });
    await steer("dismiss");
    expect(await fixture.t.run((ctx) => ctx.db.query("evidenceLibraryRollouts").first())).toBeNull();
  });

  it("skips past a failure, and finishes without starting what's already moved on", async () => {
    const { fixture, big, start, rollout, finish, makeAdmin, begin, advance } = await seedRollout({ small: 10, big: 100 });
    await makeAdmin();
    await start();
    await finish(await begin(), "failed");
    await advance();
    await fixture.admin.mutation(api.evidenceLibraries.releases.steerRollout, { action: "skip" });
    expect(await rollout()).toMatchObject({ state: "running", done: 1 });
    await fixture.t.run(async (ctx) => {
      const library = (await ctx.db.get("evidenceLibraries", big))!;
      await ctx.db.patch("evidenceLibraryRuntimeBindings", library.runtimeBindingId!, { runtimeCommit: "d".repeat(40) });
    });
    // An owner's update went further than the release list knows of. An answer about another commit is refused.
    await expect(begin(false, RUNNING)).rejects.toThrow("changed as the update started");
    expect(await begin(true, "d".repeat(40))).toBeUndefined();
    expect(await rollout()).toMatchObject({ state: "finished", done: 2, skipped: 1 });
  });

  it("stops when its release is pulled back, except where prereleases are offered anyway", async () => {
    const { fixture, start, begin, rollout } = await seedRollout({ small: 10, big: 100 });
    await start();
    await fixture.t.mutation(internal.evidenceLibraries.releases.recordChannel, { commit: PROMOTED, prerelease: true });
    await expect(begin()).rejects.toThrow("pulled back");
    expect((await rollout()).operationId).toBeUndefined();
    vi.stubEnv("EL_OFFER_PRERELEASES", "true");
    expect(await begin()).toBeDefined();
  });

  it("leaves out what isn't behind, and refuses when nothing is", async () => {
    const { fixture, small, big, start, rollout } = await seedRollout({ small: 10, big: 100 });
    await fixture.t.run(async (ctx) => {
      const library = (await ctx.db.get("evidenceLibraries", small))!;
      await ctx.db.patch("evidenceLibraryRuntimeBindings", library.runtimeBindingId!, { runtimeCommit: PROMOTED });
    });
    await start();
    expect((await rollout()).queue).toEqual([big]);
    await fixture.t.run(async (ctx) => {
      const library = (await ctx.db.get("evidenceLibraries", big))!;
      await ctx.db.patch("evidenceLibraryRuntimeBindings", library.runtimeBindingId!, { runtimeCommit: PROMOTED });
      const done = (await ctx.db.query("evidenceLibraryRollouts").first())!;
      await ctx.db.delete("evidenceLibraryRollouts", done._id);
    });
    await expect(start()).rejects.toThrow("Nothing is behind");
  });

  it("makes every saved update check read again when a release changes channel", async () => {
    const { fixture } = await seedRollout({ small: 1, big: 2 });
    await fixture.t.run((ctx) => ctx.db.insert("evidenceLibraryRuntimeReleases", { running: RUNNING, latest: UNPROMOTED, latestImage: IMAGE, changes: [], releases: [], checkedAt: Date.now() }));
    await fixture.t.mutation(internal.evidenceLibraries.releases.recordChannel, { commit: UNPROMOTED, prerelease: true });
    expect(await fixture.t.run((ctx) => ctx.db.query("evidenceLibraryRuntimeReleases").first())).toMatchObject({ checkedAt: 0 });
  });

  it("doesn't publish onto a release whose saved check was withdrawn", async () => {
    const { fixture, small } = await seedRollout({ small: 1, big: 2 });
    const check = (checkedAt: number) =>
      fixture.t.run(async (ctx) => {
        for (const row of await ctx.db.query("evidenceLibraryRuntimeReleases").collect()) await ctx.db.delete("evidenceLibraryRuntimeReleases", row._id);
        await ctx.db.insert("evidenceLibraryRuntimeReleases", {
          running: RUNNING,
          latest: UNPROMOTED,
          latestImage: IMAGE,
          changes: [],
          releases: [],
          checkedAt,
          contractSupport: { commit: EVIDENCE_LIBRARY_CONFIG_PROVENANCE.commit, running: false, latest: true },
        });
      });
    await check(Date.now());
    expect(await fixture.admin.query(api.evidenceLibraries.updates.publishRuntime, { libraryId: small })).toBe("update");
    await fixture.t.mutation(internal.evidenceLibraries.releases.recordChannel, { commit: UNPROMOTED, prerelease: true });
    expect(await fixture.admin.query(api.evidenceLibraries.updates.publishRuntime, { libraryId: small })).toBe("unreleased");
  });

  it("withdraws saved checks when another deployment changed a channel, and only then", async () => {
    const { fixture } = await seedRollout({ small: 1, big: 2 });
    const rows = (prerelease: boolean) => [{ commit: PROMOTED, releaseId: 2, publishedAt: 2, prerelease, summary: "Promoted", notes: [] }];
    await fixture.t.mutation(internal.evidenceLibraries.releases.saveCatalog, { rows: rows(false) });
    await fixture.t.run((ctx) => ctx.db.insert("evidenceLibraryRuntimeReleases", { running: RUNNING, latest: PROMOTED, latestImage: IMAGE, changes: [], releases: [], checkedAt: 5 }));
    const saved = () => fixture.t.run((ctx) => ctx.db.query("evidenceLibraryRuntimeReleases").first());
    await fixture.t.mutation(internal.evidenceLibraries.releases.saveCatalog, { rows: rows(false) });
    expect(await saved()).toMatchObject({ checkedAt: 5 });
    await fixture.t.mutation(internal.evidenceLibraries.releases.saveCatalog, { rows: rows(true) });
    expect(await saved()).toMatchObject({ checkedAt: 0 });
  });

  it("keeps the list in step with GitHub", async () => {
    const { fixture } = await seedRollout({ small: 1, big: 2 });
    await fixture.t.mutation(internal.evidenceLibraries.releases.saveCatalog, {
      rows: [{ commit: PROMOTED, releaseId: 2, publishedAt: 2, prerelease: true, summary: "Pulled back", notes: [] }],
    });
    const rows = await fixture.t.run((ctx) => ctx.db.query("evidenceLibraryReleaseCatalog").collect());
    expect(rows.map(({ commit, prerelease, summary }) => [commit, prerelease, summary])).toEqual([[PROMOTED, true, "Pulled back"]]);
  });
});
