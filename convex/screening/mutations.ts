import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
  screeningPaperInputValidator,
  screeningQuestionValidator,
  screeningScoringConfigValidator,
  screeningJobStatusValidator,
} from "./validators";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { ESTIMATED_CREDITS_PER_PAPER } from "../lib/constants";
import { screeningPool } from "../workpool";
import {
  getCancelableScreeningWorkIds,
  isTerminalScreeningJobStatus,
} from "./lifecycle";
import { resolveLibraryCount } from "../library/counter";
import {
  readScreeningProgressCounts,
  recordQualifiedResult,
  recordTerminalResult,
} from "./aggregates";
import { deriveCompletionTransition } from "./completion";
import { buildScreeningProgressSnapshot } from "./progress";
import { scorePaper } from "./scoring";
import { decodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";

/**
 * Create a bulk screening job.
 *
 * Validates paper count, checks credits, guards against concurrent active jobs,
 * creates the job record with embedded questions/scoring config, inserts
 * processing result records for each paper, and enqueues each paper directly
 * into the screening workpool.
 */
export const createScreeningJob = mutation({
  args: {
    papers: v.array(screeningPaperInputValidator),
    questions: v.array(screeningQuestionValidator),
    scoringConfig: screeningScoringConfigValidator,
    targetCollectionId: v.optional(v.id("collections")),
  },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  handler: async (ctx, args) => {
    // 1. Authentication
    const user = await requireAuth(ctx);

    // 2. Validate paper count
    if (args.papers.length === 0) {
      throw createError(
        "VALIDATION_ERROR",
        "At least one paper is required"
      );
    }
    if (args.papers.length > MAX_SCREENING_PAPERS_PER_JOB) {
      throw createError(
        "VALIDATION_ERROR",
        `Cannot screen more than ${MAX_SCREENING_PAPERS_PER_JOB} papers per job`
      );
    }

    // 3. Check for active jobs
    const activeJob = await ctx.db
      .query("screeningJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "processing")
      )
      .first();

    if (activeJob) {
      throw createError(
        "SCREENING_JOB_ALREADY_ACTIVE",
        "You already have an active screening job"
      );
    }

    // 4. Credit pre-flight check
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    const totalAvailable =
      (credits?.freeBalance ?? 0) + (credits?.paidBalance ?? 0);

    const estimatedCost = Math.ceil(args.papers.length * ESTIMATED_CREDITS_PER_PAPER);
    if (totalAvailable < estimatedCost) {
      throw createError(
        "INSUFFICIENT_CREDITS",
        `Need ~${estimatedCost} credits for ${args.papers.length} papers but only have ${totalAvailable}`
      );
    }

    // 5. Create screening job record
    const now = Date.now();
    const jobId = await ctx.db.insert("screeningJobs", {
      userId: user._id,
      status: "processing",
      totalPapers: args.papers.length,
      questions: args.questions,
      scoringConfig: args.scoringConfig,
      targetCollectionId: args.targetCollectionId,
      createdAt: now,
      updatedAt: now,
    });

    // 6. Insert processing result records and enqueue their work items
    for (const paper of args.papers) {
      const resultId = await ctx.db.insert("screeningResults", {
        jobId,
        openalexId: paper.openalexId,
        title: paper.title,
        abstract: paper.abstract,
        authors: paper.authors,
        publicationYear: paper.publicationYear,
        doi: paper.doi,
        status: "processing",
        createdAt: now,
      });

      const workId = await screeningPool.enqueueAction(
        ctx,
        internal.screening.workpoolActions.screenPaperAction,
        { resultId, jobId },
        {
          onComplete: internal.screening.mutations.handleScreeningComplete,
          context: { resultId, jobId },
        }
      );

      await ctx.db.patch("screeningResults", resultId, { workId });
    }

    // 7. Return job ID
    return { jobId };
  },
});

/**
 * Cancel a running screening job.
 *
 * - Sets status to "cancelled" for non-terminal jobs
 * - Idempotent: terminal statuses (completed, cancelled, failed, creditsExhausted)
 *   are no-ops (no error, no state change)
 * - Preserves existing screening results
 * - Cancels only this job's outstanding workpool items
 */
export const cancelScreeningJob = mutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const job = await ctx.db.get("screeningJobs", args.jobId);

    if (!job || job.userId !== user._id) {
      throw createError("SCREENING_JOB_NOT_FOUND", "Screening job not found");
    }

    // Terminal states are idempotent no-ops
    if (isTerminalScreeningJobStatus(job.status)) {
      return null;
    }

    // Update job status to cancelled
    await ctx.db.patch("screeningJobs", args.jobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    const results = await ctx.db
      .query("screeningResults")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_SCREENING_PAPERS_PER_JOB);

    for (const workId of getCancelableScreeningWorkIds(results)) {
      await screeningPool.cancel(ctx, workId);
    }

    return null;
  },
});

// ═══════════════════════════════════════════════════════════════
// INTERNAL MUTATIONS (for workpool/background context)
// ═══════════════════════════════════════════════════════════════

/**
 * Marks a screening job as credits exhausted from background context.
 *
 * No-op when the job is already terminal or missing.
 */
export const markScreeningJobCreditsExhausted = internalMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job || isTerminalScreeningJobStatus(job.status)) {
      return null;
    }

    await ctx.db.patch("screeningJobs", args.jobId, {
      status: "creditsExhausted",
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Save a qualifying paper to the user's library (no auth, internal only).
 *
 * Uses upsert semantics: if paper already exists for user, updates rating.
 * If new, inserts and increments denormalized libraryItemCount.
 */
export const saveQualifiedPaperToLibrary = internalMutation({
  args: {
    userId: v.id("users"),
    openalexId: v.string(),
    rating: v.number(),
    title: v.string(),
    authors: v.optional(v.string()),
    doi: v.optional(v.string()),
    abstract: v.optional(v.string()),
    publicationYear: v.optional(v.number()),
    paperData: v.optional(v.string()),
  },
  returns: v.id("libraryItems"),
  handler: async (ctx, args) => {
    const searchableText = [args.title, args.abstract, args.authors]
      .filter(Boolean)
      .join(" ");

    // Upsert: check if paper already in user's library
    const existing = await ctx.db
      .query("libraryItems")
      .withIndex("by_user_openalexId", (q) =>
        q.eq("userId", args.userId).eq("openalexId", args.openalexId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch("libraryItems", existing._id, {
        rating: args.rating,
        searchableText,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    const user = await ctx.db.get("users", args.userId);
    const currentCount = user
      ? await resolveLibraryCount(ctx, args.userId, user.libraryItemCount)
      : null;

    // New save: insert full document
    const id = await ctx.db.insert("libraryItems", {
      userId: args.userId,
      openalexId: args.openalexId,
      rating: args.rating,
      title: args.title,
      authors: args.authors,
      doi: args.doi,
      abstract: args.abstract,
      publicationYear: args.publicationYear,
      ...(args.paperData !== undefined && { paperData: args.paperData }),
      searchableText,
      savedAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Increment denormalized counter
    if (currentCount !== null) {
      await ctx.db.patch("users", args.userId, {
        libraryItemCount: currentCount + 1,
      });
    }

    return id;
  },
});

/**
 * Add a library item to a collection (no auth, internal only).
 *
 * Idempotent: if already in collection, no-op.
 * Increments denormalized itemCount on the collection.
 */
export const addToCollectionInternal = internalMutation({
  args: {
    userId: v.id("users"),
    collectionId: v.id("collections"),
    libraryItemId: v.id("libraryItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Check for existing assignment (idempotent)
    const existing = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection_item", (q) =>
        q
          .eq("collectionId", args.collectionId)
          .eq("libraryItemId", args.libraryItemId)
      )
      .unique();

    if (existing) return null;

    await ctx.db.insert("libraryItemCollections", {
      userId: args.userId,
      collectionId: args.collectionId,
      libraryItemId: args.libraryItemId,
      assignedAt: Date.now(),
    });

    // Increment denormalized collection counter
    const collection = await ctx.db.get("collections", args.collectionId);
    if (collection) {
      const currentCount = collection.itemCount ?? 0;
      await ctx.db.patch("collections", args.collectionId, { itemCount: currentCount + 1 });
    }

    return null;
  },
});

/**
 * Persist a qualified screening result into the user's library and collection.
 *
 * Idempotent by result state plus the underlying library/collection helpers.
 */
export const persistQualifiedScreeningResult = internalMutation({
  args: { resultId: v.id("screeningResults") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const screeningResult = await ctx.db.get(
      "screeningResults",
      args.resultId,
    ) as Doc<"screeningResults"> | null;
    if (
      !screeningResult ||
      screeningResult.status !== "completed" ||
      screeningResult.qualified !== true ||
      screeningResult.libraryItemId
    ) {
      return null;
    }

    const job = await ctx.db.get("screeningJobs", screeningResult.jobId) as
      | Doc<"screeningJobs">
      | null;
    if (!job) {
      return null;
    }

    const libraryItemId = await ctx.runMutation(
      internal.screening.mutations.saveQualifiedPaperToLibrary,
      {
        userId: job.userId,
        openalexId: screeningResult.openalexId,
        rating: screeningResult.stars ?? 0,
        title: screeningResult.title,
        authors: screeningResult.authors?.join(", "),
        doi: screeningResult.doi,
        abstract: screeningResult.abstract,
        publicationYear: screeningResult.publicationYear,
      },
    );

    if (job.targetCollectionId) {
      await ctx.runMutation(
        internal.screening.mutations.addToCollectionInternal,
        {
          userId: job.userId,
          collectionId: job.targetCollectionId,
          libraryItemId,
        },
      );
    }

    await ctx.db.patch("screeningResults", screeningResult._id, {
      savedToLibrary: true,
      libraryItemId,
    });

    return null;
  },
});

/**
 * Check if a screening job is done and finalize it from aggregate-backed counts.
 *
 * Terminal statuses (completed/cancelled/failed/creditsExhausted) are no-ops.
 */
export const finalizeScreeningJobFromAggregates = internalMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job) return null;

    // Terminal states are no-ops
    if (isTerminalScreeningJobStatus(job.status)) {
      return null;
    }

    const counts = await readScreeningProgressCounts(ctx, args.jobId);
    const progress = buildScreeningProgressSnapshot({
      status: job.status,
      totalPapers: job.totalPapers,
      ...counts,
    });

    if (progress.processedPapers + progress.failedPapers >= job.totalPapers) {
      const now = Date.now();
      await ctx.db.patch("screeningJobs", args.jobId, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });

      // Fire screening_job_completed event (async, fire-and-forget)
      const user = await ctx.db.get("users", job.userId);
      if (user?.clerkId) {
        await ctx.scheduler.runAfter(0, internal.lib.analytics.captureEvent, {
          distinctId: user.clerkId,
          event: "screening_job_completed",
          properties: {
            total_papers: job.totalPapers,
            processed_papers: progress.processedPapers,
            failed_papers: progress.failedPapers,
            qualified_papers: progress.qualifiedPapers,
            question_count: job.questions.length,
            duration_ms: job.createdAt ? now - job.createdAt : 0,
          },
        });
      }
    }

    return null;
  },
});

/**
 * Workpool onComplete handler for individual paper screening.
 *
 * Patches only the target screening result row, records aggregate state, and
 * schedules any secondary work as follow-up mutations.
 */
export const handleScreeningComplete = screeningPool.defineOnComplete({
  context: v.object({
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    const job = await ctx.db.get("screeningJobs", context.jobId) as
      | Doc<"screeningJobs">
      | null;
    const screeningResult = await ctx.db.get(
      "screeningResults",
      context.resultId,
    ) as Doc<"screeningResults"> | null;
    if (!job || !screeningResult) {
      return;
    }

    let transition;
    if (result.kind === "success" && job.status === "processing") {
      const data = result.returnValue as {
        responses: Record<string, boolean | null>;
        confidence: number;
      };
      const decodedResponses = decodeQuestionResponseMap(data.responses);
      const answers: Record<string, boolean | null> = {};
      for (const q of job.questions) {
        const response = decodedResponses[q.question];
        answers[q.key] = response ?? null;
      }

      const { score, stars, qualified } = scorePaper(answers, job.scoringConfig);
      transition = deriveCompletionTransition({
        currentRowStatus: screeningResult.status,
        jobStatus: job.status,
        resultKind: "success",
        completedRowDetails: {
          answers,
          score,
          stars,
          qualified,
          aiMetadata: { confidence: data.confidence },
        },
      });
    } else {
      transition = deriveCompletionTransition({
        currentRowStatus: screeningResult.status,
        jobStatus: job.status,
        resultKind: result.kind === "success" ? "success" : "failure",
      });
    }

    if (transition.kind === "noop") {
      return;
    }

    const completedAt = Date.now();
    if (transition.rowPatch.status === "completed") {
      await ctx.db.patch("screeningResults", context.resultId, {
        ...transition.rowPatch,
        completedAt,
      });
    } else {
      await ctx.db.patch("screeningResults", context.resultId, {
        ...transition.rowPatch,
        completedAt,
        ...(result.kind === "failed"
          ? { errorMessage: result.error }
          : result.kind === "canceled"
            ? { errorMessage: "workpool_canceled" }
            : {}),
      });
    }

    const aggregateResult = {
      _id: context.resultId,
      jobId: context.jobId,
      status: transition.aggregateStatus,
      qualified: transition.aggregateQualified,
    };
    await recordTerminalResult(ctx, aggregateResult);
    if (transition.aggregateQualified) {
      await recordQualifiedResult(ctx, aggregateResult);
    }

    if (transition.scheduleQualifiedPersistence) {
      await ctx.scheduler.runAfter(
        0,
        internal.screening.mutations.persistQualifiedScreeningResult,
        { resultId: context.resultId },
      );
    }

    if (transition.scheduleJobFinalization) {
      await ctx.scheduler.runAfter(
        0,
        internal.screening.mutations.finalizeScreeningJobFromAggregates,
        { jobId: context.jobId },
      );
    }
  },
});
