/**
 * Plan-05 retry summary query.
 *
 * Computes the retryable / permanent split for a job's per-question
 * result rows so the UI can render the "Retry N failed" CTA and the
 * "M permanent (breakdown)" affordance. Returns zeros for an unowned
 * job — caller-safe (same pattern as queries/costs.ts).
 *
 * It reads the job's result counters (`../resultCounts.ts`), kept by a
 * trigger on every write, so it stays a few reads however large the job
 * is (#351). The summarization itself is pure (`lib/extraction/retry-summary.ts`).
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import { resolveOwnedJob } from "../access";
import { summarizeRetryable } from "../../../lib/extraction/retry-summary";
import { readResultCounts } from "../resultCounts";

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

    return summarizeRetryable(await readResultCounts(ctx, jobId));
  },
});
