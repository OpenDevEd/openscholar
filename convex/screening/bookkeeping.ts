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
import { findItem } from "../library/find";

import { addCollectionMembership, removeCollectionMembership } from "../library/collectionMembership";
import { votesOf } from "./dealing";
import { moveResultAnswers } from "./drain";
import { account, FAILED, standing, withDeltas, type Delta, type Move } from "./accounting";
import { readStartFacts, startWaitingPapers, startWaitingVotes } from "./slots";
import { settlePapers } from "./settling";
import { startFactsValidator } from "./validators";
import { captureLater } from "../lib/analyticsEvents";
import { noteActivity } from "../activity/notes";
import { forgetMissing, queueLibraryWrite } from "../evidenceLibraries/writes";

/** Papers per batch: each moves its answers and may save a library item, a few dozen reads. */
const BATCH = 50;

const { vQueryArgs, vQueryReturns, vMutationArgs, vMutationReturns } = defineBatchWorkerValidators({
  // `facts` is what the pass that starts the next papers needs, read by the query (./slots.ts).
  batch: { results: v.array(v.id("screeningResults")), facts: v.optional(startFactsValidator) },
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
    const jobs = await Promise.all([...new Set(rows.map((row) => row.jobId))].map((jobId) => ctx.db.get("screeningJobs", jobId)));
    const workspaces = [...new Set(jobs.flatMap((job) => (job ? [job.workspaceId] : [])))];
    return { kind: "work" as const, batch: { results: rows.map((row) => row._id), facts: await readStartFacts(ctx, workspaces) }, cursor: last };
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

export async function progressRow(ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) {
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
    // Papers that held a slot leave it as they're counted (./slots.ts): a spending limit stops holding them at the estimate, and the job's page stops showing them as being read.
    ...(row.running ? { running: Math.max(0, row.running - results.filter((result) => result.workId !== undefined).length) } : {}),
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
    { userId: job.createdBy, workspaceId: job.workspaceId },
    {
      paper: result.paperKey,
      ...(result.crossRefs ? { crossRefs: result.crossRefs } : {}),
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
    // A screening with reviewers includes records it read from a file, which no index knows: they are saved with what the file gave.
    { preserveRating: true, keepUnpublishedReport: true, fromFile: job.shape === 2 },
  );
  const collection = job.targetCollectionId ? await ctx.db.get("collections", job.targetCollectionId) : null;
  if (collection) await addCollectionMembership(ctx, { collection, item: (await ctx.db.get("libraryItems", libraryItemId))! });
  await ctx.db.patch("screeningResults", result._id, { savedToLibrary: true, libraryItemId });
}

/**
 * Puts a paper where its place in the job sends it, and says what that adds to the job's
 * count of papers saved and of papers removed. One that becomes included is saved, unless
 * the job saves nothing. In a job that prunes the collection it read, one that comes to be
 * left out (excluded, or failed) leaves that collection, and comes back if a changed answer
 * includes it after all; an unclear one stays.
 */
export async function shelve(ctx: MutationCtx, job: Doc<"screeningJobs">, result: Doc<"screeningResults">, { becameIncluded, left }: Move, sets: Array<{ set: Doc<"screeningJobs">["set"] | Doc<"screeningSources">["set"]; /** The record of the paper that collection holds, where it isn't the paper's own. */ paperKey?: string }> = [{ set: job.set }], { met = false }: { /** The paper was just met in these sources, already excluded: it leaves them though it left others before. */ met?: boolean } = {}) {
  const moved = { saved: 0, removed: 0 };
  if (becameIncluded && !job.unsaved) {
    moved.saved = result.savedToLibrary ? 0 : 1;
    await saveQualified(ctx, job, result);
  }
  // An Evidence Library collection gets its included papers through the library's own writes (../evidenceLibraries/writes.ts).
  if (becameIncluded && job.libraryDestination) await queueLibraryWrite(ctx, job, result, "add", job.libraryDestination);
  if (job.libraryDestination) await forgetMissing(ctx, job, result);
  if (!job.prune || !(becameIncluded || left)) return moved;
  // Every collection that held it is pruned, the one it was read from and any other it was met in again, each by the record it holds: each would otherwise keep a paper the screening excluded, and one brought back gets its own record again.
  let removed = false;
  let back = false;
  const wasPruned = Boolean(result.pruned);
  for (const { set, paperKey } of sets) {
    if (set?.kind === "evidenceLibrary") {
      // Each community collection is written to on its own: one taken out of before never keeps another from being.
      await pruneLibraryCollection(ctx, job, result, { becameIncluded, left }, moved, set, met || !wasPruned);
      continue;
    }
    if (set?.kind !== "collection") continue;
    const collectionId = set.collectionId;
    // A screening moved to another workspace (#654) leaves the collection it read alone.
    const collection = await ctx.db.get("collections", collectionId);
    if (collection?.workspaceId !== job.workspaceId) continue;
    const item = await findItem(ctx, job.workspaceId, paperKey ?? result.paperKey);
    if (!item) continue;
    const membership = await ctx.db.query("libraryItemCollections").withIndex("by_collection_item", (q) => q.eq("collectionId", collectionId).eq("libraryItemId", item._id)).unique();
    if (left && membership) {
      await removeCollectionMembership(ctx, membership);
      removed = true;
    }
    if (becameIncluded && !membership) {
      await addCollectionMembership(ctx, { collection, item });
      back ||= Boolean(result.pruned);
    }
  }
  if (removed && !result.pruned) {
    await ctx.db.patch("screeningResults", result._id, { pruned: true });
    moved.removed = 1;
  }
  if (back) {
    await ctx.db.patch("screeningResults", result._id, { pruned: undefined });
    moved.removed = -1;
  }
  return moved;
}

/**
 * `shelve` for a job that prunes the reader's library collection it read: a paper that comes to be left out leaves it,
 * and comes back if a changed answer includes it. The job counts it removed once the library confirms it (`written`).
 */
async function pruneLibraryCollection(ctx: MutationCtx, job: Doc<"screeningJobs">, result: Doc<"screeningResults">, { becameIncluded, left }: Move, moved: { saved: number; removed: number }, set: Doc<"screeningJobs">["set"], leaves: boolean) {
  if (set?.kind !== "evidenceLibrary" || !("readerCollection" in set.source) || !set.source.readerCollection || "search" in set.source) return moved;
  const from = { libraryId: set.libraryId, collection: set.source.readerCollection };
  if (left && leaves) {
    await queueLibraryWrite(ctx, job, result, "remove", from, { prune: true });
    await ctx.db.patch("screeningResults", result._id, { pruned: true });
  }
  if (becameIncluded && result.pruned) {
    await queueLibraryWrite(ctx, job, result, "add", from, { prune: true });
    await ctx.db.patch("screeningResults", result._id, { pruned: undefined });
  }
  return moved;
}

/** `progress`'s counts of papers saved and removed with `moved` added. */
export const withMoved = (progress: Pick<Doc<"screeningJobProgress">, "saved" | "removed">, moved: { saved: number; removed: number }) => ({
  ...(moved.saved ? { saved: (progress.saved ?? 0) + moved.saved } : {}),
  ...(moved.removed ? { removed: Math.max(0, (progress.removed ?? 0) + moved.removed) } : {}),
});

/**
 * Notes in their Activity (#656) what a job did once it ends or is stopped, as whoever ran it: the
 * papers it screened, on it and on the search or collection it read; those it saved to its
 * collection; and those it took out of the collection it read. A failed job screened none. A paper
 * an answer moves after the job ended moves without a note; the screening's own Activity has the answer.
 */
export async function noteEnded(ctx: MutationCtx, job: Doc<"screeningJobs">, progress?: Doc<"screeningJobProgress"> | null) {
  const { completed, saved, removed } = progress ?? (await progressRow(ctx, job._id)) ?? {};
  const pruned = job.prune && job.set?.kind === "collection" ? job.set.collectionId : undefined;
  const read = job.set?.kind === "search" ? { kind: "search" as const, id: job.set.searchId } : job.set?.kind === "collection" ? { kind: "collection" as const, id: job.set.collectionId } : null;
  const detail = job.name ?? job.label;
  const about = detail ? { detail } : {};
  await noteActivity(ctx, { workspaceId: job.workspaceId, by: job.createdBy, viaAssistant: false }, [
    ...(completed ? [{ kind: "screening" as const, id: job._id, happened: "screened" as const, count: completed }, ...(read ? [{ ...read, happened: "screened" as const, count: completed, ...about }] : [])] : []),
    ...(job.targetCollectionId && saved ? [{ kind: "collection" as const, id: job.targetCollectionId, happened: "added" as const, count: saved, ...about }] : []),
    ...(pruned && removed ? [{ kind: "collection" as const, id: pruned, happened: "removed" as const, count: removed, ...about }] : []),
  ]);
}

/** Finishes a processing job once it has read its papers and its progress counts every one. */
export async function finishIfDone(ctx: MutationCtx, jobId: Id<"screeningJobs">) {
  const job = await ctx.db.get("screeningJobs", jobId);
  const progress = await progressRow(ctx, jobId);
  if (!job || job.status !== "processing" || job.reading || !progress) return;
  if (progress.completed + progress.skipped + progress.failed < job.totalPapers) return;
  const now = Date.now();
  // One that stopped at the most it may spend, or when the person's credits ran out, has papers it never read: it ends as stopped, not as done.
  await ctx.db.patch("screeningJobs", jobId, { status: job.capped || job.outOfCredits ? "creditsExhausted" : "completed", completedAt: now, updatedAt: now });
  await noteEnded(ctx, job, progress);
  const user = await ctx.db.get("users", job.createdBy);
  if (user?.clerkId) {
    await captureLater(ctx, [{
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
      timestamp: now,
    }]);
  }
}

/**
 * One screening's share of a batch, in a transaction of its own inside the batch's: where it throws, nothing it wrote
 * stays, and the batch goes on with the other screenings' papers (`bookkeep`).
 */
export const bookkeepJob = internalMutation({
  args: { jobId: v.id("screeningJobs"), results: v.array(v.id("screeningResults")) },
  returns: v.object({ papers: v.optional(v.number()), votes: v.optional(v.number()) }),
  handler: async (ctx, { jobId, results: ids }) => {
    const jobResults = (await Promise.all(ids.map((id) => ctx.db.get("screeningResults", id)))).filter((result): result is Doc<"screeningResults"> => result !== null && result.doneAt !== undefined);
    const job = await ctx.db.get("screeningJobs", jobId);
    let freed: { papers?: number; votes?: number } = {};
    if (job?.shape === 2) {
      // A screening with reviewers: its papers are settled on their votes (./settling.ts).
      const { freed: slots, queued } = await settlePapers(ctx, job, jobResults);
      if (slots || queued) freed = { votes: slots };
    } else if (job) {
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
      freed = { papers: jobResults.filter((result) => result.workId !== undefined).length };
    }
    // Bookkept, or its job is gone: out of the queue.
    for (const result of jobResults) await ctx.db.patch("screeningResults", result._id, { doneAt: undefined });
    return freed;
  },
});

/** Lets go of the slots held by readings that have come back on these papers, where their screening couldn't be bookkept (`bookkeep`), and says how many. */
export const releaseSlots = internalMutation({
  args: { jobId: v.id("screeningJobs"), results: v.array(v.id("screeningResults")) },
  returns: v.number(),
  handler: async (ctx, { jobId, results }) => {
    let freed = 0;
    for (const resultId of results) {
      for (const vote of await votesOf(ctx, resultId)) {
        if (!vote.slot || vote.workId !== undefined) continue;
        await ctx.db.patch("screeningVotes", vote._id, { slot: undefined });
        freed++;
      }
    }
    const progress = freed ? await progressRow(ctx, jobId) : null;
    if (progress?.running) await ctx.db.patch("screeningJobProgress", progress._id, { running: Math.max(0, progress.running - freed) });
    return freed;
  },
});

/** One batch of finished papers: counts, answers, library saves, and finishing their jobs. */
export const bookkeep = internalMutation({
  args: vMutationArgs,
  returns: vMutationReturns,
  handler: async (ctx, { results: ids, facts }) => {
    const results = (await Promise.all(ids.map((id) => ctx.db.get("screeningResults", id)))).filter(
      (result): result is Doc<"screeningResults"> => result !== null && result.doneAt !== undefined,
    );
    const byJob = new Map<Id<"screeningJobs">, Doc<"screeningResults">[]>();
    for (const result of results) byJob.set(result.jobId, [...(byJob.get(result.jobId) ?? []), result]);
    // Papers of each workspace's that stopped running. A paper skipped before it started held no slot, but its
    // workspace is still listed: with it out of the queue, the papers that waited behind it can start.
    const freed = new Map<Id<"workspaces">, number>();
    const freedVotes = new Map<Id<"workspaces">, number>();
    for (const [jobId, jobResults] of byJob) {
      const workspaceId = (await ctx.db.get("screeningJobs", jobId))?.workspaceId;
      try {
        const done: { papers?: number; votes?: number } = await ctx.runMutation(internal.screening.bookkeeping.bookkeepJob, { jobId, results: jobResults.map((result) => result._id) });
        if (workspaceId && done.papers !== undefined) freed.set(workspaceId, (freed.get(workspaceId) ?? 0) + done.papers);
        if (workspaceId && done.votes !== undefined) freedVotes.set(workspaceId, (freedVotes.get(workspaceId) ?? 0) + done.votes);
      } catch (error) {
        // Every screening of the deployment waits behind this queue: one whose papers can't be bookkept must not hold the
        // others up. Its papers leave the queue as they stood, to be tried again when one of them next changes, and what
        // went wrong is logged with the screening it happened in.
        console.error("[screening] A screening's papers couldn't be bookkept", { jobId, papers: jobResults.length, error: String(error instanceof Error ? (error.stack ?? error.message) : error).slice(0, 1500) });
        for (const result of jobResults) await ctx.db.patch("screeningResults", result._id, { doneAt: undefined });
        // The readings that came back on them held slots of the workspace, which its other screenings wait for: those are given back whatever is wrong with this one.
        const released: number = await ctx.runMutation(internal.screening.bookkeeping.releaseSlots, { jobId, results: jobResults.map((result) => result._id) }).catch(() => 0);
        if (workspaceId && released) freedVotes.set(workspaceId, (freedVotes.get(workspaceId) ?? 0) + released);
      }
    }
    for (const [workspaceId, finished] of freed) await startWaitingPapers(ctx, workspaceId, finished, facts);
    for (const [workspaceId, finished] of freedVotes) await startWaitingVotes(ctx, workspaceId, finished, facts);
    return null;
  },
});
