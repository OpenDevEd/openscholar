import { query, internalQuery, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { effortValidator } from "../aiModelConfig/validators";
import type { Doc } from "../_generated/dataModel";
import {
  screeningJobStatusValidator,
  screeningQuestionValidator,
  screeningScoringConfigValidator,
  screeningResultStatusValidator,
} from "./validators";
import { getCurrentUser } from "../lib/auth";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { availableCredits } from "../billing/accounts";
import { estimateScreening } from "./estimate";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";

/** Most screening jobs one history request lists; each one also reads its progress. */
const MAX_LISTED_SCREENING_JOBS = 100;
import { readScreeningProgressCounts } from "./aggregates";
import { buildScreeningProgressSnapshot } from "./progress";

async function readJobProgressSnapshot(
  ctx: QueryCtx,
  job: Pick<Doc<"screeningJobs">, "_id" | "status" | "totalPapers">,
) {
  const counts = await readScreeningProgressCounts(ctx, job._id);
  return buildScreeningProgressSnapshot({
    status: job.status,
    totalPapers: job.totalPapers,
    ...counts,
  });
}

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
    return await readJobProgressSnapshot(ctx, job);
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
    const progress = await readJobProgressSnapshot(ctx, job);

    return {
      _id: job._id,
      _creationTime: job._creationTime,
      userId: job.userId,
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: progress.processedPapers,
      failedPapers: progress.failedPapers,
      qualifiedPapers: progress.qualifiedPapers,
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
 * Get the latest active screening job progress for the authenticated user.
 *
 * Returns the newest processing job with aggregate-backed progress for shell UI,
 * or null when the user is unauthenticated or has no active job.
 */
export const getActiveScreeningJobProgress = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.id("screeningJobs"),
      status: screeningJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      qualifiedPapers: v.number(),
      percentComplete: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const activeJob = await ctx.db
      .query("screeningJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "processing"),
      )
      .order("desc")
      .first();

    if (!activeJob) return null;

    const progress = await readJobProgressSnapshot(ctx, activeJob);
    return {
      jobId: activeJob._id,
      status: activeJob.status,
      totalPapers: activeJob.totalPapers,
      processedPapers: progress.processedPapers,
      failedPapers: progress.failedPapers,
      qualifiedPapers: progress.qualifiedPapers,
      percentComplete: progress.percentComplete,
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
      .take(Math.min(args.limit ?? 20, MAX_LISTED_SCREENING_JOBS));

    return Promise.all(
      jobs.map(async (job) => {
        const [progress, targetCollection] = await Promise.all([
          readJobProgressSnapshot(ctx, job),
          job.targetCollectionId
            ? ctx.db.get("collections", job.targetCollectionId)
            : Promise.resolve(null),
        ]);

        return {
          _id: job._id,
          _creationTime: job._creationTime,
          status: job.status,
          totalPapers: job.totalPapers,
          processedPapers: progress.processedPapers,
          qualifiedPapers: progress.qualifiedPapers,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
          questions: job.questions,
          targetCollectionId: job.targetCollectionId,
          targetCollectionName: targetCollection?.name,
        };
      }),
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
    const progress = await readJobProgressSnapshot(ctx, job);

    const results = await ctx.db
      .query("screeningResults")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_SCREENING_PAPERS_PER_JOB);
    // What the job answered, by question key: a result whose answers haven't moved yet, waiting
    // or from before #334, still holds them; a moved one reads the model's answers from its
    // screening's history as of the move, whatever a person or a later run changed since.
    const screeningId = job.screeningId;
    const answersOf = async (result: (typeof results)[number]) => {
      if (result.answers || !screeningId || result.answersVersion === undefined) return result.answers;
      const version = result.answersVersion;
      const row = await ctx.db
        .query("screeningAnswerHistory")
        .withIndex("by_screening_and_paper_and_version", (q) => q.eq("screeningId", screeningId).eq("paperId", result.openalexId).lte("version", version))
        .order("desc")
        .first();
      if (!row) return undefined;
      return Object.fromEntries(job.questions.map((q) => {
        const entry = row.answers.find((value) => value.question === q.question);
        return [q.key, entry?.model ? entry.model.answer : (entry?.answer ?? null)];
      }));
    };
    const answers = await Promise.all(results.map(answersOf));

    return {
      job: {
        _id: job._id,
        status: job.status,
        questions: job.questions,
        scoringConfig: job.scoringConfig,
        totalPapers: job.totalPapers,
        qualifiedPapers: progress.qualifiedPapers,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      },
      results: results.map((r, i) => ({
        openalexId: r.openalexId,
        title: r.title,
        authors: r.authors,
        publicationYear: r.publicationYear,
        doi: r.doi,
        status: r.status,
        answers: answers[i],
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
      serverModelId: v.optional(v.id("models")),
      serverEffort: v.optional(effortValidator),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job) return null;
    const progress = await readJobProgressSnapshot(ctx, job);

    return {
      _id: job._id,
      userId: job.userId,
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: progress.processedPapers,
      failedPapers: progress.failedPapers,
      qualifiedPapers: progress.qualifiedPapers,
      questions: job.questions,
      scoringConfig: job.scoringConfig,
      targetCollectionId: job.targetCollectionId,
      serverModelId: job.serverModelId,
      serverEffort: job.serverEffort,
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

export const estimateAction = defineUserQuery({
  path: "screening/queries:estimate",
  description: "Estimates the credits screening a number of papers holds, against the person's balance, and how many papers that balance covers.",
  args: { papers: v.number() },
  returns: v.object({ credits: v.number(), available: v.number(), affordablePapers: v.number() }),
  run: async (ctx, userId, args) => estimateScreening(args.papers, await availableCredits(ctx, userId)),
});
export const estimate = userQuery(estimateAction);
export const estimateForAssistant = assistantQuery(estimateAction);
