/**
 * Screen all's bookkeeping, done in batches by one worker (`@convex-dev/batch-worker`), the
 * way Firecrawl queues its billing operations and commits them from one batch process. A
 * finished paper writes only its own result row, stamped with `doneAt`, and pings the queue.
 * The worker then, a batch at a time:
 * - moves the papers' answers into the job's screening;
 * - scores each on its answers as they stand there, counts the job's finished papers into
 *   its progress row (./accounting.ts), and finishes the job;
 * - saves the qualified papers to the person's library, and takes the ones left out from
 *   the collection a pruning job read;
 * - starts the person's next waiting papers in the slots the finished ones freed (./slots.ts).
 * Papers finishing together never write the same document; only the worker writes these.
 */
import { defineBatchWorkerValidators, ping } from "@convex-dev/batch-worker";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../lib/functions";
import { upsertLibraryItem } from "../library/mutations";
import { addCollectionMembership, removeCollectionMembership } from "../library/collectionMembership";
import { moveResultAnswers } from "./drain";
import { account, FAILED, standing, withDeltas, type Delta, type Move } from "./accounting";
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

/** A job's progress row, which every job has from the moment it's made. */
export async function progressOf(ctx: QueryCtx | MutationCtx, jobId: Id<"screeningJobs">) {
  const row = await progressRow(ctx, jobId);
  if (!row) throw new Error(`Screening job ${jobId} has no progress row`);
  return row;
}

/**
 * Adds a batch's papers to their job's progress: how many finished and how. What each adds
 * to the qualified and unclear counts and the questions' tallies is `deltas`
 * (./accounting.ts).
 */
async function countFinished(ctx: MutationCtx, job: Doc<"screeningJobs">, results: Doc<"screeningResults">[], deltas: Delta[], moved: { saved: number; removed: number }) {
  const row = await progressOf(ctx, job._id);
  const add = tally(results);
  const credits = results.reduce((sum, result) => sum + (result.creditsUsed ?? 0), 0);
  await ctx.db.patch("screeningJobProgress", row._id, {
    completed: row.completed + add.completed,
    skipped: row.skipped + add.skipped,
    failed: row.failed + add.failed,
    ...(credits ? { credits: (row.credits ?? 0) + credits } : {}),
    ...withMoved(row, moved),
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
      authors: result.authors,
      authorsUnparsed: result.authorsUnparsed,
      doi: result.doi,
      abstract: result.abstract,
      publicationYear: result.publicationYear,
      journal: result.venue,
      citedByCount: result.citedByCount,
      workType: result.workType,
      isOpenAccess: result.isOpenAccess,
      oaStatus: result.oaStatus,
      oaUrl: result.oaUrl,
      pdfUrl: result.pdfUrl,
    },
    result.stars ?? 0,
    { preserveRating: true },
  );
  const collection = job.targetCollectionId ? await ctx.db.get("collections", job.targetCollectionId) : null;
  if (collection) await addCollectionMembership(ctx, { userId: job.userId, collection, libraryItemId });
  await ctx.db.patch("screeningResults", result._id, { savedToLibrary: true, libraryItemId });
}

/**
 * Puts a paper where its place in the job sends it, and says what that adds to the job's
 * count of papers saved and of papers removed. One that becomes included is saved, unless
 * the job saves nothing. In a job that prunes the collection it read, one that comes to be
 * left out (excluded, or failed) leaves that collection, and comes back if a changed answer
 * includes it after all; an unclear one stays.
 */
export async function shelve(ctx: MutationCtx, job: Doc<"screeningJobs">, result: Doc<"screeningResults">, { becameIncluded, left }: Move) {
  const moved = { saved: 0, removed: 0 };
  if (becameIncluded && !job.unsaved) {
    moved.saved = result.savedToLibrary ? 0 : 1;
    await saveQualified(ctx, job, result);
  }
  if (!job.prune || job.set?.kind !== "collection" || !(becameIncluded || left)) return moved;
  const collectionId = job.set.collectionId;
  const item = await ctx.db.query("libraryItems").withIndex("by_user_openalexId", (q) => q.eq("userId", job.userId).eq("openalexId", result.openalexId)).first();
  if (!item) return moved;
  const membership = await ctx.db.query("libraryItemCollections").withIndex("by_collection_item", (q) => q.eq("collectionId", collectionId).eq("libraryItemId", item._id)).unique();
  if (left && membership) {
    await removeCollectionMembership(ctx, membership);
    await ctx.db.patch("screeningResults", result._id, { pruned: true });
    moved.removed = 1;
  }
  const collection = becameIncluded && !membership ? await ctx.db.get("collections", collectionId) : null;
  if (collection) {
    await addCollectionMembership(ctx, { userId: job.userId, collection, libraryItemId: item._id });
    if (result.pruned) {
      await ctx.db.patch("screeningResults", result._id, { pruned: undefined });
      moved.removed = -1;
    }
  }
  return moved;
}

/** `progress`'s counts of papers saved and removed with `moved` added. */
export const withMoved = (progress: Pick<Doc<"screeningJobProgress">, "saved" | "removed">, moved: { saved: number; removed: number }) => ({
  ...(moved.saved ? { saved: (progress.saved ?? 0) + moved.saved } : {}),
  ...(moved.removed ? { removed: Math.max(0, (progress.removed ?? 0) + moved.removed) } : {}),
});

/** Finishes a processing job once its progress counts every paper. */
export async function finishIfDone(ctx: MutationCtx, jobId: Id<"screeningJobs">) {
  const job = await ctx.db.get("screeningJobs", jobId);
  const progress = await progressRow(ctx, jobId);
  if (!job || job.status !== "processing" || !progress) return;
  if (progress.completed + progress.skipped + progress.failed < job.totalPapers) return;
  const now = Date.now();
  // One that stopped at the most it may spend has papers it never read: it ends as stopped, not as done.
  await ctx.db.patch("screeningJobs", jobId, { status: job.capped ? "creditsExhausted" : "completed", completedAt: now, updatedAt: now });
  // A request bigger than one job: the job for its next papers starts now.
  if (job.last !== undefined && job.through !== undefined && job.last < job.through) {
    await ctx.scheduler.runAfter(0, internal.screening.start.next, { jobId, first: job.last + 1 });
  }
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

/** One batch of finished papers: counts, answers, library saves, and finishing their jobs. */
export const bookkeep = internalMutation({
  args: vMutationArgs,
  returns: vMutationReturns,
  handler: async (ctx, { results: ids }) => {
    const results = (await Promise.all(ids.map((id) => ctx.db.get("screeningResults", id)))).filter(
      (result): result is Doc<"screeningResults"> => result !== null && result.doneAt !== undefined,
    );
    const byJob = new Map<Id<"screeningJobs">, Doc<"screeningResults">[]>();
    for (const result of results) byJob.set(result.jobId, [...(byJob.get(result.jobId) ?? []), result]);
    // Papers of each person's that stopped running; a paper skipped before it started held no slot.
    const freed = new Map<Id<"users">, number>();
    for (const [jobId, jobResults] of byJob) {
      const job = await ctx.db.get("screeningJobs", jobId);
      if (job) {
        // Answers move to the job's screening first: a paper is scored on its answers as they
        // stand there, where a person's or the assistant's answer outranks the model's.
        for (const result of jobResults) if (result.pendingAnswers) await moveResultAnswers(ctx, result);
        const current = (await ctx.db.get("screeningJobs", jobId))!;
        const deltas: Delta[] = [];
        const moved = { saved: 0, removed: 0 };
        const shelved = (to: { saved: number; removed: number }) => {
          moved.saved += to.saved;
          moved.removed += to.removed;
        };
        for (const result of jobResults) {
          if (result.status === "failed") {
            await ctx.db.patch("screeningResults", result._id, FAILED);
            // A paper that failed because its job had ended, as the one that finds the credits
            // spent does, was never screened: it stays where it is.
            if (current.status === "processing") shelved(await shelve(ctx, current, result, { becameIncluded: false, left: true }));
          }
          if (result.status !== "completed") continue;
          const settled = (await ctx.db.get("screeningResults", result._id))!;
          const { patch, delta, move } = account(current, settled, await standing(ctx, current, settled));
          await ctx.db.patch("screeningResults", result._id, patch);
          deltas.push(delta);
          shelved(await shelve(ctx, current, { ...settled, ...patch }, move));
        }
        await countFinished(ctx, current, jobResults, deltas, moved);
        await finishIfDone(ctx, jobId);
        const started = jobResults.filter((result) => result.workId !== undefined).length;
        if (started) freed.set(job.userId, (freed.get(job.userId) ?? 0) + started);
      }
      // Bookkept, or its job is gone: out of the queue.
      for (const result of jobResults) await ctx.db.patch("screeningResults", result._id, { doneAt: undefined });
    }
    for (const [userId, finished] of freed) await startWaitingPapers(ctx, userId, finished);
    return null;
  },
});
