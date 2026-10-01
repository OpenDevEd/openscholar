/**
 * Counts of a Screen all job's finished papers, kept by a database trigger on every write to
 * `screeningResults` (`convex/lib/triggers.ts`), so progress and the job's finish read a few
 * counters (#383). The aggregates in ./aggregates.ts kept a job's papers in a few shared
 * tree nodes, so papers finishing together conflicted on them.
 *
 * Each job has one counter per bucket: completed, skipped, failed, and qualified (completed
 * papers that meet the job's minimum score). Counters are sharded, so papers finishing
 * together land on different shards.
 */
import { ShardedCounter } from "@convex-dev/sharded-counter";
import type { GenericQueryCtx } from "convex/server";
import type { Change } from "convex-helpers/server/triggers";
import { components } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { transactionCounter } from "../lib/transactionCounter";

type RunMutationCtx = MutationCtx & { innerDb?: object };
type RunQueryCtx = { runQuery: GenericQueryCtx<DataModel>["runQuery"] };
type Result = Pick<Doc<"screeningResults">, "status" | "qualified">;

// Screen all finishes a few papers at a time; each count read touches every shard, and the
// job history reads up to a hundred jobs' counts, so few shards are kept.
const counter = transactionCounter(() => new ShardedCounter<string>(components.screeningResultCounter, { defaultShards: 16 }));
const BUCKETS = ["completed", "skipped", "failed", "qualified"] as const;
type Bucket = (typeof BUCKETS)[number];
const key = (jobId: Id<"screeningJobs">, bucket: Bucket) => `${jobId}|${bucket}`;

/** The buckets a result counts in. */
export function bucketsOf(result: Result): Bucket[] {
  const buckets: Bucket[] = [];
  if (result.status === "completed" || result.status === "skipped" || result.status === "failed") buckets.push(result.status);
  if (result.status === "completed" && result.qualified === true) buckets.push("qualified");
  return buckets;
}

/** Moves a result between buckets as it's written: the trigger on `screeningResults`. */
export async function countScreeningResultChange(ctx: RunMutationCtx, change: Change<DataModel, "screeningResults">) {
  const before = change.oldDoc ? bucketsOf(change.oldDoc).map((bucket) => key(change.oldDoc!.jobId, bucket)) : [];
  const after = change.newDoc ? bucketsOf(change.newDoc).map((bucket) => key(change.newDoc!.jobId, bucket)) : [];
  for (const name of before) if (!after.includes(name)) await counter.for(ctx).dec(ctx, name);
  for (const name of after) if (!before.includes(name)) await counter.for(ctx).inc(ctx, name);
}

export type ShardedProgressCounts = { completedCount: number; skippedCount: number; failedCount: number; qualifiedCount: number };

/** A job's counts. */
export async function readShardedCounts(ctx: RunQueryCtx, jobId: Id<"screeningJobs">): Promise<ShardedProgressCounts> {
  const [completedCount, skippedCount, failedCount, qualifiedCount] = await Promise.all(BUCKETS.map((bucket) => counter.read.count(ctx, key(jobId, bucket))));
  return { completedCount, skippedCount, failedCount, qualifiedCount };
}

/** Sets a job's counts, as the recount for jobs saved before counting does. */
export async function setShardedCounts(ctx: RunMutationCtx, jobId: Id<"screeningJobs">, counts: Record<Bucket, number>) {
  for (const bucket of BUCKETS) {
    await counter.for(ctx).reset(ctx, key(jobId, bucket));
    if (counts[bucket]) await counter.for(ctx).add(ctx, key(jobId, bucket), counts[bucket]);
  }
}
