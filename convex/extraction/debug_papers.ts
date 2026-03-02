import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requirePublicDebugEnabled } from "../lib/debug_gate";

/**
 * Internal query to retrieve paper error details for a given extraction job.
 *
 * @production STAGING ONLY -- gated by ENABLE_PUBLIC_DEBUG_FUNCTIONS env var.
 * Gate: requirePublicDebugEnabled() throws FORBIDDEN when env var is not "true".
 * Access: Internal only (internalQuery) -- not exposed to clients.
 */
export const getPaperErrorsInternal = internalQuery({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (ctx, args) => {
    requirePublicDebugEnabled();
    const failedPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "failed")
      )
      .take(10);

    return failedPapers.map((p) => ({
      id: p._id,
      title: p.title,
      pdfUrl: p.pdfUrl,
      errorMessage: p.errorMessage,
      completedAt: p.completedAt,
    }));
  },
});
