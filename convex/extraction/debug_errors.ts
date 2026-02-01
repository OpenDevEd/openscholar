import { query } from "../_generated/server";
import { v } from "convex/values";

// Debug query to get detailed error information for failed papers
export const getFailedPapersDebug = query({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();

    if (!user) {
      throw new Error("Unauthorized");
    }

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) {
      throw new Error("Job not found");
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
