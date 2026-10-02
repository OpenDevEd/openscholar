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
import { PAPER_LIMIT } from "../../lib/extraction/limits";
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

const errorBuckets = (error: Pick<Doc<"extractionPaperErrors">, "code">) => [`error:${error.code}`];

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

async function readAll<T>(rows: { take(n: number): Promise<T[]> }, jobId: Id<"extractionJobs">, limit: number) {
  const all = await rows.take(limit + 1);
  if (all.length > limit) throw new Error(`Job ${jobId} has more than ${limit} rows of one kind, more than one transaction can recount`);
  return all;
}

/** Every count a job should hold, recounted from its rows. */
export async function recountJob(ctx: QueryCtx | MutationCtx, jobId: Id<"extractionJobs">): Promise<Counts> {
  const counts: Counts = {};
  const tally = (buckets: string[]) => addInto(counts, Object.fromEntries(buckets.map((bucket) => [bucket, 1])));
  for (const paper of await readAll(ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)), jobId, PAPER_LIMIT)) tally(paperBuckets(paper));
  for (const result of await readAll(ctx.db.query("extractionResults").withIndex("by_job", (q) => q.eq("jobId", jobId)), jobId, RECOUNT_MAX_ROWS)) tally(resultBuckets(result));
  for (const error of await readAll(ctx.db.query("extractionPaperErrors").withIndex("by_job", (q) => q.eq("jobId", jobId)), jobId, RECOUNT_MAX_ROWS)) tally(errorBuckets(error));
  return counts;
}

/**
 * A job's counts from its rows less the changes still waiting to be folded, which the
 * worker adds when it folds them: the counts row a job starts with.
 */
export async function startingCounts(ctx: MutationCtx, jobId: Id<"extractionJobs">): Promise<Counts> {
  const counts = await recountJob(ctx, jobId);
  const waiting = await ctx.db.query("extractionCountChanges").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(RECOUNT_MAX_ROWS);
  for (const change of waiting) addInto(counts, change.deltas, -1);
  return counts;
}

/** The changes appended for a job that the worker hasn't folded yet. */
export async function waitingDeltas(ctx: QueryCtx | MutationCtx, jobId: Id<"extractionJobs">): Promise<Counts> {
  const deltas: Counts = {};
  for (const change of await ctx.db.query("extractionCountChanges").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(RECOUNT_MAX_ROWS)) addInto(deltas, change.deltas);
  return deltas;
}

/**
 * A job's counts as of now: its row, or before it has one the counts kept by `legacy`, plus
 * the changes not folded yet. Exact, so a retry's decrements count before the worker folds
 * them and a job can't finish on counts that are behind.
 */
export async function readCounts(ctx: QueryCtx | MutationCtx, jobId: Id<"extractionJobs">, legacy: () => Promise<Counts>): Promise<Counts> {
  const row = await countsRow(ctx, jobId);
  const counts = row ? { ...row.counts } : await legacy();
  addInto(counts, await waitingDeltas(ctx, jobId));
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
