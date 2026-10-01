/**
 * @convex-dev/aggregate wiring for extraction credit totals.
 *
 * Result-stat aggregates were removed after the Report Builder/stat consumers
 * were deleted. Keeping only the cost aggregate avoids low-cardinality
 * per-answer B-tree writes on the result persistence path.
 */

import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type RunMutationCtx = MutationCtx;

/**
 * Per-job credit totals for the cost badge. One entry per settled charge,
 * written by `convex/billing/charge.ts`. Namespaced by job so one job's
 * charges don't rerun another job's queries; random keys spread parallel
 * inserts across the B-tree. Cleared when the job is deleted.
 */
export const creditsAgg = new DirectAggregate<{
  Namespace: Id<"extractionJobs">;
  Key: number;
  Id: string;
}>(components.creditsAgg);

export async function recordJobCredits(
  ctx: RunMutationCtx,
  args: { jobId: Id<"extractionJobs">; chargeId: string; credits: number },
): Promise<void> {
  await creditsAgg.insertIfDoesNotExist(ctx, {
    namespace: args.jobId,
    key: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    id: args.chargeId,
    sumValue: args.credits,
  });
}

/** Wipes a job's entries; called when the job is deleted. */
export async function clearJobCredits(
  ctx: RunMutationCtx,
  jobId: Id<"extractionJobs">,
): Promise<void> {
  await creditsAgg.clear(ctx, { namespace: jobId });
}
