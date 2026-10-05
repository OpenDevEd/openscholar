// One full-size extraction job read page by page. Each search runs from its own test file,
// because Vitest runs a file's tests one after another and this read is the slowest in the suite.
import { convexTest } from "convex-test";
import { getDocumentSize } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { PAPER_LIMIT, RESULTS_PAGE_SIZE_MAX } from "../../lib/extraction/limits";
import { MAX_SIZE, seedAccount, seedExtractionJob, text } from "../lib/maxSize.test-support";

const filters = { searchQuery: "", confidenceRange: [0, 100], statusFilters: [], questionFilters: [] };

export function pagesAFullExtractionJob(searchQuery: string) {
  describe("at the largest sizes the product allows", () => {
    // seedExtractionJob folds the count changes explicitly. No scheduled work is needed for reads.
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });
    it(`pages a full extraction job with search ${JSON.stringify(searchQuery)} by answer and citation bytes without losing papers`, async () => {
      const t = convexTest(schema);
      const { userId, as } = await seedAccount(t);
      const { jobId, paperIds } = await seedExtractionJob(t, userId);
      // Eight citation-heavy papers already exceed one transaction's read budget.
      for (const paperId of paperIds.slice(0, 8)) {
        const ids = await t.run(async ctx => (await ctx.db.query("extractionResults").withIndex("by_paper", q => q.eq("paperId", paperId)).take(50)).map(row => row._id));
        await t.run(async ctx => { for (const id of ids) await ctx.db.patch("extractionResults", id, {
          citations: Array.from({ length: 50 }, (_, i) => ({ source: "pdf" as const, paperId, sourceHash: "a".repeat(64), evidenceId: `page-${i}`, page: i + 1, charRange: [0, 900], quote: text(900, i), retrieval: {}, validated: true })),
        }); });
      }
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let pages = 0; pages <= PAPER_LIMIT; pages++) {
        const read: Awaited<ReturnType<typeof as.query<typeof api.extraction.queries.listJobResults>>> = await as.query(api.extraction.queries.listJobResults, { jobId, filters: { ...filters, searchQuery }, sortBy: "default", paginationOpts: { cursor, numItems: cursor ? RESULTS_PAGE_SIZE_MAX : PAPER_LIMIT } });
        if (!cursor) expect(read.page.length).toBeLessThan(RESULTS_PAGE_SIZE_MAX);
        expect(read.page.length).toBeGreaterThan(0);
        expect(read.page.length).toBeLessThanOrEqual(RESULTS_PAGE_SIZE_MAX);
        expect(read.page.every(paper => paper.results.length === MAX_SIZE.questionsPerJob)).toBe(true);
        expect(getDocumentSize({ page: read.page })).toBeLessThan(8 * 1024 * 1024);
        ids.push(...read.page.map(paper => paper._id));
        for (const paper of read.page) if (paperIds.slice(0, 8).includes(paper._id)) {
          expect(paper.results).toHaveLength(50);
          expect(paper.results.every(result => result.citations.length === 50 && result.citations[49].quote === text(900, 49))).toBe(true);
        }
        if (read.isDone) break;
        cursor = read.continueCursor;
      }
      expect(ids).toHaveLength(PAPER_LIMIT);
      expect(new Set(ids)).toEqual(new Set(paperIds));
      // Selecting a late, small record never hydrates the unselected large answers.
      const selectedPaperIds = [paperIds.at(-1)!];
      const selected = await as.query(api.extraction.queries.listJobResults, { jobId, filters, selectedPaperIds, sortBy: "default", paginationOpts: { cursor: null, numItems: RESULTS_PAGE_SIZE_MAX } });
      expect(selected.page.map(paper => paper._id)).toEqual(selectedPaperIds);
      expect(selected.isDone).toBe(true);
      expect(await as.query(api.extraction.queries.countJobResults, { jobId, filters, selectedPaperIds, includeRevision: true })).toMatchObject({ all: PAPER_LIMIT, matching: 1 });
    }, 300_000);
  });
}
