/**
 * Plan-05 retry summary query.
 *
 * Computes the retryable / permanent split for a job's per-question
 * result rows so the UI can render the "Retry N failed" CTA and the
 * "M permanent (breakdown)" affordance. Returns zeros for an unowned
 * job — caller-safe (same pattern as queries/costs.ts).
 *
 * The summarization itself is pure (`lib/extraction/retry-summary.ts`);
 * this query just assembles inputs from extractionResults.
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import { resolveOwnedJob } from "../access";
import { loadResultsByJob } from "./_shared";
import {
  summarizeRetryable,
  type RetryableResultInput,
} from "../../../lib/extraction/retry-summary";

export const getRetryableSummary = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    retryableCount: v.number(),
    permanentCount: v.number(),
    permanentBreakdown: v.record(v.string(), v.number()),
  }),
  handler: async (ctx, { jobId }) => {
    const owned = await resolveOwnedJob(ctx, jobId);
    if (owned.status !== "ok") {
      return { retryableCount: 0, permanentCount: 0, permanentBreakdown: {} };
    }

    const resultsByPaper = await loadResultsByJob(ctx, jobId);
    const inputs: RetryableResultInput[] = [];
    for (const rows of resultsByPaper.values()) {
      for (const r of rows) {
        inputs.push({ status: r.status, lastError: r.lastError });
      }
    }
    return summarizeRetryable(inputs);
  },
});
