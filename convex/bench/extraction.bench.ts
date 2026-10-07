// What reading an extraction job costs as it grows (#631, #634): its results page with and without
// filters, a search, a filtered count, a per-question summary, and an export, at each size.
import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, it, vi } from "vitest";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { countJobResultsAction, listJobResultsAction, summarizeJobResultsAction } from "../extraction/queries/results";
import { seedAccount, seedExtractionJob, text } from "../lib/maxSize.test-support";
import { measure, now, record, save } from "./measure.test-support";
import { writeAnswerRows, writePaperFacts } from "../extraction/listProjection";

/** Writes each paper's answer rows and facts as the list projection does when its results land. */
async function project(t: ReturnType<typeof convexTest>, paperIds: Array<Id<"extractionPapers">>) {
  for (let i = 0; i < paperIds.length; i += 200) {
    await t.run(async (ctx: any) => {
      for (const id of paperIds.slice(i, i + 200)) {
        const paper = (await ctx.db.get(id))!;
        const results = await ctx.db.query("extractionResults").withIndex("by_paper", (q: any) => q.eq("paperId", id)).take(10);
        await writeAnswerRows(ctx as never, paper, results, true);
        await writePaperFacts(ctx as never, paper);
      }
    });
  }
}

const SIZES = (process.env.BENCH_SIZES ?? "1000,5000,10000").split(",").map(Number);
const PAGE = 50;
const EXPORT_PAGE = 200;
const all = { searchQuery: "", confidenceRange: [0, 100], statusFilters: [] as string[], questionFilters: [] as Array<{ questionKey: string; value: string }> };

describe("extraction reads by job size", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  afterAll(() => save(__filename));

  for (const size of SIZES) {
    it(`${size} papers`, async () => {
      const t = convexTest(schema);
      const { userId } = await seedAccount(t);
      const { jobId, paperIds } = await seedExtractionJob(t, userId, { papers: size, questions: 2 });
      await project(t, paperIds);
      const at = (scenario: string) => ({ area: "extraction", scenario, size });
      const page = (filters: typeof all, sortBy = "default", cursor: string | null = null, numItems = PAGE) =>
        (ctx: any) => listJobResultsAction.run(ctx, userId, { jobId, filters, sortBy: sortBy as never, paginationOpts: { cursor, numItems } });
      const rows = (read: { page: unknown[] } | undefined) => `${read?.page.length ?? 0} rows`;

      await measure(t, at("results page, no filter"), page(all), rows);
      // A filter nothing matches reads as far as the page can go: the worst case for a filter applied in code.
      // Nothing matches: the right answer is an empty last page.
      await measure(t, at("results page, filter matching none"), page({ ...all, confidenceRange: [0, 10] }), (r) => `${rows(r)}${r?.isDone ? "" : ", not done"}`, (r) => r.page.length === 0 && r.isDone);
      // About one paper in ten gives each answer.
      await measure(t, at("results page, answer filter"), page({ ...all, questionFilters: [{ questionKey: "q0", value: text(120, 0).trim() }] }), rows);
      await measure(t, at("results page, sorted by title"), page(all, "title-asc"), rows);
      await measure(t, at("results page, text search"), page({ ...all, searchQuery: "tutoring" }), rows, (r) => r.page.length === PAGE);
      await measure(t, at("filtered count"), (ctx) => countJobResultsAction.run(ctx, userId, { jobId, filters: { ...all, confidenceRange: [0, 10] } }), (r) => `${r.matching} of ${r.all}`, (r) => r.all === size && r.matching === 0);
      await measure(t, at("summary of one question"), (ctx) => summarizeJobResultsAction.run(ctx, userId, { jobId, questionKey: "q0" }), (r) => `${r.papers} papers`, (r) => r.papers === size);

      // An export reads every page in turn: how many calls it takes, the most one of them reads, and whether it finishes.
      let cursor: string | null = null;
      let calls = 0;
      let most = { documentsRead: 0, bytesRead: 0 };
      let exported = 0;
      const started = now();
      let ok = true;
      let error: string | undefined;
      do {
        let read: { page: unknown[]; isDone: boolean; continueCursor: string } | undefined;
        const before = { documentsRead: 0, bytesRead: 0 };
        try {
          const result = await t.run(async (ctx) => {
            const out = await page(all, "default", cursor, EXPORT_PAGE)(ctx);
            const m = JSON.parse(await (globalThis as any).Convex.asyncSyscall("1.0/getTransactionMetrics", "{}"));
            return { out, m };
          });
          read = result.out;
          before.documentsRead = result.m.documentsRead.used;
          before.bytesRead = result.m.bytesRead.used;
        } catch (thrown) {
          ok = false;
          error = `call ${calls + 1}: ${String((thrown as Error).message ?? thrown).split("\n")[0]}`;
          break;
        }
        calls += 1;
        exported += read!.page.length;
        most = { documentsRead: Math.max(most.documentsRead, before.documentsRead), bytesRead: Math.max(most.bytesRead, before.bytesRead) };
        cursor = read!.isDone ? null : read!.continueCursor;
      } while (cursor !== null);
      record({ ...at("export, every page"), ok: ok && exported === size, ...most, ms: Math.round(now() - started), result: `${exported} papers in ${calls} calls`, ...(error ? { error } : {}) });
    });
  }
});
