/**
 * Plan-07 — failures-by-code summary for the mixed-success callout.
 *
 * On a completed-with-failures job, the UI renders "Completed with
 * partial success — 473/500 questions answered. 27 failed: 15 rate
 * limits, 8 PDF invalid, 4 context too long." This query supplies
 * the `byCode` + `total` breakdown for the failure line AND the
 * answered/total counts for the headline, so the component does not
 * need to reason about paginated result slices.
 *
 * Data source: the job's result and paper error counters
 * (`../resultCounts.ts`), kept by triggers on every write, so the query
 * reads a few counters however large the job is (#351). Answered =
 * completed results, total = every result.
 *
 * The summarization itself is pure (`lib/extraction/failures-summary.ts`).
 *
 * Caller-safe: returns zeros for unowned / missing jobs, matching
 * queries/costs.ts and queries/retry.ts.
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import { resolveOwnedJob } from "../access";
import { summarizeFailures } from "../../../lib/extraction/failures-summary";
import { readPaperErrorCounts, readResultCounts } from "../resultCounts";

export const getMixedSuccessSummary = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    total: v.number(),
    byCode: v.array(
      v.object({
        code: v.string(),
        count: v.number(),
        retryable: v.boolean(),
      }),
    ),
    answeredTotal: v.number(),
    totalQuestions: v.number(),
  }),
  handler: async (ctx, { jobId }) => {
    const owned = await resolveOwnedJob(ctx, jobId);
    if (owned.status !== "ok") {
      return {
        total: 0,
        byCode: [],
        answeredTotal: 0,
        totalQuestions: 0,
      };
    }

    const [counts, errors] = await Promise.all([readResultCounts(ctx, jobId), readPaperErrorCounts(ctx, jobId)]);
    return {
      ...summarizeFailures(errors),
      answeredTotal: counts.completed,
      totalQuestions: counts.total,
    };
  },
});
