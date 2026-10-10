// The largest sizes the product allows stay within Convex's transaction limits (#350).
// Each flow that is fixed to fit adds its case here.
import { convexTest } from "convex-test";
import { getDocumentSize } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { personalWorkspaceOf } from "../workspaces/actor";
import { exportLibrary, exportParts, exportedTitles } from "../exports.test-support";
import { collectionSortName } from "../library/collections";

/** Collections a person keeps in the test below: past a page many times over. */
const COLLECTIONS = 500;
import { MAX_CATALOG_MODELS } from "../models/catalog";
import { MAX_SIZE, insertMany, seedAccount, seedExtractionJob, seedLibrary, text } from "../lib/maxSize.test-support";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { assertApprovedQueriesUnchanged } from "../evidenceLibraries/approvedQueries";
import { isAcceptableSavedConfigurationTarget } from "../evidenceLibraries/operations";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { setupExtractionPaperWorkpool } from "../extraction/queue/workpool.test-support";
import { createJob, insertJob } from "../screening/createJob.test-support";
import { searchTextOf } from "../screening/mutations";
import { setupScreeningWorkpool } from "../screening/workpool.test-support";
import { screeningInputs } from "../extraction/sources/screening.test-support";
import { madeBy } from "../workspaces/actor.test-support";
import { ensureWorkspace } from "../workspaces/create";
import { organizationOfLibrary } from "../../tests/helpers/evidence-library-setup-fixture";

/** seedLibrary's papers: rating (i % 5) + 1, published 1990 + (i % 35), saved at 1_700_000_000_000 + i, all in its collection. */
const seededLibrary = (items: number) => Array.from({ length: items }, (_, i) => ({ rating: (i % 5) + 1, year: 1990 + (i % 35), savedAt: 1_700_000_000_000 + i }));
/** How many of them a view keeps. */
const matchingOf = (seeded: ReturnType<typeof seededLibrary>, view: { minRating?: number; maxRating?: number; yearFrom?: number; yearTo?: number; savedAfter?: number }) =>
  seeded.filter((p) => p.rating >= (view.minRating ?? 0) && p.rating <= (view.maxRating ?? 5) && p.year >= (view.yearFrom ?? 0) && p.year <= (view.yearTo ?? 9999) && p.savedAt >= (view.savedAfter ?? 0)).length;

describe("at the largest sizes the product allows", { tags: ["size"] }, () => {
  it("captures all 1,000 Included screening papers for extraction through bounded pages", async () => {
    vi.useFakeTimers();
    try {
      const { start, snapshot, papers, revision } = await screeningInputs(MAX_SIZE.papersPerJob);
      const decided = await revision();
      const created = await start();
      expect(await snapshot(created.jobId)).toMatchObject({ totalPapers: 1000, processableCount: 1000 });
      const saved = await papers(created.jobId);
      expect(saved.map(p => p.openalexId)).toEqual(Array.from({ length: 1000 }, (_, i) => `https://openalex.org/W${i}`));
      expect(saved.every(p => p.screeningRevision === decided && p.abstract?.length === 2000)).toBe(true);
    } finally { vi.useRealTimers(); }
  }, 300_000);

  // A retry batch's work is 25 papers × their questions whatever the job's size, so 100
  // papers with the most questions test the largest batch; more papers only add batches.
  it("a 50-question job whose every result failed retries in batches", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      setupExtractionPaperWorkpool(t);
      const { userId, as } = await seedAccount(t);
      await t.run((ctx) => seedCreditsForTest(ctx, { userId, paid: 10_000_000 }));
      const { jobId } = await seedExtractionJob(t, userId, { papers: 100, failed: true });
      await t.run((ctx) => ctx.db.patch("extractionJobs", jobId, { status: "failed" }));
      const results = 100 * MAX_SIZE.questionsPerJob;
      expect(await as.mutation(api.extraction.mutations.retry.retryFailedQuestions, { jobId })).toMatchObject({ retryableCount: results });
      // Each scheduled batch runs as its own transaction, within Convex's limits.
      for (const done = new Set<string>(); ;) {
        const next = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).find((fn) => fn.name.includes("resetRetryBatch") && !done.has(fn._id)));
        if (!next) break;
        done.add(next._id);
        await t.mutation(internal.extraction.mutations.retry.resetRetryBatch, next.args[0] as never);
      }
      expect(await as.query(api.extraction.queries.countJobFailures, { jobId })).toMatchObject({ retryable: 0 });
      const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
      expect(job).toMatchObject({ status: "extracting", runEpoch: 1 });
      expect(job?.retryReset).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  }, 120_000);

  it("a 10,000-paper library browses page by page", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    await seedLibrary(t, userId);
    const page = await as.query(api.library.queries.browseLibrary, { sortBy: "savedAt", sortOrder: "desc", paginationOpts: { cursor: null, numItems: 20 } });
    expect(page.page).toHaveLength(20);
    expect(await as.query(api.library.queries.getLibraryCount, {})).toBe(MAX_SIZE.libraryItems);
  }, 300_000);

  it("a person's 500 collections page by name, each checked for a saved paper", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    // seedLibrary makes the first collection, which holds its paper.
    await seedLibrary(t, userId, { items: 1 });
    await insertMany(t, "collections", Array.from({ length: COLLECTIONS - 1 }, (_, i) => {
      const name = `Reading list ${i}: ${text(200, i)}`;
      return { userId, name, sortName: collectionSortName(name), itemCount: 0, createdAt: 1, updatedAt: 1 };
    }));
    await t.run(async (ctx) => ctx.db.insert("collectionCounts", { workspaceId: await personalWorkspaceOf(ctx, userId), count: COLLECTIONS }));
    expect(await as.query(api.library.collections.countCollections, {})).toBe(COLLECTIONS);
    // Asking for more than the largest page gets the largest page.
    const page = await as.query(api.library.collections.listCollections, { paginationOpts: { cursor: null, numItems: COLLECTIONS }, openalexId: "https://openalex.org/W0" });
    expect(page.page).toHaveLength(50);
    expect(page.isDone).toBe(false);
    expect(page.page.filter((collection) => collection.containsItem).map((collection) => collection.name)).toEqual(["Everything"]);
    const searched = await as.query(api.library.collections.listCollections, { paginationOpts: { cursor: null, numItems: 50 }, search: "tutoring" });
    expect(searched.page).toHaveLength(50);
  }, 120_000);

  it("a 10,000-paper library shows and exports every filter", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    const { collectionId } = await seedLibrary(t, userId);
    const sorted = { sortBy: "savedAt" as const, sortOrder: "desc" as const };
    const views = [
      { ...sorted, minRating: 4 },
      { ...sorted, yearFrom: 2020 },
      { ...sorted, savedAfter: 1_700_000_005_000 },
      { ...sorted, collectionId },
      { ...sorted, collectionId, maxRating: 1 },
      { sortBy: "citedByCount" as const, sortOrder: "asc" as const, minRating: 5, yearTo: 1995 },
      // Rating 5 and year 1990 never meet in the seed: a filter that matches nothing.
      { ...sorted, minRating: 5, yearTo: 1990 },
    ];
    const seeded = seededLibrary(MAX_SIZE.libraryItems);
    for (const view of views) {
      const page = await as.query(api.library.queries.browseLibrary, { ...view, paginationOpts: { cursor: null, numItems: 20 } });
      expect(page.page).toHaveLength(Math.min(20, matchingOf(seeded, view)));
    }
    const exported = await exportedTitles(t, as, { ...sorted, minRating: 2 });
    expect(exported).toHaveLength(MAX_SIZE.libraryItems * 0.8);
  }, 300_000);

  it("a 10,000-paper library of long abstracts exports in parts under Convex's 20 MiB response limit", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    await seedLibrary(t, userId, { abstractChars: 4_500 });
    const { parts } = await exportLibrary(t, as, { sortBy: "savedAt", sortOrder: "desc" }, "csv");
    expect(parts.length).toBeGreaterThan(1);
    for (const { response, text } of parts) {
      expect(response.status).toBe(200);
      expect(new TextEncoder().encode(text).byteLength).toBeLessThan(20 * 1024 * 1024);
    }
    // Each part is a whole CSV: a header, then its rows; together they hold every paper once.
    const rows = parts.flatMap(({ text }) => text.trimEnd().split("\n").slice(1));
    expect(rows).toHaveLength(MAX_SIZE.libraryItems);
    expect(parts.every(({ text }) => text.startsWith("\ufeffabstract,"))).toBe(true);
    expect(new Set(rows.map((row) => row.match(/https:\/\/openalex\.org\/W\d+/)?.[0])).size).toBe(MAX_SIZE.libraryItems);
  }, 600_000);

  it("a library's filtered counts are exact for every filter, from its counts or along the narrowest", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    // Counted: the aggregate's worker takes minutes to count 10,000 papers in a test, and counts don't read papers.
    const items = 2_000;
    const { collectionId } = await seedLibrary(t, userId, { items, counted: true });
    const sorted = { sortBy: "savedAt" as const, sortOrder: "desc" as const };
    const seeded = seededLibrary(items);
    for (const view of [{ minRating: 4 }, { yearFrom: 2020 }, { savedAfter: 1_700_000_000_500 }, { collectionId }, { collectionId, maxRating: 1 }, { minRating: 5, yearTo: 1995 }, { minRating: 5, yearTo: 1990 }]) {
      expect(await as.query(api.library.queries.getLibraryFilteredCount, { ...sorted, ...view })).toEqual({ count: matchingOf(seeded, view), capped: false });
    }
  }, 300_000);

  it("a library of long abstracts counts two filters by reading only the narrower one's papers", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    await seedLibrary(t, userId, { items: 2_000, abstractChars: 4_500, counted: true });
    // Rating 4 and up never meets year 1990 in the seed: the count reads only the papers of the narrower filter, the year's.
    const count = await as.query(api.library.queries.getLibraryFilteredCount, { sortBy: "savedAt", sortOrder: "desc", minRating: 4, yearTo: 1990 });
    expect(count).toEqual({ count: 0, capped: false });
  }, 300_000);

  it("a search of the longest OQL query edited 200 times, and a history page of 25 such searches, load (#354)", async () => {
    const t = convexTest({ schema, transactionLimits: true });
    const clerkId = "max_size_user";
    const { as } = await seedAccount(t, clerkId);
    const query = (i: number) => `${i} ${text(MAX_SIZE.oqlQueryChars - 6, i)}`;
    const search = (id: string, i: number) => ({ id, query: query(i), field: "oql" as const, count: 1, queryHistoryCount: 0, questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: [], createdAt: `2026-09-01T00:00:${String(i).padStart(2, "0")}.000Z`, updatedAt: "2026-09-01T00:00:00.000Z" });
    const change = (requestId: string, command: unknown) => as.mutation(api.research.records.change, { accountId: clerkId, requestId, command: command as never });
    for (let i = 0; i < 25; i++) await change(`create-${i}`, { kind: "createSearch", search: search(`search-${i}`, i) });
    for (let i = 1; i <= 200; i++) await change(`edit-${i}`, { kind: "editSearch", id: "search-0", edit: { kind: "query", query: query(1000 + i), field: "oql" } });
    const paginationOpts = { cursor: null, numItems: 25 };
    const page = await as.query(api.research.records.listedSearches, { accountId: clerkId, sort: "recent", paginationOpts });
    expect(page.page).toHaveLength(25);
    expect(page.page.find((row) => row.id === "search-0")?.queryHistoryCount).toBe(201);
    expect((await as.query(api.research.records.revisions, { accountId: clerkId, id: "search-0", paginationOpts })).page).toHaveLength(25);
    const history = await as.query(api.research.records.searchHistory, { accountId: clerkId, id: "search-0", kind: "query", paginationOpts: { cursor: null, numItems: 100 } });
    expect(history.page).toHaveLength(100);
    expect(history.page[0].text).toBe(query(1200));
  }, 300_000);

  it("a history of 100 searches, each query 180,000 characters, lists, filters, exports and clears (#420)", async () => {
    const t = convexTest({ schema, transactionLimits: true });
    const clerkId = "max_size_user";
    const { as } = await seedAccount(t, clerkId);
    const search = (i: number) => ({ id: `search-${i}`, query: `${i === 99 ? "needle" : "hay"} ${text(180_000 - 7, i)}`, field: "oql" as const, count: i, queryHistoryCount: 0, questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: [], createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(), updatedAt: "2026-09-01T00:00:00.000Z" });
    for (let i = 0; i < 100; i++) await as.mutation(api.research.records.change, { accountId: clerkId, requestId: `create-${i}`, command: { kind: "createSearch", search: search(i) } });
    await t.finishAllScheduledFunctions(() => {});
    expect(await as.query(api.research.records.countSearches, { accountId: clerkId })).toBe(100);
    // More than one transaction can read: each read stops at its byte budget, and the next carries on.
    const listed: string[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { page: Array<{ id: string }>; isDone: boolean; continueCursor: string } = await as.query(api.research.records.listedSearches, { accountId: clerkId, sort: "recent", paginationOpts: { cursor, numItems: 50 } });
      listed.push(...page.page.map((row) => row.id));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(listed).toHaveLength(100);

    // The one match is the last search the oldest-first read reaches.
    const found: string[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { page: Array<{ id: string }>; isDone: boolean; continueCursor: string } = await as.query(api.research.records.listedSearches, { accountId: clerkId, sort: "oldest", text: "NEEDLE", paginationOpts: { cursor, numItems: 12 } });
      found.push(...page.page.map((row) => row.id));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(found).toEqual(["search-99"]);

    const { parts } = await exportParts(t, as, { kind: "history" });
    expect(parts.flatMap(({ text }) => (JSON.parse(text) as { searches: unknown[] }).searches)).toHaveLength(100);
    expect(parts.every(({ text }) => new TextEncoder().encode(text).length < 20 * 1024 * 1024)).toBe(true);

    vi.useFakeTimers();
    await as.mutation(api.research.records.change, { accountId: clerkId, requestId: "clear", command: { kind: "clearSearches" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    expect(await as.query(api.research.records.countSearches, { accountId: clerkId })).toBe(0);
  }, 300_000);

  it("a search saved before #354 with 44 revisions of the longest OQL query lists every revision (#354)", async () => {
    const t = convexTest({ schema, transactionLimits: true });
    const clerkId = "max_size_user";
    const { userId, as } = await seedAccount(t, clerkId);
    // Each revision then held the whole history: the 44th, 44 copies of the query.
    const queryHistory = Array.from({ length: 44 }, (_, i) => ({ query: `${i} ${text(MAX_SIZE.oqlQueryChars - 6, i)}`, field: "oql" as const, timestamp: "2026-09-01T00:00:00.000Z" }));
    const data = (revision: number) => ({ id: "legacy", query: queryHistory[revision - 1].query, field: "oql" as const, count: 1, queryHistory: queryHistory.slice(0, revision), questionHistory: [], screeningQuestions: [], screeningResponses: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" });
    const searchId = await t.run(async (ctx) => ctx.db.insert("searches", { workspaceId: await personalWorkspaceOf(ctx, userId), createdBy: userId, localId: "legacy", data: data(44), revision: 44 }));
    for (let revision = 1; revision <= 44; revision++) await t.run((ctx) => ctx.db.insert("searchRevisions", { createdBy: userId, searchId, revision, author: "user", data: data(revision), deleted: false, createdAt: revision }));
    const revisions: number[] = [];
    for (let cursor: string | null = null, isDone = false; !isDone;) {
      const page: { page: Array<{ revision: number }>; isDone: boolean; continueCursor: string } = await as.query(api.research.records.revisions, { accountId: clerkId, id: "legacy", paginationOpts: { cursor, numItems: 25 } });
      revisions.push(...page.page.map((row) => row.revision));
      ({ isDone, continueCursor: cursor } = page);
    }
    expect(revisions).toEqual(Array.from({ length: 44 }, (_, i) => 44 - i));
  }, 300_000);

  it("an entry 449 steps back in a history of 450 of the longest OQL queries is read in bounded steps (#354)", async () => {
    const t = convexTest({ schema, transactionLimits: true });
    const clerkId = "max_size_user";
    const { userId, as } = await seedAccount(t, clerkId);
    const searchId = await t.run(async (ctx) => ctx.db.insert("searches", { workspaceId: await personalWorkspaceOf(ctx, userId), createdBy: userId, localId: "long", data: { id: "long", query: "q", field: "oql", count: 1, queryHistoryCount: 450, questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }, revision: 1 }));
    await insertMany(t, "searchHistory", Array.from({ length: 450 }, (_, position) => ({ userId, searchId, kind: "query", text: `${position} ${text(MAX_SIZE.oqlQueryChars - 6, position)}`, field: "oql", timestamp: "2026-09-01T00:00:00.000Z", position })), 25);
    let reads = 0;
    let result: { entry: { text: string } | null } | { skipped: number; cursor: string };
    for (let cursor: string | undefined, left = 449; ; left -= result.skipped, cursor = result.cursor) {
      reads++;
      result = await as.query(api.research.records.searchHistoryEntry, { accountId: clerkId, id: "long", kind: "query", stepsBack: left, ...(cursor ? { cursor } : {}) });
      if ("entry" in result) break;
    }
    expect(result.entry?.text.startsWith("0 ")).toBe(true);
    expect(reads).toBeGreaterThan(1);
  }, 300_000);

  it("an Evidence Library with 1,000 revisions, operations and people checks sources, lists its team and tears down", async () => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
    vi.stubEnv("EL_ALLOW_DEVELOPMENT_TEARDOWN", "true");
    try {
      const fixture = await createReadySetupFixture("max_size_library");
      const libraryId = fixture.created.libraryId;
      const { section, operation, organizationId } = await fixture.t.run(async (ctx) => ({
        section: (await ctx.db.query("evidenceLibraryConfigSections").withIndex("by_libraryId_and_kind_and_sectionKey", (q) => q.eq("libraryId", libraryId).eq("kind", "revision").eq("sectionKey", "identity")).first())!,
        operation: (await ctx.db.query("evidenceLibraryConfigOperations").withIndex("by_libraryId_and_createdAt", (q) => q.eq("libraryId", libraryId)).first())!,
        organizationId: await organizationOfLibrary(ctx, libraryId),
      }));
      const strip = <T extends { _id: unknown; _creationTime: unknown }>({ _id, _creationTime, ...doc }: T) => doc;
      // Sources revisions about 20 KB each, as a long-lived library's grow: 20 MB together.
      const sources = (i: number) => [
        { provider: "openalex", settings: { approvedQuery: { version: `version-${i % 10}`, approvedAt: "2026-01-01T00:00:00.000Z", query: { search: `query ${i % 10}` } } } },
        { provider: "filler", settings: { note: text(20_000, i) } },
      ];
      await insertMany(fixture.t, "evidenceLibraryConfigSections", Array.from({ length: 1_000 }, (_, i) => ({ ...strip(section), sectionKey: "sources", payload: sources(i), createdAt: i })), 100);
      // Configuration deployments, as every activation edit makes.
      await insertMany(fixture.t, "evidenceLibraryConfigOperations", Array.from({ length: 1_000 }, (_, i) => ({ ...strip(operation), kind: "publish", status: "succeeded", activationEditVersion: i + 1, idempotencyKey: `max-size-${i}`, createdAt: i + 10, updatedAt: i + 10 })), 200);
      // With the fixture's Owner, 1,000 organization members: the most a team page lists.
      const people = Array.from({ length: 999 }, (_, i) => `user_max_${i}`);
      const stamp = { clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 };
      await insertMany(fixture.t, "users", people.map((clerkId) => ({ clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 })), 100);
      await insertMany(fixture.t, "organizationMemberships", people.map((clerkUserId, i) => ({ organizationId, clerkMembershipId: `orgmem_max_${i}`, clerkUserId, role: "org:member", state: "active", ...stamp })), 100);
      await insertMany(fixture.t, "evidenceLibraryMembers", people.map((clerkUserId) => ({ libraryId, clerkUserId, role: "editor", grantedBy: "user_max_admin", grantedAt: 1 })), 100);
      // The library is recorded, as every library is once migrations/recordApprovedQueries has run.
      await fixture.t.run((ctx) => ctx.db.patch("evidenceLibraries", libraryId, { approvedQueriesRecorded: true }));

      await fixture.t.run(async (ctx) => assertApprovedQueriesUnchanged(ctx, (await ctx.db.get("evidenceLibraries", libraryId))!, sources(3)));
      // A recorded version given another query is still refused.
      const changed = [{ provider: "openalex", settings: { approvedQuery: { version: "version-3", approvedAt: "2026-01-01T00:00:00.000Z", query: { search: "another" } } } }];
      await expect(fixture.t.run(async (ctx) => assertApprovedQueriesUnchanged(ctx, (await ctx.db.get("evidenceLibraries", libraryId))!, changed))).rejects.toThrow(/cannot be changed/);
      const team = await fixture.admin.query(api.evidenceLibraries.queries.listTeam, { libraryId });
      expect(team.editors.length).toBe(999);
      await fixture.t.run(async (ctx) => isAcceptableSavedConfigurationTarget(ctx, (await ctx.db.query("evidenceLibraryConfigOperations").withIndex("by_libraryId_and_createdAt", (q) => q.eq("libraryId", libraryId)).order("desc").first())!));
      const library = await fixture.t.run(async (ctx) => (await ctx.db.get("evidenceLibraries", libraryId))!);
      expect(await fixture.admin.mutation(api.evidenceLibraries.teardown.requestDevelopmentTeardown, { libraryId, confirmationName: library.name })).toMatchObject({ status: "queued" });
    } finally {
      vi.unstubAllEnvs();
    }
  }, 300_000);

  it("an Evidence Library with 1,000 versions reads its history a page at a time and totals it (#423)", async () => {
    const fixture = await createReadySetupFixture("max_size_versions");
    const libraryId = fixture.created.libraryId;
    // Thirteen revisions, each built on the one before as activations make them, so a page lists ten different ones.
    const { operation, revisionIds, runtimeBindingId } = await fixture.t.run(async (ctx) => {
      const runtimeBindingId = (await ctx.db.query("evidenceLibraryRuntimeBindings").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).first())!._id;
      const operation = (await ctx.db.query("evidenceLibraryConfigOperations").withIndex("by_libraryId_and_createdAt", (q) => q.eq("libraryId", libraryId)).first())!;
      const revision = (await ctx.db.get(operation.revisionId!))!;
      const sections = await ctx.db.query("evidenceLibraryConfigSections").withIndex("by_revisionId_and_sectionKey", (q) => q.eq("revisionId", revision._id)).take(50);
      const revisionIds = [revision._id];
      for (let i = 0; i < 12; i++) {
        const { _id, _creationTime, ...fields } = revision;
        const id = await ctx.db.insert("evidenceLibraryConfigRevisions", { ...fields, revisionKey: `r${i + 2}`, revisionNumber: i + 2, basedOnRevisionId: revisionIds.at(-1)! });
        for (const { _id: _sectionId, _creationTime: _made, ...section } of sections) await ctx.db.insert("evidenceLibraryConfigSections", { ...section, revisionId: id } as never);
        revisionIds.push(id);
      }
      return { operation, revisionIds, runtimeBindingId };
    });
    const { _id, _creationTime, ...fields } = operation;
    const versions = Array.from({ length: 1_000 }, (_, i) => ({ ...fields, kind: "publish", status: "succeeded", activationEditVersion: i + 1, revisionId: revisionIds[i % revisionIds.length], idempotencyKey: `max-version-${i}`, createdAt: i + 10, updatedAt: i + 10 }));
    // The newest keep their deployment's encrypted configuration at close to the largest a row may hold, as a finished deployment does.
    const target = { applicationId: "application", aiProviderKey: { present: false }, openAlexApiKey: { present: false }, runtimeBindingId, targetBaseUrl: "https://library.example.test", customDomains: [], revisionKey: "r1", defaultLocale: "en-GB", runtimeCommit: "a".repeat(40), runtimeImage: "runtime:test", encryptedRuntimeConfig: "x".repeat(900_000), runtimeConfigSha256: "b".repeat(64), savedAt: 1 };
    await insertMany(fixture.t, "evidenceLibraryConfigOperations", versions.slice(0, 976), 200);
    await insertMany(fixture.t, "evidenceLibraryConfigOperations", versions.slice(976).map((version) => ({ ...version, configurationDeploymentTarget: target })), 8);
    // Asking for more than the largest page gets the largest page.
    const first = await fixture.admin.query(api.evidenceLibraries.versions.listVersionRows, { libraryId, paginationOpts: { cursor: null, numItems: 50 } });
    expect(first.page).toHaveLength(10);
    expect(new Set(first.page.map((version) => version.revisionId)).size).toBe(10);
    expect(first.isDone).toBe(false);
    const second = await fixture.admin.query(api.evidenceLibraries.versions.listVersionRows, { libraryId, paginationOpts: { cursor: first.continueCursor, numItems: 10 } });
    expect(second.page).toHaveLength(10);
    expect(await fixture.admin.query(api.evidenceLibraries.versions.countVersions, { libraryId })).toBeGreaterThanOrEqual(1_000);
  }, 300_000);

  it("a person who owns 200 organizations of ten libraries each reads and searches the library list (#423)", async () => {
    const t = convexTest(schema);
    const { as } = await seedAccount(t);
    const stamp = { clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 };
    const organizations = await insertMany(t, "organizations", Array.from({ length: 200 }, (_, i) => ({ clerkOrganizationId: `org_max_${i}`, name: `Organization ${String(i).padStart(3, "0")}`, slug: `organization-${i}`, state: "active", ...stamp })));
    // The account's own organization comes with the seed, so 199 more reach the most a person may belong to.
    await insertMany(t, "organizationMemberships", organizations.slice(0, 199).map((organizationId, i) => ({ organizationId, clerkMembershipId: `orgmem_max_owner_${i}`, clerkUserId: "max_size_user", role: "org:admin", state: "active", ...stamp })));
    await insertMany(t, "evidenceLibraries", organizations.slice(0, 199).flatMap((organizationId, i) => Array.from({ length: 10 }, (_, n) => ({ organizationId, name: `Library ${i}-${n}`, slug: `library-${i}-${n}`, state: "active", createdByClerkUserId: "max_size_user", updatedByClerkUserId: "max_size_user", createdAt: 1, updatedAt: 1 }))), 200);

    // One organization's list, as its pages read it (#651).
    const first = await as.query(api.evidenceLibraries.queries.listLibraries, { organization: organizations[0], paginationOpts: { cursor: null, numItems: 8 } });
    expect(first.page).toHaveLength(8);
    expect(first.isDone).toBe(false);
    // A search that matches nothing reads its allowance of libraries a step, and ends.
    let cursor: string | null = null;
    let reads = 0;
    for (; reads < 10; reads++) {
      const page: { page: unknown[]; isDone: boolean; continueCursor: string } = await as.query(api.evidenceLibraries.queries.listLibraries, { search: "no such library", paginationOpts: { cursor, numItems: 12 } });
      expect(page.page).toEqual([]);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(reads).toBeLessThan(5);
  }, 300_000);

  it("generates rows at the measured sizes", async () => {
    const t = convexTest(schema);
    const { userId } = await seedAccount(t);
    await seedExtractionJob(t, userId, { papers: 20, questions: 5 });
    await seedLibrary(t, userId, { items: 20 });
    const average = async (table: "extractionPapers" | "extractionResults" | "libraryItems") =>
      t.run(async (ctx) => { const rows = await ctx.db.query(table).take(20); return rows.reduce((sum, row) => sum + getDocumentSize(row), 0) / rows.length; });
    // Measured on shared dev on 2026-09-30: papers 3.9 KB, results 0.9 KB, library items 2.1 KB.
    expect(await average("extractionPapers")).toBeGreaterThan(3_500);
    expect(await average("extractionResults")).toBeGreaterThan(800);
    expect(await average("libraryItems")).toBeGreaterThan(2_000);
  });

  it("a 1,000-paper, 50-question screening job exports every result, and reads its largest page", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    const questions = Array.from({ length: MAX_SIZE.questionsPerJob }, (_, i) => ({ key: `q${i}`, question: `${text(180, i)}?` }));
    const jobId = await t.run((ctx) => insertJob(ctx, {
      userId, status: "completed", totalPapers: 1_000, questions,
      scoringConfig: { rules: questions.map(({ key }) => ({ questionKey: key, yesPoints: 1, noPoints: 0, nullPoints: 0 })), starThresholds: [{ minScore: 1, stars: 5 }] },
      createdAt: 1, updatedAt: 1,
    }));
    await insertMany(t, "screeningResults", Array.from({ length: 1_000 }, (_, i) => ({
      jobId, openalexId: `https://openalex.org/W${i}`, title: text(160, i), abstract: text(2_000, i), authors: Array.from({ length: 8 }, (_, a) => text(24, a)), publicationYear: 2020, doi: `10.1234/${i}`,
      status: "completed", answers: Object.fromEntries(questions.map(({ key }, q) => [key, (i + q) % 3 === 0 ? null : (i + q) % 2 === 0])), score: 25, stars: 5, qualified: true, createdAt: 1,
    })), 250);

    const csv = await exportParts(t, as, { kind: "screening", jobId }, "csv");
    expect(csv.parts).toHaveLength(1);
    expect(csv.text.split("\n")).toHaveLength(1_000 + 1);
    const json = await exportParts(t, as, { kind: "screening", jobId });
    expect(json.parts).toHaveLength(1);
    expect(JSON.parse(json.text).results).toHaveLength(1_000);
    // The workbook reads the largest page a read allows.
    const page = await as.query(api.screening.queries.listScreeningResults, { jobId, paginationOpts: { cursor: null, numItems: 1_000 } });
    expect(page.page).toHaveLength(200);
  }, 300_000);

  it("a search's answers read 200 papers at a time, and a question's answers leave every paper, at 50 questions a paper", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const clerkId = "max_answers_user";
      const { userId, as } = await seedAccount(t, clerkId);
      const questions = Array.from({ length: MAX_SIZE.questionsPerJob }, (_, i) => `${text(180, i)}?`);
      const papers = Array.from({ length: 450 }, (_, i) => `https://openalex.org/W${i}`);
      const at = new Date(Date.UTC(2026, 8, 1)).toISOString();
      const search = { id: "answered", query: "tutoring", field: "title" as const, count: 450, queryHistoryCount: 0, questionCount: 0, questionText: "", screeningQuestions: questions.map((question) => ({ question })), screeningResponses: [], createdAt: at, updatedAt: at };
      await as.mutation(api.research.records.change, { accountId: clerkId, requestId: "create", command: { kind: "createSearch", search } });
      // Seeded as rows: one import of this many answers wouldn't fit a transaction.
      const screeningId = await t.run(async (ctx) => {
        const searchWorkspace = await personalWorkspaceOf(ctx, userId);
        const search = (await ctx.db.query("searches").withIndex("by_workspace_and_localId", (q) => q.eq("workspaceId", searchWorkspace).eq("localId", "answered")).unique())!;
        return ctx.db.insert("screenings", { workspaceId: await personalWorkspaceOf(ctx, userId), searchId: search._id, version: 1, createdAt: 1 });
      });
      const answers = questions.map((question, q) => ({ question, answer: q % 2 === 0, setBy: "model" as const, updatedAt: 1, model: { answer: q % 2 === 0, confidence: 0.9, at: 1 } }));
      await insertMany(t, "screeningAnswers", papers.map((paperId) => ({ screeningId, paperId, answers })), 100);
      await insertMany(t, "screeningAnswerHistory", papers.map((paperId) => ({ screeningId, paperId, answers, version: 1, at: 1 })), 100);

      const page = await as.query(api.research.records.answersOf, { accountId: clerkId, id: "answered", paperIds: papers.slice(0, 200) });
      expect(page.page).toHaveLength(200);
      expect(page.page[0].responses).toHaveLength(MAX_SIZE.questionsPerJob);

      await as.mutation(api.research.records.change, { accountId: clerkId, requestId: "drop", command: { kind: "editSearch", id: "answered", edit: { kind: "replaceScreeningQuestion", question: questions[0], replacement: null } } });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const left = { rows: 0, withQuestion: 0 };
      for (let cursor: string | null = null; ;) {
        const read: { page: Array<{ answers: Array<{ question: string }> }>; isDone: boolean; continueCursor: string } = await t.run((ctx) =>
          ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId)).paginate({ cursor, numItems: 100 }));
        left.rows += read.page.length;
        left.withQuestion += read.page.filter((row) => row.answers.some((answer) => answer.question === questions[0])).length;
        if (read.isDone) break;
        cursor = read.continueCursor;
      }
      expect(left).toEqual({ rows: 450, withQuestion: 0 });
    } finally {
      vi.useRealTimers();
    }
  }, 300_000);

  it("a screening job's list reads its largest page, at 50 questions a paper, and a changed answer rescoring it (#421)", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t, "max_outcomes_user");
    const questions = Array.from({ length: MAX_SIZE.questionsPerJob }, (_, i) => ({ key: `q${i}`, question: `${text(180, i)}?` }));
    const { jobId, screeningId } = await t.run(async (ctx) => {
      const screeningId = await ctx.db.insert("screenings", { workspaceId: await personalWorkspaceOf(ctx, userId), version: 1, createdAt: 1 });
      const jobId = await ctx.db.insert("screeningJobs", {
        ...(await madeBy(ctx, userId)), status: "completed", totalPapers: 120, questions, screeningId,
        scoringConfig: { rules: questions.map(({ key }) => ({ questionKey: key, yesPoints: 1, noPoints: 0, nullPoints: 0 })), starThresholds: [{ minScore: 1, stars: 5 }], minimumScore: 1 },
        createdAt: 1, updatedAt: 1,
      });
      await ctx.db.insert("screeningJobProgress", { jobId, completed: 120, skipped: 0, failed: 0, qualified: 120, unclear: 0, tallies: questions.map(({ key }) => ({ key, yes: 120, no: 0, unclear: 0 })) });
      return { jobId, screeningId };
    });
    const answers = questions.map(({ question }) => ({ question, answer: true, setBy: "model" as const, updatedAt: 1, model: { answer: true, confidence: 0.9, at: 1 } }));
    const ids = Array.from({ length: 120 }, (_, i) => `https://openalex.org/W${i}`);
    await insertMany(t, "screeningResults", ids.map((openalexId, i) => ({ jobId, openalexId, title: i === 119 ? `needle ${text(150, i)}` : text(160, i), abstract: text(2_000, i), authors: Array.from({ length: 8 }, (_, a) => text(24, a)), status: "completed", score: 50, stars: 5, qualified: true, outcome: "included", counted: { qualified: true, outcome: "included", answers: Object.fromEntries(questions.map(({ key }) => [key, true])) }, answersVersion: 1, createdAt: 1 })).map((row) => ({ ...row, searchText: searchTextOf(row) })), 60);
    await insertMany(t, "screeningAnswers", ids.map((paperId) => ({ screeningId, paperId, answers, version: 1 })), 60);
    await insertMany(t, "screeningAnswerHistory", ids.map((paperId) => ({ screeningId, paperId, answers, version: 1, at: 1 })), 60);

    const page = await as.query(api.screening.papers.list, { jobId, outcome: "included", paginationOpts: { cursor: null, numItems: 1_000 } });
    expect(page.page).toHaveLength(50);
    expect(page.page[0].answers).toHaveLength(MAX_SIZE.questionsPerJob);
    const found = await as.query(api.screening.papers.list, { jobId, outcome: "included", text: "NEEDLE", paginationOpts: { cursor: null, numItems: 10 } });
    expect(found.page).toHaveLength(1);
    expect(await as.mutation(api.screening.papers.answer, { jobId, paperId: ids[0], questionKey: "q0", answer: false })).toMatchObject({ outcome: "included" });
    expect((await as.query(api.screening.queries.getScreeningJob, { jobId }))?.tallies?.[0]).toEqual({ key: "q0", yes: 119, no: 1, unclear: 0 });
  }, 300_000);

  it("a job reads the last 1,000 papers of a 10,000-paper collection of long abstracts (#341)", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      setupScreeningWorkpool(t);
      const { userId, as } = await seedAccount(t, "max_sets_user");
      await t.run((ctx) => seedCreditsForTest(ctx, { userId, paid: 10_000_000 }));
      const { collectionId } = await seedLibrary(t, userId, { abstractChars: 2_000 });

      const { jobId } = await as.action(api.screening.start.screen, {
        set: { kind: "collection", collectionId }, first: MAX_SIZE.libraryItems - 1_000 + 1, last: MAX_SIZE.libraryItems,
        questions: [{ key: "q0", question: "Randomized?" }],
        scoringConfig: { rules: [{ questionKey: "q0", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 1, stars: 5 }], minimumScore: 1 },
        saveTo: { kind: "none" },
      });
      // Its papers are read after it starts: the reading, not the watch on it 15 minutes on.
      vi.advanceTimersByTime(1);
      await t.finishInProgressScheduledFunctions();

      // Newest saved first, so the last 1,000 are the first 1,000 saved, from W999 down.
      const job = await t.run((ctx) => ctx.db.get("screeningJobs", jobId));
      expect(job).toMatchObject({ totalPapers: 1_000, first: 9_001, last: 10_000 });
      const [first] = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1));
      expect(first.openalexId).toBe("https://openalex.org/W999");
    } finally {
      vi.useRealTimers();
    }
  }, 600_000);

  it("a job on a search reuses its page's answers for 1,000 papers at 50 questions, and counts them (#341)", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      setupScreeningWorkpool(t);
      const clerkId = "max_reuse_user";
      const { userId, as } = await seedAccount(t, clerkId);
      await t.run((ctx) => seedCreditsForTest(ctx, { userId, paid: 10_000_000 }));
      const asked = Array.from({ length: MAX_SIZE.questionsPerJob }, (_, i) => `${text(180, i)}?`);
      const ids = Array.from({ length: 1_000 }, (_, i) => `https://openalex.org/W${i}`);
      const at = new Date(Date.UTC(2026, 8, 1)).toISOString();
      const search = { id: "reused", query: "tutoring", field: "title" as const, count: ids.length, queryHistoryCount: 0, questionCount: 0, questionText: "", screeningQuestions: asked.map((question) => ({ question })), screeningResponses: [], createdAt: at, updatedAt: at };
      await as.mutation(api.research.records.change, { accountId: clerkId, requestId: "create", command: { kind: "createSearch", search } });
      const screeningId = await t.run(async (ctx) => {
        const rowWorkspace = await personalWorkspaceOf(ctx, userId);
        const row = (await ctx.db.query("searches").withIndex("by_workspace_and_localId", (q) => q.eq("workspaceId", rowWorkspace).eq("localId", "reused")).unique())!;
        return ctx.db.insert("screenings", { workspaceId: await personalWorkspaceOf(ctx, userId), searchId: row._id, version: 1, createdAt: 1 });
      });
      const answers = asked.map((question) => ({ question, answer: true, setBy: "model" as const, updatedAt: 1, model: { answer: true, confidence: 0.9, at: 1 } }));
      await insertMany(t, "screeningAnswers", ids.map((paperId) => ({ screeningId, paperId, answers, version: 1 })), 100);
      await insertMany(t, "screeningAnswerHistory", ids.map((paperId) => ({ screeningId, paperId, answers, version: 1, at: 1 })), 100);
      const questions = asked.map((question, i) => ({ key: `q${i}`, question }));

      const { jobId } = await createJob(as, {
        set: { kind: "search", searchId: "reused" }, saveTo: { kind: "none" },
        papers: ids.map((openalexId, i) => ({ openalexId, title: text(160, i), abstract: text(2_000, i), authors: Array.from({ length: 8 }, (_, a) => text(24, a)) })),
        questions,
        scoringConfig: { rules: questions.map(({ key }) => ({ questionKey: key, yesPoints: 1, noPoints: 0, nullPoints: 0 })), starThresholds: [{ minScore: 1, stars: 5 }], minimumScore: 1 },
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await as.query(api.screening.queries.getScreeningJob, { jobId })).toMatchObject({
        status: "completed", processedPapers: ids.length, outcomes: { included: ids.length }, credits: { spent: 0, estimate: 0 },
      });
    } finally {
      vi.useRealTimers();
    }
  }, 600_000);

  // A filtered page reads on until it has a page or its allowance of rows runs out; the next read carries on.
  it("an admin search that matches none of 1,200 admins in one read (#636), and a user picker where all 1,200 users are admins, read in steps (#424)", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    const people = Array.from({ length: 1_200 }, (_, i) => `max_admin_${i}`);
    const users = await insertMany(t, "users", people.map((clerkId) => ({ clerkId, email: `${clerkId}@example.org`, firstName: text(12), lastName: text(12, 3), state: "active", createdAt: 1, updatedAt: 1 })));
    // With their search text, as adding an admin writes it.
    await insertMany(t, "admins", [{ email: "max_size_user@example.org", userId, createdAt: 1, searchText: "max_size_user@example.org" }, ...users.map((id, i) => ({ email: `${people[i]}@example.org`, userId: id, createdAt: 1, searchText: `${text(12)} ${text(12, 3)} ${people[i]}@example.org` }))], 200);
    expect(await as.query(api.admins.queries.countAdmins, {})).toBe(1_201);

    const steps = async (read: (cursor: string | null) => Promise<{ page: unknown[]; isDone: boolean; continueCursor: string }>) => {
      let cursor: string | null = null;
      for (let reads = 1; reads <= 5; reads++) {
        const page = await read(cursor);
        expect(page.page).toEqual([]);
        if (page.isDone) return reads;
        cursor = page.continueCursor;
      }
      throw new Error("The list didn't end.");
    };
    expect(await steps((cursor) => as.query(api.admins.queries.listAdmins, { search: "no such person", paginationOpts: { cursor, numItems: 8 } }))).toBe(1);
    expect(await steps((cursor) => as.query(api.admins.queries.listCandidates, { search: "", paginationOpts: { cursor, numItems: 20 } }))).toBe(2);
  }, 300_000);

  it("the admin model list reads, filters and counts a catalog of 2,000 models (#424)", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    await insertMany(t, "admins", [{ email: "max_size_user@example.org", userId, createdAt: 1 }]);
    const providers = ["openai", "anthropic", "google", "qwen", "acme", "zeta"];
    await insertMany(t, "models", Array.from({ length: MAX_CATALOG_MODELS }, (_, i) => ({
      modelId: `${providers[i % providers.length]}/model-${i}`, name: `Model ${i}`, provider: providers[i % providers.length], description: text(2_000, i),
      supportedParameters: Array.from({ length: 20 }, (_, p) => `parameter_${p}`), inputPricePerMillion: 1, outputPricePerMillion: 2,
      isServed: false, costMarkup: 1, sortOrder: i, syncedAt: 1, createdAt: 1, updatedAt: 1,
    })), 500);
    const read = (view: { provider?: string; search: string }) => as.query(api.models.admin.listModels, { ...view, show: "all", paginationOpts: { cursor: null, numItems: 100 } });
    expect((await read({ search: "" })).page).toHaveLength(100);
    // A search with no match reads the whole catalog once.
    expect(await read({ search: "no such model" })).toMatchObject({ page: [], isDone: true });
    // "Other" names the largest providers from the whole catalog, then reads past their models.
    expect((await read({ provider: "other", search: "" })).page.every((m) => /^(acme|zeta)\//.test(m.modelId))).toBe(true);
    expect(await as.query(api.models.admin.summary, { provider: "other", search: "", show: "all" })).toMatchObject({ total: Math.floor(MAX_CATALOG_MODELS / 6) * 2 + (MAX_CATALOG_MODELS % 6 > 4 ? MAX_CATALOG_MODELS % 6 - 4 : 0) });
  }, 300_000);

  it("a 2,000-paper collection of long abstracts moves into an organization a step at a time (#654)", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const { userId, as } = await seedAccount(t, "max_move_user");
      // A step takes the same papers whatever the collection's size, so 2,000 show the steps following one another.
      const items = 2_000;
      const { collectionId } = await seedLibrary(t, userId, { items, abstractChars: 4_500 });
      const lab = await t.run(async (ctx) => {
        const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_move", name: "Lab", slug: "org_move", clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
        await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: "orgmem_move", clerkUserId: "max_move_user", role: "org:admin", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
        return ensureWorkspace(ctx, { kind: "organization", organizationId });
      });

      await as.mutation(api.workspaces.move.move, { kind: "collection", id: collectionId, to: lab });
      await t.finishAllScheduledFunctions(vi.runAllTimers, 1_000);

      // Every paper is saved to the lab's library, and the collection's first and last places are there.
      expect((await t.run((ctx) => ctx.db.query("libraryCounts").withIndex("by_workspace", (q) => q.eq("workspaceId", lab)).unique()))?.count).toBe(items);
      for (const order of ["asc", "desc"] as const) {
        const home = await t.run(async (ctx) => (await ctx.db.get("libraryItems", (await ctx.db.query("libraryItemCollections").withIndex("by_collection", (q) => q.eq("collectionId", collectionId)).order(order).first())!.libraryItemId))?.workspaceId);
        expect(home).toBe(lab);
      }
    } finally {
      vi.useRealTimers();
    }
  }, 900_000);

  it("an organization of 1,000 members re-averages a paper one of them rates, in a transaction of its own (#655)", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const members = Array.from({ length: 1_000 }, (_, i) => `member_${i}`);
      const userIds = await insertMany(t, "users", members.map((clerkId) => ({ clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 })), 250);
      const lab = await t.run(async (ctx) => {
        const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_large", name: "Large", slug: "org_large", clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
        const workspaceId = await ensureWorkspace(ctx, { kind: "organization", organizationId });
        await ctx.db.insert("libraryItems", { workspaceId, createdBy: userIds[0], openalexId: "https://openalex.org/W1", title: "Rated by everyone", searchableText: "Rated by everyone", savedAt: 1, updatedAt: 1 });
        return { organizationId, workspaceId };
      });
      await insertMany(t, "organizationMemberships", members.map((clerkUserId) => ({ organizationId: lab.organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 })), 250, { triggered: false });
      // Every member has rated it 1 to 5.
      const ratings = userIds.map((userId, i) => ({ userId, paperId: "https://openalex.org/W1", rating: (i % 5) + 1 }));
      await insertMany(t, "ratings", ratings, 250);

      // The first member changes theirs to 5: the lab's copy takes the new average.
      await t.withIdentity({ subject: members[0] }).mutation(api.research.records.change, { accountId: members[0], requestId: "rerated", command: { kind: "rating", paperId: "https://openalex.org/W1", rating: 5 } });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const average = (ratings.reduce((sum, row) => sum + row.rating, 0) - ratings[0].rating + 5) / ratings.length;
      expect((await t.run(async (ctx) => ctx.db.query("libraryItems").withIndex("by_workspace", (q) => q.eq("workspaceId", lab.workspaceId)).first()))?.rating).toBe(average);
    } finally {
      vi.useRealTimers();
    }
  }, 300_000);
});
