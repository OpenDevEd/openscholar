// A screening's included papers go into a collection in an Evidence Library, and papers it leaves out leave one it
// read (plans/evidence-library-sources): queued as they move, written as the person, named when the library holds none.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { SERVER_MODEL_SLUG } from "../ai/config";
import { encrypt } from "../lib/crypto";
import { shelve } from "../screening/bookkeeping";
import { setupScreeningWorkpool } from "../screening/workpool.test-support";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

const KEY = "1".repeat(64);
const questions = [{ key: "q1", question: "Randomized?" }];
const scoringConfig = { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 1, stars: 5 }], minimumScore: 1 };
const READ = "6f1c2a7e-0000-4000-8000-000000000001";
const MADE = "6f1c2a7e-0000-4000-8000-0000000000aa";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Call = { method: string; path: string; body: Record<string, unknown> | null };

async function setup(name: string, access: "owner" | "viewer" = "owner") {
  const fixture = await createReadySetupFixture(name);
  const libraryId = fixture.created.libraryId;
  setupScreeningWorkpool(fixture.t);
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  await fixture.t.run(async (ctx) => {
    const credential = (await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).collect()).find((row) => row.credentialKey === "library-service")!;
    await ctx.db.patch("evidenceLibraryCredentials", credential._id, { encryptedValue: encrypt("machine-secret", KEY) });
    const userId = (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", fixture.clerkUserId)).unique())!._id;
    await seedCreditsForTest(ctx, { userId, free: 100_000 });
    await ctx.db.insert("models", { modelId: SERVER_MODEL_SLUG, name: "Server model", provider: "test", inputPricePerMillion: 0.1, outputPricePerMillion: 0.5, costMarkup: 1.3, isServed: true, sortOrder: 1, supportedParameters: [], syncedAt: 1, createdAt: 1, updatedAt: 1 });
  });
  const calls: Call[] = [];
  // What runs while a write to a collection is out, once.
  const hooks: { during?: () => Promise<void>; refuse?: boolean } = {};
  const collection = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id === MADE ? "Included from tutoring" : "Reading list", description: null, private: true, count: 3, access, owner: { name: "Ada", image: null }, ...extra });
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body });
    if (url.pathname === "/api/v1/openscholar/sources/resolve") return Response.json({ keys: ["AAAAAAAA", "BBBBBBBB", "CCCCCCCC"], total: 3, truncated: false });
    if (url.pathname.endsWith("/collections") && init?.method === "POST") return Response.json({ collection: collection(MADE, { name: body.name, count: 0 }) }, { status: 201 });
    if (url.pathname.startsWith("/api/v1/openscholar/collections/")) return Response.json(collection(url.pathname.split("/").at(-1)!));
    if (url.pathname === "/api/v1/openscholar/records/match") return Response.json({ matches: (body.papers as Array<{ openalexId?: string }>).flatMap((paper, at) => (paper.openalexId === "W7" ? [{ at, key: "MATCHED1" }] : [])) });
    if (url.pathname.endsWith("/records")) {
      const during = hooks.during;
      hooks.during = undefined;
      await during?.();
      if (url.pathname.endsWith(`/collections/${READ}/records`) && hooks.refuse) return Response.json({ error: "role", message: "You can only view this collection." }, { status: 403 });
      // The new collection's library shows no CCCCCCCC; the collection read holds every record.
      const shown = (key: string) => key !== "HIDDENKY" && !(key === "CCCCCCCC" && url.pathname.includes(MADE));
      return Response.json({ count: 5, changed: (body.keys as string[]).filter(shown), missing: (body.keys as string[]).filter((key) => !shown(key)) });
    }
    return new Response("Not found", { status: 404 });
  }));
  return { ...fixture, libraryId, calls, hooks, person: fixture.t.withIdentity({ subject: fixture.clerkUserId }) };
}

/** A result of the job as an included paper. */
async function included(t: Awaited<ReturnType<typeof setup>>["t"], jobId: Id<"screeningJobs">, paperKey: string, ref: Record<string, string>, crossRefs?: { openalexId?: string }) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("screeningResults", { jobId, paperKey, ref: ref as never, ...(crossRefs ? { crossRefs } : {}), title: paperKey, authors: [], status: "completed", outcome: "included", qualified: true, createdAt: 1 });
    const job = (await ctx.db.get("screeningJobs", jobId))!;
    await shelve(ctx, job, (await ctx.db.get("screeningResults", id))!, { becameIncluded: true, left: false });
    return id;
  });
}

it("makes a new collection in the library once, puts the included papers there, and names the ones the library holds no record of", async () => {
  const { t, libraryId, calls, person } = await setup("libwrites");
  const set = { kind: "evidenceLibrary" as const, libraryId, source: { readerCollection: READ } };
  const saveTo = { kind: "newLibraryCollection" as const, libraryId, name: "Included from tutoring", private: true, requestId: "form-1" };
  const { jobId } = await person.action(api.screening.start.screen, { set, first: 1, last: 3, questions, scoringConfig, saveTo });
  expect(calls.filter((call) => call.method === "POST" && call.path.endsWith("/collections")).map((call) => call.body)).toEqual([{ name: "Included from tutoring", private: true, requestId: "form-1" }]);
  expect(await t.run((ctx) => ctx.db.get("screeningJobs", jobId))).toMatchObject({ unsaved: true, libraryDestination: { libraryId, collection: MADE, name: "Included from tutoring" } });

  // A record of the library goes by its key, another paper by the record the library holds for it, if any.
  const own = await included(t, jobId, `library:${libraryId}:AAAAAAAA`, { source: "library", libraryId, key: "AAAAAAAA" });
  const matched = await included(t, jobId, "openalex:W7", { source: "openalex", work: "W7" }, { openalexId: "W7" });
  const unmatched = await included(t, jobId, "openalex:W9", { source: "openalex", work: "W9" }, { openalexId: "W9" });
  const hidden = await included(t, jobId, `library:${libraryId}:HIDDENKY`, { source: "library", libraryId, key: "HIDDENKY" });
  expect(await t.run((ctx) => ctx.db.query("libraryWrites").collect())).toHaveLength(4);
  await t.action(internal.evidenceLibraries.sourceActions.flushWrites, { job: jobId, attempt: 0 });

  const added = calls.find((call) => call.method === "POST" && call.path.endsWith(`/collections/${MADE}/records`));
  expect((added?.body?.keys as string[]).toSorted()).toEqual(["AAAAAAAA", "HIDDENKY", "MATCHED1"]);
  const writes = await t.run(async (ctx) => Object.fromEntries(await Promise.all([own, matched, unmatched, hidden].map(async (id) => [(await ctx.db.get("screeningResults", id))!.paperKey, (await ctx.db.get("screeningResults", id))!.libraryWrite]))));
  expect(writes).toEqual({ [`library:${libraryId}:AAAAAAAA`]: "added", "openalex:W7": "added", "openalex:W9": "missing", [`library:${libraryId}:HIDDENKY`]: "missing" });
  expect(await t.run((ctx) => ctx.db.query("libraryWrites").collect())).toEqual([]);

  // The job's page says where they went and how many the library didn't take, and lists those.
  const workspaceId = (await person.query(api.workspaces.queries.personal, {}))!;
  expect(await person.query(api.screening.queries.getScreeningJob, { workspaceId, jobId })).toMatchObject({ libraryDestination: { collection: MADE, name: "Included from tutoring" }, libraryAdded: 2, libraryMissing: 2 });
  const missing = await person.query(api.screening.papers.list, { workspaceId, jobId, outcome: "included", notInLibrary: true, paginationOpts: { cursor: null, numItems: 10 } });
  expect(missing.page.map((paper) => paper.paper).toSorted()).toEqual([`library:${libraryId}:HIDDENKY`, "openalex:W9"].toSorted());
});

it("refuses to save to a collection the person may only view, and takes excluded papers out of one they edit", async () => {
  const viewer = await setup("libwrites-viewer", "viewer");
  const saveTo = { kind: "libraryCollection" as const, libraryId: viewer.libraryId, collection: READ };
  await expect(viewer.person.action(api.screening.start.screen, { set: { kind: "evidenceLibrary", libraryId: viewer.libraryId, source: { library: true } }, first: 1, last: 3, questions, scoringConfig, saveTo })).rejects.toThrow(/only view/);
  await expect(viewer.person.action(api.screening.start.screen, { set: { kind: "evidenceLibrary", libraryId: viewer.libraryId, source: { readerCollection: READ } }, first: 1, last: 3, questions, scoringConfig, saveTo: { kind: "none" }, prune: true })).rejects.toThrow(/only view/);

  const { t, libraryId, calls, hooks, person } = await setup("libwrites-prune");
  const { jobId } = await person.action(api.screening.start.screen, { set: { kind: "evidenceLibrary", libraryId, source: { readerCollection: READ } }, first: 1, last: 3, questions, scoringConfig, saveTo: { kind: "none" }, prune: true });
  expect(await t.run((ctx) => ctx.db.get("screeningJobs", jobId))).toMatchObject({ prune: true, pruneName: "Reading list" });
  const left = await t.run(async (ctx) => {
    const id = await ctx.db.insert("screeningResults", { jobId, paperKey: `library:${libraryId}:BBBBBBBB`, ref: { source: "library", libraryId, key: "BBBBBBBB" }, title: "B", authors: [], status: "completed", outcome: "excluded", qualified: false, createdAt: 1 });
    await shelve(ctx, (await ctx.db.get("screeningJobs", jobId))!, (await ctx.db.get("screeningResults", id))!, { becameIncluded: false, left: true });
    return id;
  });
  await t.action(internal.evidenceLibraries.sourceActions.flushWrites, { job: jobId, attempt: 0 });
  expect(calls.find((call) => call.method === "DELETE")).toMatchObject({ path: expect.stringContaining(`/collections/${READ}/records`), body: { keys: ["BBBBBBBB"] } });
  expect(await t.run((ctx) => ctx.db.get("screeningResults", left))).toMatchObject({ pruned: true });
  // Counted removed once the library confirms it.
  const progress = () => t.run(async (ctx) => (await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique())!);
  expect((await progress()).removed).toBe(1);

  // Taken off the collection before the next paper leaves: that one isn't counted, and the job says why.
  hooks.refuse = true;
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("screeningResults", { jobId, paperKey: `library:${libraryId}:CCCCCCCC`, ref: { source: "library", libraryId, key: "CCCCCCCC" }, title: "C", authors: [], status: "completed", outcome: "excluded", qualified: false, createdAt: 1 });
    await shelve(ctx, (await ctx.db.get("screeningJobs", jobId))!, (await ctx.db.get("screeningResults", id))!, { becameIncluded: false, left: true });
  });
  await t.action(internal.evidenceLibraries.sourceActions.flushWrites, { job: jobId, attempt: 0 });
  expect((await progress()).removed).toBe(1);
  expect(await t.run((ctx) => ctx.db.get("screeningJobs", jobId))).toMatchObject({ libraryPruneProblem: "role" });
  expect((await t.run((ctx) => ctx.db.get("screeningJobs", jobId)))?.libraryWriteProblem).toBeUndefined();
});

it("writes a paper that moved while a batch was out, and only the collection the papers go to says which it took", async () => {
  const { t, libraryId, hooks, person } = await setup("libwrites-moves");
  const saveTo = { kind: "newLibraryCollection" as const, libraryId, name: "Included", private: true, requestId: "form-2" };
  const { jobId } = await person.action(api.screening.start.screen, { set: { kind: "evidenceLibrary", libraryId, source: { readerCollection: READ } }, first: 1, last: 3, questions, scoringConfig, saveTo, prune: true });
  const flush = () => t.action(internal.evidenceLibraries.sourceActions.flushWrites, { job: jobId, attempt: 0 });
  const written = (id: Id<"screeningResults">) => t.run(async (ctx) => (await ctx.db.get("screeningResults", id))?.libraryWrite ?? null);
  const move = (id: Id<"screeningResults">, outcome: "included" | "excluded") =>
    t.run(async (ctx) => {
      await ctx.db.patch("screeningResults", id, { outcome, qualified: outcome === "included" });
      await shelve(ctx, (await ctx.db.get("screeningJobs", jobId))!, (await ctx.db.get("screeningResults", id))!, { becameIncluded: outcome === "included", left: outcome === "excluded" });
    });

  // The job's flush waiting on its timer, run in its place: false when none waits.
  const scheduledFlush = async () => {
    const waiting = await t.run(async (ctx) => {
      const found = (await ctx.db.system.query("_scheduled_functions").collect()).filter((fn) => fn.name.includes("flushWrites") && fn.state.kind === "pending" && (fn.args[0] as { job?: string }).job === jobId);
      for (const fn of found) await ctx.scheduler.cancel(fn._id);
      return found.length > 0;
    });
    if (waiting) await flush();
    return waiting;
  };

  // A paper included while the first batch is out goes in with the next, which the first starts.
  const first = await included(t, jobId, `library:${libraryId}:AAAAAAAA`, { source: "library", libraryId, key: "AAAAAAAA" });
  let late: Id<"screeningResults"> | undefined;
  hooks.during = async () => {
    late = await included(t, jobId, `library:${libraryId}:BBBBBBBB`, { source: "library", libraryId, key: "BBBBBBBB" });
  };
  expect(await scheduledFlush()).toBe(true);
  expect(await written(first)).toBe("added");
  expect(await written(late!)).toBeNull();
  expect(await scheduledFlush()).toBe(true);
  expect(await written(late!)).toBe("added");

  // A record the new collection's library doesn't show stays missing from it when it comes back to the collection read.
  const back = await included(t, jobId, `library:${libraryId}:CCCCCCCC`, { source: "library", libraryId, key: "CCCCCCCC" });
  await flush();
  expect(await written(back)).toBe("missing");
  await move(back, "excluded");
  await move(back, "included");
  await flush();
  expect(await written(back)).toBe("missing");

  // One that comes to be left out is no longer listed, or counted, as missing from it.
  const workspaceId = (await person.query(api.workspaces.queries.personal, {}))!;
  const missing = async () => ({
    listed: (await person.query(api.screening.papers.list, { workspaceId, jobId, outcome: "included", notInLibrary: true, paginationOpts: { cursor: null, numItems: 10 } })).page.map((paper) => paper.paper),
    counted: (await person.query(api.screening.queries.getScreeningJob, { workspaceId, jobId }))?.libraryMissing,
  });
  expect(await missing()).toEqual({ listed: [`library:${libraryId}:CCCCCCCC`], counted: 1 });
  await move(back, "excluded");
  expect(await missing()).toEqual({ listed: [], counted: 0 });
});
