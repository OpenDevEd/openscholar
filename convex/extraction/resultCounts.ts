/**
 * An extraction job's result and paper error counts, read for its progress and retry
 * summaries, from the job's counts row (./counts.ts).
 */
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ERROR_CODES, isRetryable } from "../../lib/errors/taxonomy";
import { readCounts } from "./counts";

/** Error codes whose failures can't be retried; each has its own count. */
export const PERMANENT_ERROR_CODES = Object.entries(isRetryable).filter(([, retryable]) => retryable === false).map(([code]) => code);
const RESULT_BUCKETS = ["total", "completed", "retryable", ...PERMANENT_ERROR_CODES.map((code) => `permanent:${code}`)];

export type ResultCounts = { total: number; completed: number; retryable: number; permanent: Record<string, number> };

/** A job's result counts. */
export async function readResultCounts(ctx: QueryCtx, jobId: Id<"extractionJobs">): Promise<ResultCounts> {
  const counts = await readCounts(ctx, jobId);
  const [total, completed, retryable, ...permanent] = RESULT_BUCKETS.map((bucket) => counts[bucket] ?? 0);
  return { total, completed, retryable, permanent: Object.fromEntries(PERMANENT_ERROR_CODES.flatMap((code, i) => (permanent[i] ? [[code, permanent[i]]] : []))) };
}

/** A job's paper errors per code, leaving out codes with none. */
export async function readPaperErrorCounts(ctx: QueryCtx, jobId: Id<"extractionJobs">): Promise<Record<string, number>> {
  const counts = await readCounts(ctx, jobId);
  return Object.fromEntries(ERROR_CODES.flatMap((code) => (counts[`error:${code}`] ? [[code, counts[`error:${code}`]]] : [])));
}
