/**
 * An extraction job's result and paper error counts, read for its progress and retry
 * summaries. They live in the job's counts row (./counts.ts). A job the counts worker
 * hasn't reached and the migration hasn't given a row still reads the sharded counters that
 * kept them before (#351), which nothing writes any more; those reads go once every
 * deployment has run migrations/moveExtractionCounts.
 */
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ERROR_CODES } from "../../lib/errors/taxonomy";
import { readCounts } from "./counts";
import { legacyCounts, PERMANENT_ERROR_CODES, RESULT_BUCKETS } from "./legacyCounts";

export { PERMANENT_ERROR_CODES };

export type ResultCounts = { total: number; completed: number; retryable: number; permanent: Record<string, number> };

/** A job's result counts. */
export async function readResultCounts(ctx: QueryCtx, jobId: Id<"extractionJobs">): Promise<ResultCounts> {
  const counts = await readCounts(ctx, jobId, () => legacyCounts(ctx, jobId));
  const [total, completed, retryable, ...permanent] = RESULT_BUCKETS.map((bucket) => counts[bucket] ?? 0);
  return { total, completed, retryable, permanent: Object.fromEntries(PERMANENT_ERROR_CODES.flatMap((code, i) => (permanent[i] ? [[code, permanent[i]]] : []))) };
}

/** A job's paper errors per code, leaving out codes with none. */
export async function readPaperErrorCounts(ctx: QueryCtx, jobId: Id<"extractionJobs">): Promise<Record<string, number>> {
  const counts = await readCounts(ctx, jobId, () => legacyCounts(ctx, jobId));
  return Object.fromEntries(ERROR_CODES.flatMap((code) => (counts[`error:${code}`] ? [[code, counts[`error:${code}`]]] : [])));
}
