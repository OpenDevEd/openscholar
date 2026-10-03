// The largest sizes the product allows stay within Convex's transaction limits (#350).
// Each flow that is fixed to fit adds its case here.
import { convexTest } from "convex-test";
import { getDocumentSize } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { readEveryLibraryPage } from "../../lib/library/export";
import { RESULTS_PAGE_SIZE_MAX } from "../../lib/extraction/limits";
import { collectionSortName } from "../library/collections";
import { MAX_COLLECTIONS_PER_USER } from "../lib/queryBounds";
import { MAX_SIZE, insertMany, seedAccount, seedExtractionJob, seedLibrary, text } from "../lib/maxSize.test-support";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { assertApprovedQueriesUnchanged } from "../evidenceLibraries/approvedQueries";
import { isAcceptableSavedConfigurationTarget } from "../evidenceLibraries/operations";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { setupExtractionPaperWorkpool } from "../extraction/queue/workpool.test-support";

const filters = { searchQuery: "", confidenceRange: [0, 100], statusFilters: [], questionFilters: [] };

describe("at the largest sizes the product allows", () => {
  it("a 1,000-paper, 50-question extraction job opens its results page and details", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    const { jobId } = await seedExtractionJob(t, userId);
    const page = await as.query(api.extraction.queries.getJobResultsPage, { jobId, page: 1, pageSize: 25, filters, sortBy: "default" });
    expect(page).toMatchObject({ status: "ok", totalAll: MAX_SIZE.papersPerJob });
    expect(page.items).toHaveLength(25);
    const details = await as.query(api.extraction.queries.getJobDetails, { jobId });
    expect(details).toMatchObject({ status: "ok" });
  }, 300_000);

  // An export reads the job page by page (lib/extraction/export.ts); the largest page,
  // searched or not, is the most any one read takes.
  it("a 1,000-paper, 50-question extraction job reads its largest export page", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    const { jobId } = await seedExtractionJob(t, userId);
    const page = (searchQuery: string, pageSize: number) =>
      as.query(api.extraction.queries.getJobResultsPage, { jobId, page: 1, pageSize, filters: { ...filters, searchQuery }, sortBy: "default" });
    // Asking for more than the largest page gets the largest page.
    const whole = await page("", MAX_SIZE.papersPerJob);
    expect(whole.items).toHaveLength(RESULTS_PAGE_SIZE_MAX);
    expect(whole.items.every((paper) => paper.results.length === MAX_SIZE.questionsPerJob)).toBe(true);
    // A search reads only its matches, so its largest page fits too.
    expect((await page("tutoring", RESULTS_PAGE_SIZE_MAX)).items).toHaveLength(RESULTS_PAGE_SIZE_MAX);
  }, 300_000);

  it("a 1,000-paper, 50-question extraction job shows its progress and retry summaries", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    const { jobId } = await seedExtractionJob(t, userId);
    const results = MAX_SIZE.papersPerJob * MAX_SIZE.questionsPerJob;
    expect(await as.query(api.extraction.queries.mixedSuccessSummary.getMixedSuccessSummary, { jobId })).toMatchObject({ answeredTotal: results, totalQuestions: results });
    expect(await as.query(api.extraction.queries.retry.getRetryableSummary, { jobId })).toEqual({ retryableCount: 0, permanentCount: 0, permanentBreakdown: {} });
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
      expect(await as.query(api.extraction.queries.retry.getRetryableSummary, { jobId })).toMatchObject({ retryableCount: 0 });
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
  }, 120_000);

  it("a person's 500 collections page by name, each checked for a saved paper", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    // seedLibrary makes the first collection, which holds its paper.
    await seedLibrary(t, userId, { items: 1 });
    await insertMany(t, "collections", Array.from({ length: MAX_COLLECTIONS_PER_USER - 1 }, (_, i) => {
      const name = `Reading list ${i}: ${text(200, i)}`;
      return { userId, name, sortName: collectionSortName(name), itemCount: 0, createdAt: 1, updatedAt: 1 };
    }));
    await t.run((ctx) => ctx.db.insert("collectionCounts", { userId, count: MAX_COLLECTIONS_PER_USER }));
    expect(await as.query(api.library.collections.countCollections, {})).toBe(MAX_COLLECTIONS_PER_USER);
    // Asking for more than the largest page gets the largest page.
    const page = await as.query(api.library.collections.listCollections, { paginationOpts: { cursor: null, numItems: MAX_COLLECTIONS_PER_USER }, openalexId: "https://openalex.org/W0" });
    expect(page.page).toHaveLength(50);
    expect(page.isDone).toBe(false);
    expect(page.page.filter((collection) => collection.containsItem).map((collection) => collection.name)).toEqual(["Everything"]);
    const searched = await as.query(api.library.collections.listCollections, { paginationOpts: { cursor: null, numItems: 50 }, search: "tutoring" });
    expect(searched.page).toHaveLength(50);
  }, 120_000);

  it("a 10,000-paper library shows, counts and exports every filter", async () => {
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
    for (const view of views) {
      const page = await as.query(api.library.queries.browseLibrary, { ...view, paginationOpts: { cursor: null, numItems: 20 } });
      const count = await as.query(api.library.queries.getLibraryFilteredCount, view);
      if (count.capped) expect(count.count).toBe(1_000);
      else expect(page.isDone ? page.page.length : Infinity).toBeGreaterThanOrEqual(count.count);
    }
    expect(await as.query(api.library.queries.getLibraryFilteredCount, { ...sorted, collectionId })).toEqual({ count: MAX_SIZE.libraryItems, capped: false });
    expect(await as.query(api.library.queries.getLibraryFilteredCount, { ...sorted, minRating: 5, yearTo: 1990 })).toEqual({ count: 0, capped: false });
    const exported = await readEveryLibraryPage((cursor) => as.query(api.library.queries.browseLibrary, { ...sorted, minRating: 2, paginationOpts: { cursor, numItems: 500 } }));
    expect(exported).toHaveLength(MAX_SIZE.libraryItems * 0.8);
  }, 300_000);

  it("a 10,000-paper library of long abstracts counts a filter that matches nothing", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    await seedLibrary(t, userId, { abstractChars: 4_500 });
    // Rating 4 and up never meets year 1990 in the seed: the count reads past 4,000 large papers.
    const count = await as.query(api.library.queries.getLibraryFilteredCount, { sortBy: "savedAt", sortOrder: "desc", minRating: 4, yearTo: 1990 });
    expect(count).toEqual({ count: 0, capped: true });
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
    const page = await as.query(api.research.records.searches, { accountId: clerkId, paginationOpts });
    expect(page.page).toHaveLength(25);
    expect(page.page.find((row) => row.id === "search-0")?.queryHistoryCount).toBe(201);
    expect((await as.query(api.research.records.revisions, { accountId: clerkId, id: "search-0", paginationOpts })).page).toHaveLength(25);
    const history = await as.query(api.research.records.searchHistory, { accountId: clerkId, id: "search-0", kind: "query", paginationOpts: { cursor: null, numItems: 100 } });
    expect(history.page).toHaveLength(100);
    expect(history.page[0].text).toBe(query(1200));
  }, 300_000);

  it("a search saved before #354 with 44 revisions of the longest OQL query lists every revision (#354)", async () => {
    const t = convexTest({ schema, transactionLimits: true });
    const clerkId = "max_size_user";
    const { userId, as } = await seedAccount(t, clerkId);
    // Each revision then held the whole history: the 44th, 44 copies of the query.
    const queryHistory = Array.from({ length: 44 }, (_, i) => ({ query: `${i} ${text(MAX_SIZE.oqlQueryChars - 6, i)}`, field: "oql" as const, timestamp: "2026-09-01T00:00:00.000Z" }));
    const data = (revision: number) => ({ id: "legacy", query: queryHistory[revision - 1].query, field: "oql" as const, count: 1, queryHistory: queryHistory.slice(0, revision), questionHistory: [], screeningQuestions: [], screeningResponses: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" });
    const searchId = await t.run((ctx) => ctx.db.insert("searches", { userId, localId: "legacy", data: data(44), revision: 44 }));
    for (let revision = 1; revision <= 44; revision++) await t.run((ctx) => ctx.db.insert("searchRevisions", { userId, searchId, revision, author: "user", data: data(revision), deleted: false, createdAt: revision }));
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
    const searchId = await t.run((ctx) => ctx.db.insert("searches", { userId, localId: "long", data: { id: "long", query: "q", field: "oql", count: 1, queryHistoryCount: 450, questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }, revision: 1 }));
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
        organizationId: (await ctx.db.get("evidenceLibraries", libraryId))!.organizationId,
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
      await insertMany(fixture.t, "users", people.map((clerkId) => ({ clerkId, email: `${clerkId}@example.org`, state: "active", libraryItemCount: 0, createdAt: 1, updatedAt: 1 })));
      await insertMany(fixture.t, "organizationMemberships", people.map((clerkUserId, i) => ({ organizationId, clerkMembershipId: `orgmem_max_${i}`, clerkUserId, role: "org:member", state: "active", ...stamp })));
      await insertMany(fixture.t, "evidenceLibraryMembers", people.map((clerkUserId) => ({ libraryId, clerkUserId, role: "editor", grantedBy: "user_max_admin", grantedAt: 1 })));
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
});
