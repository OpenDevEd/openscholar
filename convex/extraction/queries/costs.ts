/**
 * Job-scoped credit-cost queries (plan-04). Surfaces the live total and
 * per-billing-type breakdown for a single job, driving the header cost
 * badge, the completion toast, and the billing-page job filter.
 *
 *   total     — creditsAgg.sum(namespace: jobId). O(log n) regardless
 *               of job size. Namespaced so a paper finishing on job-A
 *               does not invalidate queries for job-B.
 *   breakdown — per-billingType sums from creditTransactions by_job.
 *               Bounded by the debit count for this one job (papers ×
 *               questions + one embedding row per paper), not the
 *               global ledger.
 *
 * The query is subscribed by CostBadge + the completion-toast effect;
 * both rely on Convex reactivity to push updates as results arrive.
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import { resolveOwnedJob } from "../access";
import { creditsAgg } from "../aggregates";

export const costBreakdownValidator = v.object({
  extraction_llm: v.number(),
  embedding: v.number(),
  screening: v.number(),
  chat: v.number(),
  other: v.number(),
});

export type CostBreakdown = {
  extraction_llm: number;
  embedding: number;
  screening: number;
  chat: number;
  other: number;
};

/**
 * Live per-job cost. Returns zeros for an unowned or missing job
 * (caller-safe: prevents scope leaks through the error channel).
 */
export const getJobCost = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    total: v.number(),
    breakdown: costBreakdownValidator,
  }),
  handler: async (ctx, { jobId }) => {
    const owned = await resolveOwnedJob(ctx, jobId);
    if (owned.status !== "ok") {
      return {
        total: 0,
        breakdown: {
          extraction_llm: 0,
          embedding: 0,
          screening: 0,
          chat: 0,
          other: 0,
        },
      };
    }

    const total = await creditsAgg.sum(ctx, { namespace: jobId });

    const rows = await ctx.db
      .query("creditTransactions")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();

    const breakdown: CostBreakdown = {
      extraction_llm: 0,
      embedding: 0,
      screening: 0,
      chat: 0,
      other: 0,
    };

    for (const row of rows) {
      if (row.type !== "usage") continue;
      const absAmount = Math.abs(row.amount);
      const bucket = row.billingType ?? "other";
      if (bucket in breakdown) {
        breakdown[bucket as keyof CostBreakdown] += absAmount;
      } else {
        breakdown.other += absAmount;
      }
    }

    return { total, breakdown };
  },
});
