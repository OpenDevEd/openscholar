/**
 * Records every charge in `usageAgg`, keyed by its time:
 * - under the workspace that paid (#650) and, when it has one, its job, so the billing page
 *   can jump to any page of charges;
 * - under that workspace and its kind with its credits as the sum, so the spending chart
 *   can total any day without reading the charges.
 * A charge of an account purged before workspaces names no workspace, and is counted under none.
 */
import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

export const usageAgg = new DirectAggregate<{ Namespace: string; Key: number; Id: string }>(components.usageAgg);

export const workspaceSpace = (workspaceId: Id<"workspaces">) => `workspace:${workspaceId}`;
export const jobSpace = (jobId: Id<"extractionJobs">) => `job:${jobId}`;
export const spendSpace = (workspaceId: Id<"workspaces">, kind: Doc<"billingUsage">["kind"]) => `spend:${workspaceId}:${kind}`;

type Counted = Pick<Doc<"billingUsage">, "_id" | "workspaceId" | "jobId" | "createdAt" | "kind" | "credits">;

/** The aggregate writes that count a charge: under the workspace that paid, its kind (with its credits), and its job. */
export function usageOps(row: Counted) {
  const item = { key: row.createdAt, id: row._id };
  const workspaceId = row.workspaceId;
  return [
    ...(workspaceId ? [{ type: "insertIfDoesNotExist" as const, namespace: workspaceSpace(workspaceId), ...item }] : []),
    // Refunds are recorded before their credits are known, and the chart leaves them out.
    ...(workspaceId && row.kind !== "refund"
      ? [{ type: "insertIfDoesNotExist" as const, namespace: spendSpace(workspaceId, row.kind), ...item, sumValue: row.credits }]
      : []),
    ...(row.jobId ? [{ type: "insertIfDoesNotExist" as const, namespace: jobSpace(row.jobId), ...item }] : []),
  ];
}
