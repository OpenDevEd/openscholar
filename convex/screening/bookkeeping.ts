/**
 * Screen all's bookkeeping, done in batches by one worker (`@convex-dev/batch-worker`), the
 * way Firecrawl queues its billing operations and commits them from one batch process. A
 * finished paper writes only its own result row, stamped with `doneAt`, and pings the queue.
 * The worker then, a batch at a time:
 * - moves the papers' answers into the job's screening;
 * - scores each on its answers as they stand there, counts the job's finished papers into
 *   its progress row (./accounting.ts), and finishes the job;
 * - saves the qualified papers to the person's library;
 * - starts the person's next waiting papers in the slots the finished ones freed (./slots.ts).
 * Papers finishing together never write the same document; only the worker writes these.
 */
import { defineBatchWorkerValidators, ping } from "@convex-dev/batch-worker";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../lib/functions";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { upsertLibraryItem } from "../library/mutations";
import { addCollectionMembership } from "../library/collectionMembership";
import { moveResultAnswers } from "./drain";
import { account, FAILED, standing, withDeltas, type Delta } from "./accounting";
import { startWaitingPapers } from "./slots";

/** Papers per batch: each moves its answers and may save a library item, a few dozen reads. */
const BATCH = 50;

const { vQueryArgs, vQueryReturns, vMutationArgs, vMutationReturns } = defineBatchWorkerValidators({
  batch: { results: v.array(v.id("screeningResults")) },
});

/** When a waiting paper finished; a read value is always the resolved timestamp. */
const doneAtOf = (result: Doc<"screeningResults">) => result.doneAt as bigint | undefined;

/** Wakes the worker for papers just stamped `doneAt`. Costs a read while it's already running. */
export async function bookkeepLater(ctx: MutationCtx) {
  await ping(ctx, components.batchWorker, {
    name: "screening",
    workQuery: internal.screening.bookkeeping.nextFinished,
    workerMutation: internal.screening.bookkeeping.bookkeep,
    // A burst of papers finishing together goes into one batch.
    config: { debounceMs: 200 },
  });
}

/**
 * The next papers waiting to be bookkept, in commit order. The worker clears a paper's
 * `doneAt` once it's handled, so the queue's index holds only waiting papers, and a scan
 * from the last commit picks up papers that finished in it but didn't fit the batch.
 */
export const nextFinished = internalQuery({
  args: vQueryArgs,
  returns: vQueryReturns,
  handler: async (ctx, { cursor }) => {
    const rows = await ctx.db
      .query("screeningResults")
      .withIndex("by_doneAt", (q) => q.gte("doneAt", cursor ?? 0n))
      .take(BATCH);
    const last = rows.length ? doneAtOf(rows.at(-1)!) : undefined;
    if (last === undefined) return { kind: "idle" as const };
    return { kind: "work" as const, batch: { results: rows.map((row) => row._id) }, cursor: last };
  },
});

type Counts = Pick<Doc<"screeningJobProgress">, "completed" | "skipped" | "failed" | "qualified">;
const ZERO: Counts = { completed: 0, skipped: 0, failed: 0, qualified: 0 };

function tally(results: Doc<"screeningResults">[]): Counts {
  const counts = { ...ZERO };
  for (const result of results) {
    if (result.status === "completed" || result.status === "skipped" || result.status === "failed") counts[result.status]++;
    if (result.status === "completed" && result.qualified === true) counts.qualified++;
  }
  return counts;
}

export async function progressRow(ctx: QueryCtx | MutationCtx, jobId: Id<"screeningJobs">) {
  return await ctx.db
    .query("screeningJobProgress")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .unique();
}

/**
 * Counts a job's papers that are already bookkept, or finished before the worker kept its
 * progress (both have no `doneAt`). Papers still waiting are counted when their batch comes.
 */
export async function countBookkept(ctx: QueryCtx | MutationCtx, jobId: Id<"screeningJobs">) {
  const results = await ctx.db
    .query("screeningResults")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .take(MAX_SCREENING_PAPERS_PER_JOB);
  return tally(results.filter((result) => result.doneAt === undefined));
}

/**
 * A job's progress row. A job from before the worker kept one gets it counted from its
 * bookkept papers, so read it before changing what one of them counts as.
 */
export async function progressOf(ctx: MutationCtx, jobId: Id<"screeningJobs">) {
  return (await progressRow(ctx, jobId)) ?? (await ctx.db.get("screeningJobProgress", await ctx.db.insert("screeningJobProgress", { jobId, ...(await countBookkept(ctx, jobId)) })))!;
}

/**
 * Adds a batch's papers to their job's progress: how many finished and how. What each adds
 * to the qualified and unclear counts and the questions' tallies is `deltas`
 * (./accounting.ts).
 */
async function countFinished(ctx: MutationCtx, job: Doc<"screeningJobs">, results: Doc<"screeningResults">[], deltas: Delta[]) {
  const row = await progressOf(ctx, job._id);
  const add = tally(results);
  await ctx.db.patch("screeningJobProgress", row._id, {
    completed: row.completed + add.completed,
    skipped: row.skipped + add.skipped,
    failed: row.failed + add.failed,
    ...withDeltas(row, job, deltas),
  });
}

/** Saves a qualified paper to the person's library and the job's collection; saving one already there changes nothing. */
export async function saveQualified(ctx: MutationCtx, job: Doc<"screeningJobs">, result: Doc<"screeningResults">) {
  const libraryItemId = await upsertLibraryItem(
    ctx,
    job.userId,
    {
      openalexId: result.openalexId,
      title: result.title,
      authors: result.authors?.join(", "),
      doi: result.doi,
      abstract: result.abstract,
      publicationYear: result.publicationYear,
    },
    result.stars ?? 0,
  );
  const collection = job.targetCollectionId ? await ctx.db.get("collections", job.targetCollectionId) : null;
  if (collection) await addCollectionMembership(ctx, { userId: job.userId, collection, libraryItemId });
  await ctx.db.patch("screeningResults", result._id, { savedToLibrary: true, libraryItemId });
}

/**
 * Gives a job its progress row, counted from its bookkept papers, when it has none, and
 * finishes it if that counts every paper: for jobs whose last papers finished before the
 * worker, which nothing else would finish.
 */
export async function ensureProgress(ctx: MutationCtx, jobId: Id<"screeningJobs">) {
  await progressOf(ctx, jobId);
  await finishIfDone(ctx, jobId);
}

/** Finishes a processing job once its progress counts every paper. */
export async function finishIfDone(ctx: MutationCtx, jobId: Id<"screeningJobs">) {
  const job = await ctx.db.get("screeningJobs", jobId);
  const progress = await progressRow(ctx, jobId);
  if (!job || job.status !== "processing" || !progress) return;
  if (progress.completed + progress.skipped + progress.failed < job.totalPapers) return;
  const now = Date.now();
  await ctx.db.patch("screeningJobs", jobId, { status: "completed", completedAt: now, updatedAt: now });
  const user = await ctx.db.get("users", job.userId);
  if (user?.clerkId) {
    await ctx.scheduler.runAfter(0, internal.lib.analytics.captureEvent, {
      distinctId: user.clerkId,
      event: "screening_job_completed",
      properties: {
        total_papers: job.totalPapers,
        processed_papers: progress.completed + progress.skipped,
        failed_papers: progress.failed,
        qualified_papers: progress.qualified,
        question_count: job.questions.length,
        duration_ms: job.createdAt ? now - job.createdAt : 0,
      },
    });
  }
}

/**
 * One batch of finished papers: counts, answers, library saves, and finishing their jobs.
 * A job without progress yet is counted from all its results, so a batch counts at most one
 * such job; the others' papers wait for the next batch, and the cursor goes back to them.
 */
export const bookkeep = internalMutation({
  args: vMutationArgs,
  returns: vMutationReturns,
  handler: async (ctx, { results: ids }) => {
    const results = (await Promise.all(ids.map((id) => ctx.db.get("screeningResults", id)))).filter(
      (result): result is Doc<"screeningResults"> => result !== null && result.doneAt !== undefined,
    );
    const byJob = new Map<Id<"screeningJobs">, Doc<"screeningResults">[]>();
    for (const result of results) byJob.set(result.jobId, [...(byJob.get(result.jobId) ?? []), result]);
    let recounted = false;
    const waiting: bigint[] = [];
    // Papers of each person's that stopped running; a paper skipped before it started held no slot.
    const freed = new Map<Id<"users">, number>();
    for (const [jobId, jobResults] of byJob) {
      const job = await ctx.db.get("screeningJobs", jobId);
      if (job) {
        if (!(await progressRow(ctx, jobId))) {
          if (recounted) {
            waiting.push(...jobResults.map((result) => doneAtOf(result)!));
            continue;
          }
          recounted = true;
        }
        // Answers move to the job's screening first: a paper is scored on its answers as they
        // stand there, where a person's or the assistant's answer outranks the model's.
        for (const result of jobResults) if (result.pendingAnswers) await moveResultAnswers(ctx, result);
        const current = (await ctx.db.get("screeningJobs", jobId))!;
        const deltas: Delta[] = [];
        for (const result of jobResults) {
          if (result.status === "failed") await ctx.db.patch("screeningResults", result._id, FAILED);
          if (result.status !== "completed") continue;
          const settled = (await ctx.db.get("screeningResults", result._id))!;
          const { patch, delta, move } = account(current, settled, await standing(ctx, current, settled));
          await ctx.db.patch("screeningResults", result._id, patch);
          deltas.push(delta);
          if (move.becameIncluded) await saveQualified(ctx, current, { ...settled, ...patch });
        }
        await countFinished(ctx, current, jobResults, deltas);
        await finishIfDone(ctx, jobId);
        const started = jobResults.filter((result) => result.workId !== undefined).length;
        if (started) freed.set(job.userId, (freed.get(job.userId) ?? 0) + started);
      }
      // Bookkept, or its job is gone: out of the queue.
      for (const result of jobResults) await ctx.db.patch("screeningResults", result._id, { doneAt: undefined });
    }
    for (const [userId, finished] of freed) await startWaitingPapers(ctx, userId, finished);
    if (waiting.length) return { cursor: waiting.reduce((min, ts) => (ts < min ? ts : min)) };
    return null;
  },
});
