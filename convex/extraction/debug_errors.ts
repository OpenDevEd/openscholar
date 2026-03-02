import { query } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { requireAuth } from "../lib/auth";
import { requirePublicDebugEnabled } from "../lib/debug_gate";

/**
 * Debug query to retrieve papers that failed during extraction with error details.
 *
 * @production STAGING ONLY -- gated by ENABLE_PUBLIC_DEBUG_FUNCTIONS env var.
 * Gate: requirePublicDebugEnabled() throws FORBIDDEN when env var is not "true".
 * Auth: Requires authenticated user via ctx.auth.getUserIdentity().
 */
export const getFailedPapersDebug = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    requirePublicDebugEnabled();

    const user = await requireAuth(ctx);

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) {
      throw createError("FORBIDDEN", "Unauthorized access");
    }

    // Get failed papers with error messages
    const failedPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "failed")
      )
      .take(20);

    const downloadFailedPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "download_failed")
      )
      .take(10);

    return {
      failedPapers: failedPapers.map((p) => ({
        id: p._id,
        title: p.title.substring(0, 50),
        pdfUrl: p.pdfUrl ? p.pdfUrl.substring(0, 80) : "No URL",
        errorMessage: p.errorMessage || "No error message",
        status: p.status,
      })),
      downloadFailedPapers: downloadFailedPapers.map((p) => ({
        id: p._id,
        title: p.title.substring(0, 50),
        pdfUrl: p.pdfUrl ? "Yes" : "No",
        errorMessage: p.errorMessage || "No PDF URL",
        status: p.status,
      })),
      totalFailed: failedPapers.length,
      totalDownloadFailed: downloadFailedPapers.length,
    };
  },
});
