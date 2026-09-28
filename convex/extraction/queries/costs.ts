/** Live credit total for one job, for the cost badge and completion toast. */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import { resolveOwnedJob } from "../access";
import { creditsAgg } from "../aggregates";

/**
 * Live per-job cost. Returns zeros for an unowned or missing job
 * (caller-safe: prevents scope leaks through the error channel).
 */
export const getJobCost = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    total: v.number(),
  }),
  handler: async (ctx, { jobId }) => {
    const owned = await resolveOwnedJob(ctx, jobId);
    if (owned.status !== "ok") {
      return { total: 0 };
    }

    const total = await creditsAgg.sum(ctx, { namespace: jobId });
    return { total };
  },
});
