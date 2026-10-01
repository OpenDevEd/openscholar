// The largest sizes the product allows stay within Convex's transaction limits (#350).
// Each flow that is fixed to fit adds its case here.
import { convexTest } from "convex-test";
import { getDocumentSize } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { readEveryLibraryPage } from "../../lib/library/export";
import { RESULTS_PAGE_SIZE_MAX } from "../../lib/extraction/limits";
import { MAX_SIZE, seedAccount, seedExtractionJob, seedLibrary } from "../lib/maxSize.test-support";
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
  }, 120_000);

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
