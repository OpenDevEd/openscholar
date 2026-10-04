/**
 * Folds every waiting extraction count change into its job's counts row, as the counts
 * worker does a moment after a write (./countsWorker.ts), for tests that check a job
 * finishing: it waits until nothing is left to fold.
 */
import type { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";
import { addInto, countsRow, errorBuckets, paperBuckets, resultBuckets, waitingDeltas, type Counts } from "./counts";

export async function foldCounts(t: ReturnType<typeof convexTest>) {
  for (;;) {
    const changes = await t.run(async (ctx) => (await ctx.db.query("extractionCountChanges").take(1_000)).map((change) => change._id));
    if (!changes.length) return;
    await t.mutation(internal.extraction.countsWorker.fold, { changes });
  }
}

const nonZero = (counts: Counts) => JSON.stringify(Object.fromEntries(Object.entries(counts).filter(([, n]) => n !== 0).sort()));

/**
 * The jobs whose counts row, with the changes still waiting for the worker, differs from a
 * recount of their rows: none when the counts are right. For jobs small enough to read whole.
 */
export async function countMismatches(t: ReturnType<typeof convexTest>): Promise<string[]> {
  return await t.run(async (untyped) => {
    // A test's `t` isn't tied to the schema; the reads here are.
    const ctx = untyped as unknown as QueryCtx;
    const problems: string[] = [];
    for (const job of await ctx.db.query("extractionJobs").take(50)) {
      const expected: Counts = {};
      const tally = (buckets: string[]) => addInto(expected, Object.fromEntries(buckets.map((bucket) => [bucket, 1])));
      for (const paper of await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(2_000)) tally(paperBuckets(paper));
      for (const result of await ctx.db.query("extractionResults").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(8_000)) tally(resultBuckets(result));
      for (const error of await ctx.db.query("extractionPaperErrors").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(8_000)) tally(errorBuckets(error));
      const kept = { ...(await countsRow(ctx, job._id))?.counts };
      addInto(kept, (await waitingDeltas(ctx, job._id)) ?? {});
      if (nonZero(kept) !== nonZero(expected)) problems.push(`${job._id}: counted ${nonZero(kept)}, rows say ${nonZero(expected)}`);
    }
    return problems;
  });
}
