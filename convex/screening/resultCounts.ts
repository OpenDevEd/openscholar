/**
 * Reads the sharded counters that counted Screen all jobs' finished papers from #383 until
 * the bookkeeping worker took over (./bookkeeping.ts). Nothing writes them any more; a job
 * the worker hasn't touched still reads them until migrations/moveScreeningJobProgress has
 * run everywhere, after which this file and its component go.
 */
import { ShardedCounter } from "@convex-dev/sharded-counter";
import type { GenericQueryCtx } from "convex/server";
import { components } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";

type RunQueryCtx = { runQuery: GenericQueryCtx<DataModel>["runQuery"] };

const counter = new ShardedCounter<string>(components.screeningResultCounter, { defaultShards: 16 });
const BUCKETS = ["completed", "skipped", "failed", "qualified"] as const;

export type ShardedProgressCounts = { completedCount: number; skippedCount: number; failedCount: number; qualifiedCount: number };

/** A job's counts. */
export async function readShardedCounts(ctx: RunQueryCtx, jobId: Id<"screeningJobs">): Promise<ShardedProgressCounts> {
  const [completedCount, skippedCount, failedCount, qualifiedCount] = await Promise.all(
    BUCKETS.map((bucket) => counter.count(ctx, `${jobId}|${bucket}`)),
  );
  return { completedCount, skippedCount, failedCount, qualifiedCount };
}
