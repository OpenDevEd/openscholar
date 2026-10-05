/**
 * Each person's Screen all papers run under a limit, and the rest wait their turn (#335),
 * copied from Firecrawl's per-team concurrency (`apps/api/src/lib/concurrency-limit.ts`):
 * jobs are never refused, a job's papers wait in their person's queue, oldest job first,
 * and every paper that finishes lets the next one start. One person's 1,000 papers no
 * longer hold the whole pool while another person's job waits behind them.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { planConcurrency } from "../billing/accounts";
import { ESTIMATED_CREDITS_PER_PAPER } from "../lib/constants";
import { SCREENING_POOL_SIZE, screeningPool } from "../workpool";
import { progressOf } from "./bookkeeping";

/**
 * Papers a person may have running when their plan sets no `concurrency` in Autumn: the
 * whole pool, so one person alone runs as fast as before. Firecrawl falls back the same way.
 */
const DEFAULT_PAPER_CONCURRENCY = SCREENING_POOL_SIZE;

/** How many papers the person may have running at once, never more than the pool. */
export async function paperLimit(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
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
 * What a job with a spending limit has left (#328): how many more of its papers may start,
 * each held at the estimate, with those started and not counted yet held the same way. So
 * papers running together can't spend past the limit between them, as Roo Code checks its
 * cost limit before each request and not after. `taken` is how many this pass started.
 */
type Budget = { job: Doc<"screeningJobs">; progress: Doc<"screeningJobProgress">; room: number; taken: number };

async function budgetOf(ctx: MutationCtx, jobId: Id<"screeningJobs">): Promise<Budget | null> {
  const job = await ctx.db.get("screeningJobs", jobId);
  if (job?.spendCap === undefined) return null;
  const progress = await progressOf(ctx, jobId);
  const affordable = Math.floor((job.spendCap - (progress.credits ?? 0)) / ESTIMATED_CREDITS_PER_PAPER);
  return { job, progress, room: job.capped ? 0 : affordable - (progress.running ?? 0), taken: 0 };
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
    // A paper of a job with a spending limit starts only while the job has room for it, and waits otherwise.
    // ponytail: such a job's waiting papers still fill this pass, so with 20 of them at the head a later job's wait a pass longer.
    const budgets = new Map<Id<"screeningJobs">, Budget | null>();
    for (const result of waiting) {
      if (!budgets.has(result.jobId)) budgets.set(result.jobId, await budgetOf(ctx, result.jobId));
      const budget = budgets.get(result.jobId);
      if (budget && budget.taken >= budget.room) continue;
      await startPaper(ctx, result);
      if (budget) budget.taken++;
      running++;
    }
    for (const budget of budgets.values()) {
      if (!budget) continue;
      if (budget.taken) await ctx.db.patch("screeningJobProgress", budget.progress._id, { running: (budget.progress.running ?? 0) + budget.taken });
      // Nothing left for another paper and none still being read: the job stops here, its waiting papers unread.
      else if (!budget.progress.running && !budget.job.capped) await ctx.scheduler.runAfter(0, internal.screening.mutations.capScreeningJob, { jobId: budget.job._id });
    }
  }
  if (!slots) await ctx.db.insert("screeningSlots", { userId, running });
  else if (slots.running !== running) await ctx.db.patch("screeningSlots", slots._id, { running });
}
