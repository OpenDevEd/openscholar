/**
 * An extraction job's counts, kept as Firecrawl keeps its ledger: every write that changes
 * a count appends what it changed, and one worker (`@convex-dev/batch-worker`) folds the
 * changes into the job's one counts row. Papers and results written in parallel append
 * their own rows and never write the same document.
 *
 * Buckets: finished papers (`processed`, `failed`), results (`total`, `completed`,
 * `retryable`, and `permanent:<code>` for failures that can't be retried), and paper errors
 * (`error:<code>`). The triggers on `extractionPapers`, `extractionResults` and
 * `extractionPaperErrors` (`convex/lib/triggers.ts`) append the changes; ./countsWorker.ts
 * folds them. This module holds no Convex functions, so the triggers can load it.
 */
import { ping } from "@convex-dev/batch-worker";
import type { Change } from "convex-helpers/server/triggers";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isResultRetryableFailure } from "../../lib/extraction/retry-summary";
import { isTerminalPaperStatus } from "./paperLifecycle";

export type Counts = Record<string, number>;

/** Most result and paper error rows one job's recount reads: about 13 MB of the 16 MiB a transaction may read. */
const RECOUNT_MAX_ROWS = 10_000;
// ─── Buckets ────────────────────────────────────────────────────────────

/** The bucket a paper counts in: finished papers the job processes. */
export function paperBuckets(paper: Pick<Doc<"extractionPapers">, "status" | "processable">): string[] {
  if (paper.processable === false || !isTerminalPaperStatus(paper.status)) return [];
  return [paper.status === "completed" ? "processed" : "failed"];
}

/** The buckets a result counts in. */
export function resultBuckets(result: Pick<Doc<"extractionResults">, "status" | "lastError" | "billed">): string[] {
  const buckets = ["total"];
  if (result.status === "completed") buckets.push("completed");
  // A failure that can't be retried always has one of the permanent codes. A billed one is
  // never retried (that would bill it again), so it counts in neither.
  if (result.status === "failed" && !isResultRetryableFailure(result)) buckets.push(`permanent:${result.lastError!.code}`);
  else if (result.status === "failed" && result.billed !== true) buckets.push("retryable");
  return buckets;
}

export const errorBuckets = (error: Pick<Doc<"extractionPaperErrors">, "code">) => [`error:${error.code}`];

// ─── Appending changes (the triggers) ──────────────────────────────────

/** Wakes the worker for changes just appended. Costs a read while it's already running. */
async function foldLater(ctx: MutationCtx) {
  await ping(ctx, components.batchWorker, {
    name: "extractionCounts",
    workQuery: internal.extraction.countsWorker.nextChanges,
    workerMutation: internal.extraction.countsWorker.fold,
    config: { debounceMs: 100 },
  });
}

async function append(ctx: MutationCtx, jobId: Id<"extractionJobs">, deltas: Counts) {
  const changed = Object.entries(deltas).filter(([, delta]) => delta !== 0);
  if (!changed.length) return;
  await ctx.db.insert("extractionCountChanges", { jobId, deltas: Object.fromEntries(changed), queuedAt: ctx.db.vars.commitTs });
  await foldLater(ctx);
}

/** Appends what a write moved between buckets, per job. */
async function appendMove<T extends { jobId: Id<"extractionJobs"> }>(ctx: MutationCtx, before: T | null, after: T | null, bucketsOf: (doc: T) => string[]) {
  const byJob = new Map<Id<"extractionJobs">, Counts>();
  const add = (doc: T | null, sign: number) => {
    if (!doc) return;
    const deltas = byJob.get(doc.jobId) ?? {};
    for (const bucket of bucketsOf(doc)) deltas[bucket] = (deltas[bucket] ?? 0) + sign;
    byJob.set(doc.jobId, deltas);
  };
  add(before, -1);
  add(after, 1);
  for (const [jobId, deltas] of byJob) await append(ctx, jobId, deltas);
}

export const countPaperChange = (ctx: MutationCtx, change: Change<DataModel, "extractionPapers">) =>
  appendMove(ctx, change.oldDoc, change.newDoc, paperBuckets);
export const countResultChange = (ctx: MutationCtx, change: Change<DataModel, "extractionResults">) =>
  appendMove(ctx, change.oldDoc, change.newDoc, resultBuckets);
export const countPaperErrorChange = (ctx: MutationCtx, change: Change<DataModel, "extractionPaperErrors">) =>
  appendMove(ctx, change.oldDoc, change.newDoc, errorBuckets);

// ─── Reading and recounting ───────────────────────────────────────────

export async function countsRow(ctx: QueryCtx | MutationCtx, jobId: Id<"extractionJobs">) {
  return await ctx.db
    .query("extractionJobCounts")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .unique();
}

export function addInto(counts: Counts, deltas: Counts, sign = 1) {
  for (const [bucket, delta] of Object.entries(deltas)) counts[bucket] = (counts[bucket] ?? 0) + sign * delta;
}

/** A job's rows of one kind, or null when there are more than one transaction can recount. */
async function readAll<T>(rows: { take(n: number): Promise<T[]> }, limit: number) {
  const all = await rows.take(limit + 1);
  return all.length > limit ? null : all;
}

/**
 * The changes appended for a job that the worker hasn't folded yet, or null when there are
 * more than one transaction should read.
 */
export async function waitingDeltas(ctx: QueryCtx | MutationCtx, jobId: Id<"extractionJobs">): Promise<Counts | null> {
  const changes = await readAll(ctx.db.query("extractionCountChanges").withIndex("by_job", (q) => q.eq("jobId", jobId)), RECOUNT_MAX_ROWS);
  if (!changes) return null;
  const deltas: Counts = {};
  for (const change of changes) addInto(deltas, change.deltas);
  return deltas;
}

/** Whether the worker has changes for a job still to fold. */
export async function hasWaitingChanges(ctx: QueryCtx | MutationCtx, jobId: Id<"extractionJobs">) {
  return (await ctx.db.query("extractionCountChanges").withIndex("by_job", (q) => q.eq("jobId", jobId)).first()) !== null;
}

/**
 * A job's counts as of now, for showing them: its row, plus the changes not folded yet
 * while there are a readable number of them. Finishing a job doesn't rely on this: it waits
 * until nothing is left to fold (mutations/internal/lifecycle.ts).
 */
export async function readCounts(ctx: QueryCtx | MutationCtx, jobId: Id<"extractionJobs">): Promise<Counts> {
  const counts = { ...(await countsRow(ctx, jobId))?.counts };
  addInto(counts, (await waitingDeltas(ctx, jobId)) ?? {});
  return counts;
}

/** A new job starts with an empty counts row; a deleted one takes its row and waiting changes with it. */
export async function countJobChange(ctx: MutationCtx, change: Change<DataModel, "extractionJobs">) {
  if (!change.oldDoc && change.newDoc) await ctx.db.insert("extractionJobCounts", { jobId: change.newDoc._id, counts: {} });
  if (change.oldDoc && !change.newDoc) await clearCounts(ctx, change.oldDoc._id);
}

/** A deleted job's counts row and waiting changes. */
async function clearCounts(ctx: MutationCtx, jobId: Id<"extractionJobs">) {
  const row = await countsRow(ctx, jobId);
  if (row) await ctx.db.delete(row._id);
  for (const change of await ctx.db.query("extractionCountChanges").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(RECOUNT_MAX_ROWS)) {
    await ctx.db.delete(change._id);
  }
}
