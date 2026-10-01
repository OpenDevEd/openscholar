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

/**
 * Counts a charge. Safe to call again for the same row. The counts are queued
 * and applied by the aggregate's own batch worker, so charges settling at the
 * same moment don't conflict on the newest nodes; reads use `stale: true`.
 */
export async function countUsage(
  ctx: MutationCtx,
  row: Pick<Doc<"billingUsage">, "_id" | "userId" | "jobId" | "createdAt" | "kind" | "credits">,
) {
  const item = { key: row.createdAt, id: row._id };
  await usageAgg.enqueueBatch(ctx, [
    { type: "insertIfDoesNotExist", namespace: userSpace(row.userId), ...item },
    // Refunds are recorded before their credits are known, and the chart leaves them out.
    ...(row.kind !== "refund"
      ? [{ type: "insertIfDoesNotExist" as const, namespace: spendSpace(row.userId, row.kind), ...item, sumValue: row.credits }]
      : []),
    ...(row.jobId ? [{ type: "insertIfDoesNotExist" as const, namespace: jobSpace(row.jobId), ...item }] : []),
  ]);
}

/** The one way to add a charge row: inserts it and counts it. */
export async function insertUsage(ctx: MutationCtx, row: Omit<Doc<"billingUsage">, "_id" | "_creationTime">) {
  const _id = await ctx.db.insert("billingUsage", row);
  await countUsage(ctx, { _id, ...row });
  return _id;
}
