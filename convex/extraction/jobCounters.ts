/**
 * Per-job processed/failed paper counters backed by
 * `@convex-dev/sharded-counter`. Replaces the mutable
 * `processedPapers`/`failedPapers` fields on the `extractionJobs` row.
 *
 * Why this exists: every paper that reaches a terminal state used to
 * patch the owning job's singleton row to bump the counter. Under
 * P-way fan-out from the workflow, every concurrent terminal transition
 * conflicted on that single row — Convex OCC re-ran the loser, the
 * workpool blew through its retry budget, and the bottleneck capped the
 * workpool's effective parallelism. Routing the increments through a
 * 64-shard counter eliminates the write-write contention: two writers
 * almost always hit different shards.
 *
 * Tier E.2: shard count was bumped from the library default (16) to 64
 * after telemetry showed birthday-collision contention on the counter
 * rows under 50-way paper fan-out — `~p(collision) ≈ k² / (2·N)` puts
 * 50-way writers at ~78% collision risk on 16 shards versus ~18% on
 * 64. Reads still scan all shards (cheap), so the trade is favourable.
 *
 * Reads:
 *
 *   - `readJobCounters(ctx, jobId)` returns `{ processed, failed }` from
 *     a parallel `count()` of both counters. Cheap from queries; from
 *     mutations it reads all shards, so callers should treat the result
 *     as "snapshot at start of tx" the same way they would treat a row
 *     read.
 *   - `maybeFinalizeJob` in `mutations/internal/lifecycle.ts` calls
 *     `readJobCounters` in its terminal-check path. The "still going"
 *     branch is now read-only — no `updatedAt` patch — so the all-shard
 *     read does not turn into a write conflict.
 *
 * Writes:
 *
 *   - `incPaperOutcome(ctx, jobId, isSuccess)` lands one `inc()` call on
 *     a random shard. Idempotent at the workflow level via the paper's
 *     prior terminal-status check in `markPaperTerminalTx`; this helper
 *     never double-counts within a single transition because the caller
 *     guards on `isTerminalPaperStatus(paper.status)` before invoking
 *     us.
 *
 * Cascade:
 *
 *   - `clearJobCounters(ctx, jobId)` zeroes both counters for a job.
 *     Called from the admin cascade-delete path (`admin.ts`) so a
 *     dropped job leaves no orphan counter rows behind.
 */

import { ShardedCounter } from "@convex-dev/sharded-counter";
import { components } from "../_generated/api";
import type {
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import type { Id } from "../_generated/dataModel";

type RunMutationCtx = {
  runMutation: GenericMutationCtx<never>["runMutation"];
};
type RunQueryCtx = { runQuery: GenericQueryCtx<never>["runQuery"] };

const jobProcessedCounter = new ShardedCounter<Id<"extractionJobs">>(
  components.extractionProcessedCounter,
  { defaultShards: 64 },
);
const jobFailedCounter = new ShardedCounter<Id<"extractionJobs">>(
  components.extractionFailedCounter,
  { defaultShards: 64 },
);

export async function incPaperOutcome(
  ctx: RunMutationCtx,
  jobId: Id<"extractionJobs">,
  isSuccess: boolean,
): Promise<void> {
  const counter = isSuccess ? jobProcessedCounter : jobFailedCounter;
  await counter.inc(ctx, jobId);
}

export type JobCounters = {
  processed: number;
  failed: number;
};

export async function readJobCounters(
  ctx: RunQueryCtx,
  jobId: Id<"extractionJobs">,
): Promise<JobCounters> {
  const [processed, failed] = await Promise.all([
    jobProcessedCounter.count(ctx, jobId),
    jobFailedCounter.count(ctx, jobId),
  ]);
  return { processed, failed };
}

export async function clearJobCounters(
  ctx: RunMutationCtx,
  jobId: Id<"extractionJobs">,
): Promise<void> {
  await Promise.all([
    jobProcessedCounter.reset(ctx, jobId),
    jobFailedCounter.reset(ctx, jobId),
  ]);
}
