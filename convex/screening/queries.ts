import { query } from "../_generated/server";
import { v } from "convex/values";
import { screeningJobStatusValidator } from "./validators";
import { getCurrentUser } from "../lib/auth";

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
