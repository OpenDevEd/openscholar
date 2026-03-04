import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { requirePublicDebugEnabled } from "../lib/debug_gate";

/**
 * Diagnostic query to inspect extraction job status, paper counts, and processing state.
 *
 * @production STAGING ONLY -- gated by ENABLE_PUBLIC_DEBUG_FUNCTIONS env var.
 * Gate: requirePublicDebugEnabled() throws FORBIDDEN when env var is not "true".
 * Auth: Requires authenticated user via ctx.auth.getUserIdentity().
 */
export const diagnoseJob = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    job: v.object({
      status: v.string(),
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      workflowId: v.optional(v.string()),
    }),
    papersSummary: v.object({
      total: v.number(),
      withWorkIds: v.number(),
      withoutWorkIds: v.number(),
      byStatus: v.record(v.string(), v.number()),
    }),
    samplePapers: v.array(v.object({
      id: v.id("extractionPapers"),
      title: v.string(),
      status: v.string(),
      workId: v.optional(v.string()),
      pdfUrl: v.string(),
    })),
    failedPapersDetails: v.array(v.object({
      id: v.id("extractionPapers"),
      title: v.string(),
      pdfUrl: v.optional(v.string()),
      errorMessage: v.string(),
    })),
  }),
  handler: async (ctx, args) => {
    requirePublicDebugEnabled();

    const user = await requireAuth(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) {
      throw createError("FORBIDDEN", "Unauthorized access");
    }

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    const statusCounts = papers.reduce((acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const papersWithWorkIds = papers.filter((p) => p.workId).length;
    const papersWithoutWorkIds = papers.length - papersWithWorkIds;

    return {
      job: {
        status: job.status,
        totalPapers: job.totalPapers,
        processedPapers: job.processedPapers,
        failedPapers: job.failedPapers,
        workflowId: job.workflowId,
      },
      papersSummary: {
        total: papers.length,
        withWorkIds: papersWithWorkIds,
        withoutWorkIds: papersWithoutWorkIds,
        byStatus: statusCounts,
      },
      samplePapers: papers.slice(0, 5).map((p) => ({
        id: p._id,
        title: p.title.substring(0, 50),
        status: p.status,
        workId: p.workId,
        pdfUrl: p.pdfUrl ? "Yes" : "No",
      })),
      failedPapersDetails: papers
        .filter((p) => p.status === "failed" && p.pdfUrl)
        .slice(0, 5)
        .map((p) => ({
          id: p._id,
          title: p.title.substring(0, 50),
          pdfUrl: p.pdfUrl?.substring(0, 80),
          errorMessage: p.errorMessage || "No error message",
        })),
    };
  },
});
