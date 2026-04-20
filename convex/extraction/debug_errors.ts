import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { assertNonProd } from "../lib/assertNonProd";

/**
 * Debug query to retrieve papers that failed during extraction with error details.
 *
 * Access: Internal only (internalQuery) -- not exposed to clients.
 */
export const getFailedPapersDebug = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    failedPapers: v.array(v.object({
      id: v.id("extractionPapers"),
      title: v.string(),
      pdfUrl: v.string(),
      errorMessage: v.string(),
      status: v.string(),
    })),
    downloadFailedPapers: v.array(v.object({
      id: v.id("extractionPapers"),
      title: v.string(),
      pdfUrl: v.string(),
      errorMessage: v.string(),
      status: v.string(),
    })),
    totalFailed: v.number(),
    totalDownloadFailed: v.number(),
  }),
  handler: async (ctx, args) => {
    assertNonProd();
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
        errorMessage: p.lastError?.message || "No error message",
        status: p.status,
      })),
      downloadFailedPapers: downloadFailedPapers.map((p) => ({
        id: p._id,
        title: p.title.substring(0, 50),
        pdfUrl: p.pdfUrl ? "Yes" : "No",
        errorMessage: p.lastError?.message || "No PDF URL",
        status: p.status,
      })),
      totalFailed: failedPapers.length,
      totalDownloadFailed: downloadFailedPapers.length,
    };
  },
});
