/**
 * Lets the work that runs a moment after a write catch up, for tests that read what it keeps:
 * extraction job counts and answer tallies, folded by their workers, and the aggregates'
 * queued count writes (./countQueue.ts), applied by theirs. The aggregates' workers wait a
 * moment between batches, so they run on fake timers.
 */
import type { convexTest } from "convex-test";
import { vi } from "vitest";
import { internal } from "../_generated/api";
import { foldCounts } from "../extraction/counts.test-support";

export async function catchUp(t: ReturnType<typeof convexTest>) {
  await foldCounts(t);
  for (;;) {
    const changes = await t.run(async (ctx) => (await ctx.db.query("extractionTallyChanges").take(1_000)).map((change) => change._id));
    if (!changes.length) break;
    await t.mutation(internal.extraction.talliesWorker.fold, { changes });
  }
  const faked = vi.isFakeTimers();
  if (!faked) vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers, 10_000);
  } finally {
    if (!faked) vi.useRealTimers();
  }
}
