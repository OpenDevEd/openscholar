// The largest sizes the product allows stay within Convex's transaction limits (#350).
// Each flow that is fixed to fit adds its case here.
import { convexTest } from "convex-test";
import { getDocumentSize } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { readEveryResultsPage } from "../../lib/extraction/export";
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

  it("a 1,000-paper, 50-question extraction job exports page by page", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    const { jobId } = await seedExtractionJob(t, userId);
    // Asking for more than the largest page gets the largest page.
    const first = await as.query(api.extraction.queries.getJobResultsPage, { jobId, page: 1, pageSize: MAX_SIZE.papersPerJob, filters, sortBy: "default" });
    expect(first.items).toHaveLength(RESULTS_PAGE_SIZE_MAX);
    const papers = await readEveryResultsPage((page) => as.query(api.extraction.queries.getJobResultsPage, { jobId, page, pageSize: RESULTS_PAGE_SIZE_MAX, filters, sortBy: "default" }));
    expect(papers).toHaveLength(MAX_SIZE.papersPerJob);
    expect(papers.every((paper) => paper.results.length === MAX_SIZE.questionsPerJob)).toBe(true);
    // A search reads only its matches, so its largest page fits too.
    const searched = await readEveryResultsPage((page) => as.query(api.extraction.queries.getJobResultsPage, { jobId, page, pageSize: RESULTS_PAGE_SIZE_MAX, filters: { ...filters, searchQuery: "tutoring" }, sortBy: "default" }));
    expect(searched.length).toBeGreaterThan(RESULTS_PAGE_SIZE_MAX);
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
