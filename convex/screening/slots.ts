/**
 * Each workspace's Screen all papers run under a limit, and the rest wait their turn (#335,
 * one pool per workspace since #650), copied from Firecrawl's per-team concurrency
 * (`apps/api/src/lib/concurrency-limit.ts`): jobs are never refused, a job's papers wait in
 * their workspace's queue, oldest job first, and every paper that finishes lets the next one
 * start. One workspace's 1,000 papers no longer hold the whole pool while another's job waits.
 */
import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { planLimit } from "../billing/accounts";
import { pricingOf } from "../ai/serverModel";
import { screeningPaperCredits } from "../../lib/pricing";
import { SCREENING_POOL_SIZE, screeningPool } from "../workpool";
import { progressOf } from "./bookkeeping";
import type { startFactsValidator } from "./validators";

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

/**
 * Starts waiting papers: their work goes into the pool in one call, which costs about what one
 * paper's used to (#796). The pool's callback finds each paper by its work.
 */
async function startPapers(ctx: MutationCtx, results: Doc<"screeningResults">[]) {
  if (!results.length) return;
  const workIds = await screeningPool.enqueueActionBatch(
    ctx,
    internal.screening.workpoolActions.screenPaperAction,
    results.map((result) => ({ resultId: result._id, jobId: result.jobId })),
    { onComplete: internal.screening.mutations.handleScreeningComplete, context: {} },
  );
  for (const [i, result] of results.entries()) await ctx.db.patch("screeningResults", result._id, { workId: workIds[i], waitingWorkspace: undefined, waitingSince: undefined });
}

/**
 * A workspace's first waiting papers, oldest job first, then in each job's order. A paper of a
 * job cancelled a moment ago may start before the job's sweep skips it; it sees the job
 * and stops before asking the model.
 */
const waitingPapers = (ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">, most: number) =>
  ctx.db
    .query("screeningResults")
    .withIndex("by_waitingWorkspace_and_waitingSince", (q) => q.eq("waitingWorkspace", workspaceId).gte("waitingSince", 0))
    .take(Math.min(most, SCREENING_POOL_SIZE));

type StartFacts = Infer<typeof startFactsValidator>;

/**
 * Reads what a pass over each of `workspaceIds` needs (./validators.ts). A job's spending limit
 * is set when it's made and never added later, so one read as having none still has none.
 */
export async function readStartFacts(ctx: QueryCtx, workspaceIds: Id<"workspaces">[]): Promise<StartFacts> {
  const limits = await Promise.all(workspaceIds.map(async (workspaceId) => ({ workspaceId, limit: await paperLimit(ctx, workspaceId) })));
  const uncapped = new Set<Id<"screeningJobs">>();
  for (const { workspaceId, limit } of limits) {
    const waiting = await waitingPapers(ctx, workspaceId, limit);
    for (const jobId of new Set(waiting.map((result) => result.jobId))) {
      if ((await ctx.db.get("screeningJobs", jobId))?.spendCap === undefined) uncapped.add(jobId);
    }
  }
  return { limits, uncapped: [...uncapped] };
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
 * `finished` papers of its that stopped running. Firecrawl's `concurrentJobDone`. With `facts`,
 * read by the bookkeeping worker's query, it reads neither the workspace's account nor an
 * uncapped job; without them, as when a job's papers are made, it reads both itself.
 * ponytail: the limit in `facts` is a moment old, so a plan that drops during a pass is seen by the
 * next one, and that pass's papers finish above it, as the ones already running always did. Keep
 * the limit on the slots row, written when the plan changes, if a drop must hold within the pass.
 */
export async function startWaitingPapers(ctx: MutationCtx, workspaceId: Id<"workspaces">, finished = 0, facts?: StartFacts) {
  const slots = await ctx.db.query("screeningSlots").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
  let running = Math.max(0, (slots?.running ?? 0) - finished);
  const limit = facts?.limits.find((row) => row.workspaceId === workspaceId)?.limit ?? (await paperLimit(ctx, workspaceId));
  if (running < limit) {
    const waiting = await waitingPapers(ctx, workspaceId, limit - running);
    // A paper of a job with a spending limit starts only while the job has room for it, and waits otherwise.
    // ponytail: such a job's waiting papers still fill this pass, so with 20 of them at the head a later job's wait a pass longer.
    const budgets = new Map<Id<"screeningJobs">, Budget | null>();
    const started = new Map<Id<"screeningJobs">, number>();
    const starting: Doc<"screeningResults">[] = [];
    for (const result of waiting) {
      if (!budgets.has(result.jobId)) budgets.set(result.jobId, facts?.uncapped.includes(result.jobId) ? null : await budgetOf(ctx, result.jobId));
      const budget = budgets.get(result.jobId);
      if (budget && budget.taken >= budget.room) continue;
      starting.push(result);
      if (budget) budget.taken++;
      started.set(result.jobId, (started.get(result.jobId) ?? 0) + 1);
      running++;
    }
    await startPapers(ctx, starting);
    // Each job's papers in a slot, until the bookkeeping counts them off: what its page shows as being read, and what a spending limit holds.
    for (const [jobId, taken] of started) {
      const progress = budgets.get(jobId)?.progress ?? (await progressOf(ctx, jobId));
      await ctx.db.patch("screeningJobProgress", progress._id, { running: (progress.running ?? 0) + taken });
    }
    for (const budget of budgets.values()) {
      // Nothing left for another paper and none still being read: the job stops here, its waiting papers unread.
      if (budget && !budget.taken && !budget.progress.running && !budget.job.capped) await ctx.scheduler.runAfter(0, internal.screening.mutations.capScreeningJob, { jobId: budget.job._id });
    }
  }
  if (!slots) await ctx.db.insert("screeningSlots", { workspaceId, running });
  else if (slots.running !== running) await ctx.db.patch("screeningSlots", slots._id, { running });
}

/** A workspace's first waiting readings of screenings with reviewers: oldest screening first, then in each one's order. */
const waitingVotes = (ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">, most: number) =>
  ctx.db
    .query("screeningVotes")
    .withIndex("by_waitingWorkspace_and_waitingSince", (q) => q.eq("waitingWorkspace", workspaceId).gte("waitingSince", 0))
    .take(Math.min(most, SCREENING_POOL_SIZE));

/**
 * `startWaitingPapers` for screenings with reviewers (plans/screening-reviewers), where the unit of work is one
 * model's reading of one paper: a row of `screeningVotes`. They share the workspace's slots with every other paper
 * it has running. The work goes into the pool in one call, and the pool's callback finds each reading by its work.
 */
export async function startWaitingVotes(ctx: MutationCtx, workspaceId: Id<"workspaces">, finished = 0, facts?: StartFacts) {
  const slots = await ctx.db.query("screeningSlots").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
  let running = Math.max(0, (slots?.running ?? 0) - finished);
  const limit = facts?.limits.find((row) => row.workspaceId === workspaceId)?.limit ?? (await paperLimit(ctx, workspaceId));
  if (running < limit) {
    const waiting = await waitingVotes(ctx, workspaceId, limit - running);
    if (waiting.length) {
      const workIds = await screeningPool.enqueueActionBatch(ctx, internal.screening.reading.readPaper, waiting.map((vote) => ({ voteId: vote._id })), { onComplete: internal.screening.readings.done, context: {} });
      for (const [i, vote] of waiting.entries()) await ctx.db.patch("screeningVotes", vote._id, { workId: workIds[i], slot: true, waitingWorkspace: undefined, waitingSince: undefined });
      const started = new Map<Id<"screeningJobs">, number>();
      for (const vote of waiting) started.set(vote.jobId, (started.get(vote.jobId) ?? 0) + 1);
      for (const [jobId, taken] of started) {
        const progress = await progressOf(ctx, jobId);
        await ctx.db.patch("screeningJobProgress", progress._id, { running: (progress.running ?? 0) + taken });
      }
      running += waiting.length;
    }
  }
  if (!slots) await ctx.db.insert("screeningSlots", { workspaceId, running });
  else if (slots.running !== running) await ctx.db.patch("screeningSlots", slots._id, { running });
}
