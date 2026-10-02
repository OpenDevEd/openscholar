/**
 * Records every charge in `usageAgg`, keyed by its time:
 * - under its user and, when it has one, its job, so the billing page can jump
 *   to any page of charges;
 * - under its user and kind with its credits as the sum, so the spending chart
 *   can total any day without reading the charges.
 */
import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const usageAgg = new DirectAggregate<{ Namespace: string; Key: number; Id: string }>(components.usageAgg);

export const userSpace = (userId: Id<"users">) => `user:${userId}`;
export const jobSpace = (jobId: Id<"extractionJobs">) => `job:${jobId}`;
export const spendSpace = (userId: Id<"users">, kind: Doc<"billingUsage">["kind"]) => `spend:${userId}:${kind}`;

type Counted = Pick<Doc<"billingUsage">, "_id" | "userId" | "jobId" | "createdAt" | "kind" | "credits">;

/** The aggregate writes that count a charge: under its user, its kind (with its credits), and its job. */
export function usageOps(row: Counted) {
  const item = { key: row.createdAt, id: row._id };
  return [
    { type: "insertIfDoesNotExist" as const, namespace: userSpace(row.userId), ...item },
    // Refunds are recorded before their credits are known, and the chart leaves them out.
    ...(row.kind !== "refund"
      ? [{ type: "insertIfDoesNotExist" as const, namespace: spendSpace(row.userId, row.kind), ...item, sumValue: row.credits }]
      : []),
    ...(row.jobId ? [{ type: "insertIfDoesNotExist" as const, namespace: jobSpace(row.jobId), ...item }] : []),
  ];
}

/**
 * Counts a charge, queued to the aggregate's own batch worker, so reads use
 * `stale: true`. Safe to call again for the same row.
 */
export async function countUsage(ctx: MutationCtx, row: Counted) {
  await usageAgg.enqueueBatch(ctx, usageOps(row));
}
