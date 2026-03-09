import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  screeningJobStatusValidator,
  screeningQuestionValidator,
  screeningScoringConfigValidator,
  screeningResultStatusValidator,
} from "./validators";
import { getCurrentUser } from "../lib/auth";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";

/**
 * Get real-time progress of a screening job.
 *
 * Returns a reactive progress object for the UI, or null if:
 * - User is not authenticated
 * - Job does not exist
 * - Job belongs to another user (user isolation, no info leak)
 */
export const getScreeningProgress = query({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      status: screeningJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      qualifiedPapers: v.number(),
      percentComplete: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;

    const percentComplete =
      job.totalPapers === 0
        ? 0
        : Math.round((job.processedPapers / job.totalPapers) * 100);

    return {
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: job.processedPapers,
      failedPapers: job.failedPapers,
      qualifiedPapers: job.qualifiedPapers,
      percentComplete,
    };
  },
});

/**
 * Get the full screening job record.
 *
 * Returns the complete job document for the authenticated owner, or null
 * if the user is not authenticated, the job doesn't exist, or it belongs
 * to another user.
 */
export const getScreeningJob = query({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("screeningJobs"),
      _creationTime: v.number(),
      userId: v.id("users"),
      status: screeningJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      qualifiedPapers: v.number(),
      questions: v.array(v.object({ key: v.string(), question: v.string() })),
      scoringConfig: v.object({
        rules: v.array(
          v.object({
            questionKey: v.string(),
            yesPoints: v.number(),
            noPoints: v.number(),
            nullPoints: v.number(),
          })
        ),
        starThresholds: v.array(
          v.object({
            minScore: v.number(),
            maxScore: v.number(),
            stars: v.number(),
          })
        ),
        minimumScore: v.optional(v.number()),
      }),
      targetCollectionId: v.optional(v.id("collections")),
      workflowId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;

    return {
      _id: job._id,
      _creationTime: job._creationTime,
      userId: job.userId,
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: job.processedPapers,
      failedPapers: job.failedPapers,
      qualifiedPapers: job.qualifiedPapers,
      questions: job.questions,
      scoringConfig: job.scoringConfig,
      targetCollectionId: job.targetCollectionId,
      workflowId: job.workflowId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    };
  },
});

// ═══════════════════════════════════════════════════════════════
// INTERNAL QUERIES (for workflow/workpool background context)
// ═══════════════════════════════════════════════════════════════

/**
 * Load a screening job by ID from background context (no auth).
 *
 * Used by the screening workflow and onComplete handlers where
 * there is no user identity available.
 */
export const getJobInternal = internalQuery({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("screeningJobs"),
      userId: v.id("users"),
      status: screeningJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      qualifiedPapers: v.number(),
      questions: v.array(screeningQuestionValidator),
      scoringConfig: screeningScoringConfigValidator,
      targetCollectionId: v.optional(v.id("collections")),
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
      qualifiedPapers: job.qualifiedPapers,
      questions: job.questions,
      scoringConfig: job.scoringConfig,
      targetCollectionId: job.targetCollectionId,
      workflowId: job.workflowId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  },
});

/**
 * Load pending screening results for a job from background context (no auth).
 *
 * Returns up to MAX_SCREENING_PAPERS_PER_JOB pending results for
 * the workflow to enqueue into the workpool.
 */
export const getPendingResults = internalQuery({
  args: { jobId: v.id("screeningJobs") },
  returns: v.array(
    v.object({
      _id: v.id("screeningResults"),
      openalexId: v.string(),
      title: v.string(),
      abstract: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      publicationYear: v.optional(v.number()),
      doi: v.optional(v.string()),
      status: screeningResultStatusValidator,
    })
  ),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("screeningResults")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "pending")
      )
      .take(MAX_SCREENING_PAPERS_PER_JOB);

    return results.map((r) => ({
      _id: r._id,
      openalexId: r.openalexId,
      title: r.title,
      abstract: r.abstract,
      authors: r.authors,
      publicationYear: r.publicationYear,
      doi: r.doi,
      status: r.status,
    }));
  },
});
