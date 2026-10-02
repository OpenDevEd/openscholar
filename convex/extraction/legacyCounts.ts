/**
 * The sharded counters that kept extraction counts before the counts row (#351). Nothing
 * writes them any more, so a job's values here are its counts as of the deploy, and its
 * row starts from them; every write since is a change in the log (./counts.ts). This file
 * and its components go once every deployment has run migrations/moveExtractionCounts.
 */
import { ShardedCounter } from "@convex-dev/sharded-counter";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ERROR_CODES, isRetryable } from "../../lib/errors/taxonomy";
import type { Counts } from "./counts";

/** Error codes whose failures can't be retried; each has its own count. */
export const PERMANENT_ERROR_CODES = Object.entries(isRetryable).filter(([, retryable]) => retryable === false).map(([code]) => code);
export const RESULT_BUCKETS = ["total", "completed", "retryable", ...PERMANENT_ERROR_CODES.map((code) => `permanent:${code}`)];

const processed = new ShardedCounter<Id<"extractionJobs">>(components.extractionProcessedCounter, { defaultShards: 64 });
const failed = new ShardedCounter<Id<"extractionJobs">>(components.extractionFailedCounter, { defaultShards: 64 });
const results = new ShardedCounter<string>(components.extractionResultCounter, { defaultShards: 64 });
const key = (jobId: Id<"extractionJobs">, bucket: string) => `${jobId}|${bucket}`;

/** A job's counts as the old counters held them. */
export async function legacyCounts(ctx: Pick<QueryCtx, "runQuery">, jobId: Id<"extractionJobs">): Promise<Counts> {
  const buckets = [...RESULT_BUCKETS, ...ERROR_CODES.map((code) => `error:${code}`)];
  const [p, f, ...rest] = await Promise.all([
    processed.count(ctx, jobId),
    failed.count(ctx, jobId),
    ...buckets.map((bucket) => results.count(ctx, key(jobId, bucket))),
  ]);
  return Object.fromEntries([["processed", p], ["failed", f], ...buckets.map((bucket, i) => [bucket, rest[i]!] as const)].filter(([, n]) => n !== 0));
}
