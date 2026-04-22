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
import { isTerminalScreeningJobStatus } from "./lifecycle";

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

    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job || job.userId !== user._id) return null;

    const isTerminal = isTerminalScreeningJobStatus(job.status);
    const handled = job.processedPapers + job.failedPapers;

    const rawPercent =
      job.totalPapers === 0
        ? 0
        : Math.floor((handled / job.totalPapers) * 100);

    // Never show 100% while the job is still active — avoids the
    // Math.round(99.5)→100 rounding bug and the transaction-gap
    // window between counter increment and status finalization.
    const percentComplete = isTerminal ? 100 : Math.min(rawPercent, 99);

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
            stars: v.number(),
          })
        ),
        minimumScore: v.optional(v.number()),
      }),
      targetCollectionId: v.optional(v.id("collections")),
      createdAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get("screeningJobs", args.jobId);
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
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    };
  },
});

/**
 * List screening jobs for the authenticated user, newest first.
 *
 * Returns a paginated list of job summaries (default limit 20).
 * Returns empty array for unauthenticated users.
 */
export const listUserScreeningJobs = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("screeningJobs"),
      _creationTime: v.number(),
      status: screeningJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      qualifiedPapers: v.number(),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
      questions: v.array(screeningQuestionValidator),
      targetCollectionId: v.optional(v.id("collections")),
      targetCollectionName: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const jobs = await ctx.db
      .query("screeningJobs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 20);

    return Promise.all(
      jobs.map(async (j) => ({
        _id: j._id,
        _creationTime: j._creationTime,
        status: j.status,
        totalPapers: j.totalPapers,
        processedPapers: j.processedPapers,
        qualifiedPapers: j.qualifiedPapers,
        createdAt: j.createdAt,
        completedAt: j.completedAt,
        questions: j.questions,
        targetCollectionId: j.targetCollectionId,
        targetCollectionName: j.targetCollectionId
          ? (await ctx.db.get("collections", j.targetCollectionId))?.name
          : undefined,
      }))
    );
  },
});

/**
 * Get all screening results for a job, for export.
 *
 * Returns job metadata and all results (any status) for the authenticated
 * owner, or null if unauthenticated / non-owner / job not found.
 * Results are bounded by MAX_SCREENING_PAPERS_PER_JOB.
 * Does NOT include aiMetadata or abstract (out of scope for export).
 */
export const getScreeningResultsForExport = query({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      job: v.object({
        _id: v.id("screeningJobs"),
        status: screeningJobStatusValidator,
        questions: v.array(screeningQuestionValidator),
        scoringConfig: screeningScoringConfigValidator,
        totalPapers: v.number(),
        qualifiedPapers: v.number(),
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
      }),
      results: v.array(
        v.object({
          openalexId: v.string(),
          title: v.string(),
          authors: v.optional(v.array(v.string())),
          publicationYear: v.optional(v.number()),
          doi: v.optional(v.string()),
          status: screeningResultStatusValidator,
          answers: v.optional(
            v.record(v.string(), v.union(v.boolean(), v.null()))
          ),
          score: v.optional(v.number()),
          stars: v.optional(v.number()),
          qualified: v.optional(v.boolean()),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job || job.userId !== user._id) return null;

    const results = await ctx.db
      .query("screeningResults")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_SCREENING_PAPERS_PER_JOB);

    return {
      job: {
        _id: job._id,
        status: job.status,
        questions: job.questions,
        scoringConfig: job.scoringConfig,
        totalPapers: job.totalPapers,
        qualifiedPapers: job.qualifiedPapers,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      },
      results: results.map((r) => ({
        openalexId: r.openalexId,
        title: r.title,
        authors: r.authors,
        publicationYear: r.publicationYear,
        doi: r.doi,
        status: r.status,
        answers: r.answers,
        score: r.score,
        stars: r.stars,
        qualified: r.qualified,
      })),
    };
  },
});

// ═══════════════════════════════════════════════════════════════
// INTERNAL QUERIES (for workpool/background context)
// ═══════════════════════════════════════════════════════════════

/**
 * Load a screening job by ID from background context (no auth).
 *
 * Used by workpool actions and onComplete handlers where
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
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("screeningJobs", args.jobId);
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
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  },
});

/**
 * Load a single screening result by ID from background context (no auth).
 *
 * Used by the workpool action to get paper details for AI screening.
 */
export const getResultInternal = internalQuery({
  args: { resultId: v.id("screeningResults") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("screeningResults"),
      jobId: v.id("screeningJobs"),
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
    const result = await ctx.db.get("screeningResults", args.resultId);
    if (!result) return null;

    return {
      _id: result._id,
      jobId: result.jobId,
      openalexId: result.openalexId,
      title: result.title,
      abstract: result.abstract,
      authors: result.authors,
      publicationYear: result.publicationYear,
      doi: result.doi,
      status: result.status,
    };
  },
});
