/**
 * Per-job processed/failed paper counters backed by
 * `@convex-dev/sharded-counter`. Replaces the mutable
 * `processedPapers`/`failedPapers` fields on the `extractionJobs` row.
 *
 * Why this exists: every paper that reaches a terminal state used to
 * patch the owning job's singleton row to bump the counter. Under
 * P-way queue fan-out, every concurrent terminal transition
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
 *   - `countPaperChange` is the database trigger on `extractionPapers`
 *     (`convex/lib/triggers.ts`). A paper counts as processed while it is
 *     completed and as failed while it is in another terminal status, so a
 *     retry that puts a paper back to extracting takes it out of the count
 *     and finishing it again puts it back (#351). Counting from each paper's
 *     current status keeps the counters exact whichever function writes it.
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
import type { Change } from "convex-helpers/server/triggers";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { isTerminalPaperStatus } from "./paperLifecycle";

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

/** The counter a paper counts in: finished papers the job processes. */
function outcomeOf(paper: Pick<Doc<"extractionPapers">, "status" | "processable">) {
  if (paper.processable === false || !isTerminalPaperStatus(paper.status)) return null;
  return paper.status === "completed" ? jobProcessedCounter : jobFailedCounter;
}

/** Keeps the processed and failed counts in step with each paper's status. */
export async function countPaperChange(
  ctx: RunMutationCtx,
  change: Change<DataModel, "extractionPapers">,
): Promise<void> {
  const before = change.oldDoc && outcomeOf(change.oldDoc);
  const after = change.newDoc && outcomeOf(change.newDoc);
  if (before === after && change.oldDoc?.jobId === change.newDoc?.jobId) return;
  if (before) await before.dec(ctx, change.oldDoc!.jobId);
  if (after) await after.inc(ctx, change.newDoc!.jobId);
}

/** Sets a job's processed and failed counts, as the recount for jobs saved before counting does. */
export async function setJobCounters(
  ctx: RunMutationCtx,
  jobId: Id<"extractionJobs">,
  counts: JobCounters,
): Promise<void> {
  await clearJobCounters(ctx, jobId);
  if (counts.processed) await jobProcessedCounter.add(ctx, jobId, counts.processed);
  if (counts.failed) await jobFailedCounter.add(ctx, jobId, counts.failed);
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
