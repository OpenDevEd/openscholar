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
import type { GenericQueryCtx } from "convex/server";
import type { Change } from "convex-helpers/server/triggers";
import { components } from "../_generated/api";
import { transactionCounter } from "../lib/transactionCounter";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { ERROR_CODES, isRetryable } from "../../lib/errors/taxonomy";
import { isResultRetryableFailure } from "../../lib/extraction/retry-summary";
import type { MutationCtx } from "../_generated/server";

type RunMutationCtx = MutationCtx & { innerDb?: object };
type RunQueryCtx = { runQuery: GenericQueryCtx<DataModel>["runQuery"] };
type Result = Pick<Doc<"extractionResults">, "jobId" | "status" | "lastError" | "billed">;

/** Error codes whose failures can't be retried; each gets its own counter. */
export const PERMANENT_ERROR_CODES = Object.entries(isRetryable).filter(([, retryable]) => retryable === false).map(([code]) => code);

// Up to 25 workers write one job's results at once (5 papers × 5 question batches). A load
// run with 30 writers on 16 shards lost 38 of 600 writes to write conflicts on the shards;
// 64 shards, like the paper counters in ./jobCounters.ts, keep writers on different ones.
// Paper errors are written once per failed attempt, far less often.
const counter = transactionCounter(() => new ShardedCounter<string>(components.extractionResultCounter, { defaultShards: 64 }));
const errorCounter = transactionCounter(() => new ShardedCounter<string>(components.extractionResultCounter, { defaultShards: 16 }));
const key = (jobId: Id<"extractionJobs">, bucket: string) => `${jobId}|${bucket}`;
const BUCKETS = ["total", "completed", "retryable", ...PERMANENT_ERROR_CODES.map((code) => `permanent:${code}`)];

/** The buckets a result counts in. */
export function bucketsOf(result: Result): string[] {
  const buckets = ["total"];
  if (result.status === "completed") buckets.push("completed");
  // A failure that can't be retried always has one of the permanent codes. A billed one is
  // never retried (that would bill it again), so it counts in neither.
  if (result.status === "failed" && !isResultRetryableFailure(result)) buckets.push(`permanent:${result.lastError!.code}`);
  else if (result.status === "failed" && result.billed !== true) buckets.push("retryable");
  return buckets;
}

/** Moves a result between buckets as it's written: the trigger on `extractionResults`. */
export async function countResultChange(ctx: RunMutationCtx, change: Change<DataModel, "extractionResults">) {
  const before = change.oldDoc ? bucketsOf(change.oldDoc).map((bucket) => key(change.oldDoc!.jobId, bucket)) : [];
  const after = change.newDoc ? bucketsOf(change.newDoc).map((bucket) => key(change.newDoc!.jobId, bucket)) : [];
  for (const name of before) if (!after.includes(name)) await counter.for(ctx).dec(ctx, name);
  for (const name of after) if (!before.includes(name)) await counter.for(ctx).inc(ctx, name);
}

export type ResultCounts = { total: number; completed: number; retryable: number; permanent: Record<string, number> };

/** A job's result counts. */
export async function readResultCounts(ctx: RunQueryCtx, jobId: Id<"extractionJobs">): Promise<ResultCounts> {
  const [total, completed, retryable, ...permanent] = await Promise.all(BUCKETS.map((bucket) => counter.read.count(ctx, key(jobId, bucket))));
  return { total, completed, retryable, permanent: Object.fromEntries(PERMANENT_ERROR_CODES.flatMap((code, i) => (permanent[i] ? [[code, permanent[i]]] : []))) };
}

/** Sets a job's counts to `counts`, as the recount for jobs saved before counting does. */
export async function setResultCounts(ctx: RunMutationCtx, jobId: Id<"extractionJobs">, counts: Map<string, number>) {
  for (const bucket of BUCKETS) {
    await counter.for(ctx).reset(ctx, key(jobId, bucket));
    const value = counts.get(bucket) ?? 0;
    if (value) await counter.for(ctx).add(ctx, key(jobId, bucket), value);
  }
}

/** Counts a paper error under its code: the trigger on `extractionPaperErrors`. */
export async function countPaperErrorChange(ctx: RunMutationCtx, change: Change<DataModel, "extractionPaperErrors">) {
  if (change.oldDoc) await errorCounter.for(ctx).dec(ctx, key(change.oldDoc.jobId, `error:${change.oldDoc.code}`));
  if (change.newDoc) await errorCounter.for(ctx).inc(ctx, key(change.newDoc.jobId, `error:${change.newDoc.code}`));
}

/** A job's paper errors per code, leaving out codes with none. */
export async function readPaperErrorCounts(ctx: RunQueryCtx, jobId: Id<"extractionJobs">): Promise<Record<string, number>> {
  const counts = await Promise.all(ERROR_CODES.map((code) => errorCounter.read.count(ctx, key(jobId, `error:${code}`))));
  return Object.fromEntries(ERROR_CODES.flatMap((code, i) => (counts[i] ? [[code, counts[i]]] : [])));
}

/** Sets a job's paper error counts to `counts`, as the recount for jobs saved before counting does. */
export async function setPaperErrorCounts(ctx: RunMutationCtx, jobId: Id<"extractionJobs">, counts: Map<string, number>) {
  for (const code of ERROR_CODES) {
    await errorCounter.for(ctx).reset(ctx, key(jobId, `error:${code}`));
    const value = counts.get(code) ?? 0;
    if (value) await errorCounter.for(ctx).add(ctx, key(jobId, `error:${code}`), value);
  }
}
