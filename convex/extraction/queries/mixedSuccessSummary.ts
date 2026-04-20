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
 * Data source:
 *   - `extractionPaperErrors.by_job` — one row per failed attempt;
 *     bounded per job, indexed.
 *   - `extractionResults.by_job` — one row per per-question result;
 *     bounded (papers × questions). Answered = `status === "completed"`,
 *     total = row count.
 *
 * The summarization itself is pure (`lib/extraction/failures-summary.ts`);
 * this query just assembles inputs and defers classification to the
 * shared taxonomy.
 *
 * Caller-safe: returns zeros for unowned / missing jobs, matching
 * queries/costs.ts and queries/retry.ts.
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import { resolveOwnedJob } from "../access";
import {
  summarizeFailures,
  type FailureInput,
} from "../../../lib/extraction/failures-summary";

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

    const [errorRows, resultRows] = await Promise.all([
      ctx.db
        .query("extractionPaperErrors")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
      ctx.db
        .query("extractionResults")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    ]);

    const inputs: FailureInput[] = errorRows.map((row) => ({ code: row.code }));
    const failureSummary = summarizeFailures(inputs);

    let answeredTotal = 0;
    for (const r of resultRows) {
      if (r.status === "completed") answeredTotal += 1;
    }

    return {
      ...failureSummary,
      answeredTotal,
      totalQuestions: resultRows.length,
    };
  },
});
