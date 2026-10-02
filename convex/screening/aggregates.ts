import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { SCREENING_TERMINAL_RESULT_STATUSES } from "./lifecycle";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { readShardedCounts } from "./resultCounts";
import { progressRow } from "./bookkeeping";

type RunMutationCtx = MutationCtx;
type RunQueryCtx = QueryCtx | MutationCtx;

type TerminalStatus = (typeof SCREENING_TERMINAL_RESULT_STATUSES)[number];

export const screeningResultStatusAgg = new DirectAggregate<{
  Namespace: Id<"screeningJobs">;
  Key: TerminalStatus;
  Id: Id<"screeningResults">;
}>(components.screeningResultStatusAgg);

export const screeningQualifiedAgg = new DirectAggregate<{
  Namespace: Id<"screeningJobs">;
  Key: Id<"screeningResults">;
  Id: Id<"screeningResults">;
}>(components.screeningQualifiedAgg);

export type ScreeningResultForAggregate = Pick<
  Doc<"screeningResults">,
  "_id" | "jobId" | "status" | "qualified"
>;

export type ScreeningProgressCounts = {
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  qualifiedCount: number;
};

export async function recordTerminalResult(
  ctx: RunMutationCtx,
  result: ScreeningResultForAggregate,
): Promise<void> {
  if (!SCREENING_TERMINAL_RESULT_STATUSES.includes(result.status as TerminalStatus)) {
    return;
  }

  await screeningResultStatusAgg.insertIfDoesNotExist(ctx, {
    namespace: result.jobId,
    key: result.status as TerminalStatus,
    id: result._id,
  });
}

export async function forgetTerminalResult(
  ctx: RunMutationCtx,
  result: ScreeningResultForAggregate,
): Promise<void> {
  if (!SCREENING_TERMINAL_RESULT_STATUSES.includes(result.status as TerminalStatus)) {
    return;
  }

  await screeningResultStatusAgg.deleteIfExists(ctx, {
    namespace: result.jobId,
    key: result.status as TerminalStatus,
    id: result._id,
  });
}

export async function recordQualifiedResult(
  ctx: RunMutationCtx,
  result: ScreeningResultForAggregate,
): Promise<void> {
  if (result.status !== "completed" || result.qualified !== true) {
    return;
  }

  await screeningQualifiedAgg.insertIfDoesNotExist(ctx, {
    namespace: result.jobId,
    key: result._id,
    id: result._id,
  });
}

export async function forgetQualifiedResult(
  ctx: RunMutationCtx,
  result: ScreeningResultForAggregate,
): Promise<void> {
  if (result.status !== "completed" || result.qualified !== true) {
    return;
  }

  await screeningQualifiedAgg.deleteIfExists(ctx, {
    namespace: result.jobId,
    key: result._id,
    id: result._id,
  });
}

export async function clearScreeningAggregates(
  ctx: RunMutationCtx,
  jobId: Id<"screeningJobs">,
): Promise<void> {
  await Promise.all([
    screeningResultStatusAgg.clear(ctx, { namespace: jobId }),
    screeningQualifiedAgg.clear(ctx, { namespace: jobId }),
  ]);
}

/**
 * A job's progress counts: its progress row, which the bookkeeping worker keeps
 * (./bookkeeping.ts). A job the worker hasn't touched and the migration hasn't reached
 * still reads its sharded counters or, before those, its aggregates; remove those reads
 * once every deployment has run migrations/moveScreeningJobProgress.
 */
export async function readScreeningProgressCounts(
  ctx: RunQueryCtx,
  job: Pick<Doc<"screeningJobs">, "_id" | "resultCounts">,
): Promise<ScreeningProgressCounts> {
  const progress = await progressRow(ctx, job._id);
  if (progress) {
    return { completedCount: progress.completed, skippedCount: progress.skipped, failedCount: progress.failed, qualifiedCount: progress.qualified };
  }
  if (job.resultCounts === "sharded") return readShardedCounts(ctx, job._id);
  const jobId = job._id;
  const [statusCounts, qualifiedCount] = await Promise.all([
    screeningResultStatusAgg.countBatch(ctx, [
      { namespace: jobId, bounds: { eq: "completed" } },
      { namespace: jobId, bounds: { eq: "skipped" } },
      { namespace: jobId, bounds: { eq: "failed" } },
    ]),
    screeningQualifiedAgg.count(ctx, { namespace: jobId }),
  ]);

  return {
    completedCount: statusCounts[0] ?? 0,
    skippedCount: statusCounts[1] ?? 0,
    failedCount: statusCounts[2] ?? 0,
    qualifiedCount,
  };
}
