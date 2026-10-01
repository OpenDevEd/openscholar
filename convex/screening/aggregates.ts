import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { SCREENING_TERMINAL_RESULT_STATUSES } from "./lifecycle";
import type { MutationCtx, QueryCtx } from "../_generated/server";

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

export async function readScreeningProgressCounts(
  ctx: RunQueryCtx,
  jobId: Id<"screeningJobs">,
): Promise<ScreeningProgressCounts> {
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
