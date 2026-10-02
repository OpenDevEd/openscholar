/**
 * Folds every waiting extraction count change into its job's counts row, as the counts
 * worker does a moment after a write (./countsWorker.ts), for tests that check a job
 * finishing: it waits until nothing is left to fold.
 */
import type { convexTest } from "convex-test";
import { internal } from "../_generated/api";

export async function foldCounts(t: ReturnType<typeof convexTest>) {
  for (;;) {
    const changes = await t.run(async (ctx) => (await ctx.db.query("extractionCountChanges").take(1_000)).map((change) => change._id));
    if (!changes.length) return;
    await t.mutation(internal.extraction.countsWorker.fold, { changes });
  }
}
