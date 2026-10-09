/**
 * Each workspace's Screen all papers run under a limit, and the rest wait their turn (#335,
 * one pool per workspace since #650), copied from Firecrawl's per-team concurrency
 * (`apps/api/src/lib/concurrency-limit.ts`): jobs are never refused, a job's papers wait in
 * their workspace's queue, oldest job first, and every paper that finishes lets the next one
 * start. One workspace's 1,000 papers no longer hold the whole pool while another's job waits.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { planLimit } from "../billing/accounts";
import { pricingOf } from "../ai/serverModel";
import { screeningPaperCredits } from "../../lib/pricing";
import { SCREENING_POOL_SIZE, screeningPool } from "../workpool";
import { progressOf } from "./bookkeeping";

/**
 * Papers a person may have running when their plan sets no `concurrency` in Autumn: the
 * whole pool, so one person alone runs as fast as before. Firecrawl falls back the same way.
 */
const DEFAULT_PAPER_CONCURRENCY = SCREENING_POOL_SIZE;

/** How many papers a workspace may have running at once, never more than the pool. */
export async function paperLimit(ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">) {
  const concurrency = (await planLimit(ctx, workspaceId, "concurrency")) ?? DEFAULT_PAPER_CONCURRENCY;
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
  await ctx.db.patch("screeningResults", result._id, { workId, waitingUser: undefined, waitingWorkspace: undefined, waitingSince: undefined });
}

/**
 * What a job with a spending limit has left (#328): how many more of its papers may start,
 * each held at the most a paper costs on the job's model, with those started and not counted yet held the same way. So
 * papers running together can't spend past the limit between them, as Roo Code checks its
 * cost limit before each request and not after. `taken` is how many this pass started.
 */
type Budget = { job: Doc<"screeningJobs">; progress: Doc<"screeningJobProgress">; room: number; taken: number };

async function budgetOf(ctx: MutationCtx, jobId: Id<"screeningJobs">): Promise<Budget | null> {
  const job = await ctx.db.get("screeningJobs", jobId);
  if (job?.spendCap === undefined) return null;
  const progress = await progressOf(ctx, jobId);
  const affordable = Math.floor((job.spendCap - (progress.credits ?? 0)) / screeningPaperCredits(await pricingOf(ctx, job.serverModelId)));
  return { job, progress, room: job.capped ? 0 : affordable - (progress.running ?? 0), taken: 0 };
}

/**
 * Starts a workspace's waiting papers while it's under its limit, first counting off
 * `finished` papers of its that stopped running. Firecrawl's `concurrentJobDone`.
 */
export async function startWaitingPapers(ctx: MutationCtx, workspaceId: Id<"workspaces">, finished = 0) {
  const slots = await ctx.db.query("screeningSlots").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
  let running = Math.max(0, (slots?.running ?? 0) - finished);
  const limit = await paperLimit(ctx, workspaceId);
  if (running < limit) {
    // The workspace's waiting papers, oldest job first, then in each job's order. A paper of a
    // job cancelled a moment ago may start before the job's sweep skips it; it sees the job
    // and stops before asking the model.
    const waiting = await ctx.db
      .query("screeningResults")
      .withIndex("by_waitingWorkspace_and_waitingSince", (q) => q.eq("waitingWorkspace", workspaceId).gte("waitingSince", 0))
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
  if (!slots) await ctx.db.insert("screeningSlots", { workspaceId, running });
  else if (slots.running !== running) await ctx.db.patch("screeningSlots", slots._id, { running });
}
