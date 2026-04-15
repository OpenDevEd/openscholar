import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  extractionJobStatusValidator,
  extractionQuestionValidator,
} from "./validators";
import { getCurrentUser } from "../lib/auth";
import { MAX_EXTRACTION_PAPERS_PER_JOB } from "../lib/queryBounds";

/**
 * Get real-time progress of an extraction job.
 *
 * Returns a reactive progress object for the UI, or null if:
 * - User is not authenticated
 * - Job does not exist
 * - Job belongs to another user (user isolation, no info leak per T-89-05)
 */
export const getExtractionProgress = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      status: extractionJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      percentComplete: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;

    const TERMINAL_STATUSES = ["completed", "cancelled", "failed"];
    const isTerminal = TERMINAL_STATUSES.includes(job.status);
    const handled = job.processedPapers + job.failedPapers;

    const rawPercent =
      job.totalPapers === 0
        ? 0
        : Math.floor((handled / job.totalPapers) * 100);

    // Never show 100% while the job is still active -- avoids the
    // Math.round(99.5)->100 rounding bug and the transaction-gap
    // window between counter increment and status finalization.
    const percentComplete = isTerminal ? 100 : Math.min(rawPercent, 99);

    return {
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: job.processedPapers,
      failedPapers: job.failedPapers,
      percentComplete,
    };
  },
});

/**
 * List extraction jobs for the authenticated user, newest first.
 *
 * Returns a paginated list of job summaries (default limit 20).
 * Returns empty array for unauthenticated users.
 */
export const listUserExtractionJobs = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("extractionJobs"),
      status: extractionJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const jobs = await ctx.db
      .query("extractionJobs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 20);

    return jobs.map((j) => ({
      _id: j._id,
      status: j.status,
      totalPapers: j.totalPapers,
      processedPapers: j.processedPapers,
      failedPapers: j.failedPapers,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    }));
  },
});

// ===================================================================
// INTERNAL QUERIES (for workflow/workpool background context)
// ===================================================================

/**
 * Load an extraction job by ID from background context (no auth).
 *
 * Used by the extraction workflow and onComplete handlers where
 * there is no user identity available.
 */
export const getJobInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("extractionJobs"),
      userId: v.id("users"),
      status: extractionJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      questions: v.array(extractionQuestionValidator),
      workflowId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;

    return {
      _id: job._id,
      userId: job.userId,
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: job.processedPapers,
      failedPapers: job.failedPapers,
      questions: job.questions,
      workflowId: job.workflowId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  },
});

/**
 * Load pending extraction papers for a job from background context (no auth).
 *
 * Returns up to MAX_EXTRACTION_PAPERS_PER_JOB pending papers for
 * the workflow to enqueue into the workpool.
 */
export const getPendingPapers = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.array(
    v.object({
      _id: v.id("extractionPapers"),
      openalexId: v.string(),
      title: v.string(),
      doi: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "pending")
      )
      .take(MAX_EXTRACTION_PAPERS_PER_JOB);

    return papers.map((p) => ({
      _id: p._id,
      openalexId: p.openalexId,
      title: p.title,
      doi: p.doi,
    }));
  },
});
