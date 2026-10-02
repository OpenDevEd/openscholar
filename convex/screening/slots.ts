/**
 * Each person's Screen all papers run under a limit, and the rest wait their turn (#335),
 * copied from Firecrawl's per-team concurrency (`apps/api/src/lib/concurrency-limit.ts`):
 * jobs are never refused, a job's papers wait in their person's queue, oldest job first,
 * and every paper that finishes lets the next one start. One person's 1,000 papers no
 * longer hold the whole pool while another person's job waits behind them.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { planConcurrency } from "../billing/accounts";
import { SCREENING_POOL_SIZE, screeningPool } from "../workpool";

/**
 * Papers a person may have running when their plan sets no `concurrency` in Autumn: the
 * whole pool, so one person alone runs as fast as before. Firecrawl falls back the same way.
 */
const DEFAULT_PAPER_CONCURRENCY = SCREENING_POOL_SIZE;

/** How many papers the person may have running at once, never more than the pool. */
async function paperLimit(ctx: MutationCtx, userId: Id<"users">) {
  const concurrency = (await planConcurrency(ctx, userId)) ?? DEFAULT_PAPER_CONCURRENCY;
  return Math.max(1, Math.min(SCREENING_POOL_SIZE, concurrency));
}

/** Starts one waiting paper: its work goes into the pool. */
async function startPaper(ctx: MutationCtx, result: Doc<"screeningResults">) {
  const workId = await screeningPool.enqueueAction(
    ctx,
    internal.screening.workpoolActions.screenPaperAction,
    { resultId: result._id, jobId: result.jobId },
    { onComplete: internal.screening.mutations.handleScreeningComplete, context: { resultId: result._id, jobId: result.jobId } },
  );
  await ctx.db.patch("screeningResults", result._id, { workId, waitingUser: undefined, waitingSince: undefined });
}

/**
 * Starts the person's waiting papers while they're under their limit, first counting off
 * `finished` papers of theirs that stopped running. Firecrawl's `concurrentJobDone`.
 */
export async function startWaitingPapers(ctx: MutationCtx, userId: Id<"users">, finished = 0) {
  const slots = await ctx.db.query("screeningSlots").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  let running = Math.max(0, (slots?.running ?? 0) - finished);
  const limit = await paperLimit(ctx, userId);
  if (running < limit) {
    // The person's waiting papers, oldest job first, then in each job's order. A paper of a
    // job cancelled a moment ago may start before the job's sweep skips it; it sees the job
    // and stops before asking the model.
    const waiting = await ctx.db
      .query("screeningResults")
      .withIndex("by_waitingUser_and_waitingSince", (q) => q.eq("waitingUser", userId).gte("waitingSince", 0))
      .take(limit - running);
    for (const result of waiting) await startPaper(ctx, result);
    running += waiting.length;
  }
  if (!slots) await ctx.db.insert("screeningSlots", { userId, running });
  else if (slots.running !== running) await ctx.db.patch("screeningSlots", slots._id, { running });
}
