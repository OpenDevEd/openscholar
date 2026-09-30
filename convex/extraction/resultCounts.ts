/**
 * Counts of a job's extraction results and paper errors, kept by database triggers on
 * every write to `extractionResults` and `extractionPaperErrors` (`convex/lib/triggers.ts`),
 * so the progress and retry summaries read a few counters instead of every row (#351).
 *
 * Each job has one counter per result bucket: every result (`total`), completed results,
 * failed results that can be retried, and failed results for each permanent error code
 * (the buckets follow `isResultRetryableFailure`), plus one per paper error code. Counters
 * are sharded, so rows written in parallel land on different shards and don't conflict.
 */
import { ShardedCounter } from "@convex-dev/sharded-counter";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { Change } from "convex-helpers/server/triggers";
import { components } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { ERROR_CODES, isRetryable } from "../../lib/errors/taxonomy";
import { isResultRetryableFailure } from "../../lib/extraction/retry-summary";

type RunMutationCtx = { runMutation: GenericMutationCtx<DataModel>["runMutation"] };
type RunQueryCtx = { runQuery: GenericQueryCtx<DataModel>["runQuery"] };
type Result = Pick<Doc<"extractionResults">, "jobId" | "status" | "lastError">;

/** Error codes whose failures can't be retried; each gets its own counter. */
export const PERMANENT_ERROR_CODES = Object.entries(isRetryable).filter(([, retryable]) => retryable === false).map(([code]) => code);

// Results are written by up to 25 workers at once per job; paper errors once per failed attempt.
const counter = new ShardedCounter<string>(components.extractionResultCounter, { defaultShards: 16 });
const errorCounter = new ShardedCounter<string>(components.extractionResultCounter, { defaultShards: 4 });
const key = (jobId: Id<"extractionJobs">, bucket: string) => `${jobId}|${bucket}`;
const BUCKETS = ["total", "completed", "retryable", ...PERMANENT_ERROR_CODES.map((code) => `permanent:${code}`)];

/** The buckets a result counts in. */
export function bucketsOf(result: Result): string[] {
  const buckets = ["total"];
  if (result.status === "completed") buckets.push("completed");
  // A failure that can't be retried always has one of the permanent codes.
  if (result.status === "failed") buckets.push(isResultRetryableFailure(result) ? "retryable" : `permanent:${result.lastError!.code}`);
  return buckets;
}

/** Moves a result between buckets as it's written: the trigger on `extractionResults`. */
export async function countResultChange(ctx: RunMutationCtx, change: Change<DataModel, "extractionResults">) {
  const before = change.oldDoc ? bucketsOf(change.oldDoc).map((bucket) => key(change.oldDoc!.jobId, bucket)) : [];
  const after = change.newDoc ? bucketsOf(change.newDoc).map((bucket) => key(change.newDoc!.jobId, bucket)) : [];
  for (const name of before) if (!after.includes(name)) await counter.dec(ctx, name);
  for (const name of after) if (!before.includes(name)) await counter.inc(ctx, name);
}

export type ResultCounts = { total: number; completed: number; retryable: number; permanent: Record<string, number> };

/** A job's result counts. */
export async function readResultCounts(ctx: RunQueryCtx, jobId: Id<"extractionJobs">): Promise<ResultCounts> {
  const [total, completed, retryable, ...permanent] = await Promise.all(BUCKETS.map((bucket) => counter.count(ctx, key(jobId, bucket))));
  return { total, completed, retryable, permanent: Object.fromEntries(PERMANENT_ERROR_CODES.flatMap((code, i) => (permanent[i] ? [[code, permanent[i]]] : []))) };
}

/** Sets a job's counts to `counts`, as the recount for jobs saved before counting does. */
export async function setResultCounts(ctx: RunMutationCtx, jobId: Id<"extractionJobs">, counts: Map<string, number>) {
  for (const bucket of BUCKETS) {
    await counter.reset(ctx, key(jobId, bucket));
    const value = counts.get(bucket) ?? 0;
    if (value) await counter.add(ctx, key(jobId, bucket), value);
  }
}

/** Counts a paper error under its code: the trigger on `extractionPaperErrors`. */
export async function countPaperErrorChange(ctx: RunMutationCtx, change: Change<DataModel, "extractionPaperErrors">) {
  if (change.oldDoc) await errorCounter.dec(ctx, key(change.oldDoc.jobId, `error:${change.oldDoc.code}`));
  if (change.newDoc) await errorCounter.inc(ctx, key(change.newDoc.jobId, `error:${change.newDoc.code}`));
}

/** A job's paper errors per code, leaving out codes with none. */
export async function readPaperErrorCounts(ctx: RunQueryCtx, jobId: Id<"extractionJobs">): Promise<Record<string, number>> {
  const counts = await Promise.all(ERROR_CODES.map((code) => errorCounter.count(ctx, key(jobId, `error:${code}`))));
  return Object.fromEntries(ERROR_CODES.flatMap((code, i) => (counts[i] ? [[code, counts[i]]] : [])));
}

/** Sets a job's paper error counts to `counts`, as the recount for jobs saved before counting does. */
export async function setPaperErrorCounts(ctx: RunMutationCtx, jobId: Id<"extractionJobs">, counts: Map<string, number>) {
  for (const code of ERROR_CODES) {
    await errorCounter.reset(ctx, key(jobId, `error:${code}`));
    const value = counts.get(code) ?? 0;
    if (value) await errorCounter.add(ctx, key(jobId, `error:${code}`), value);
  }
}
