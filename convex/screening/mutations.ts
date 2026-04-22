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
import {
  readScreeningProgressCounts,
  recordQualifiedResult,
  recordTerminalResult,
} from "./aggregates";
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
      processedPapers: 0,
      failedPapers: 0,
      qualifiedPapers: 0,
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
 * Update a screening job's status from background context (no auth).
 */
export const updateJobStatus = internalMutation({
  args: {
    jobId: v.id("screeningJobs"),
    status: screeningJobStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("screeningJobs", args.jobId, {
      status: args.status,
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
    const user = await ctx.db.get("users", args.userId);
    if (user) {
      const currentCount = user.libraryItemCount ?? 0;
      await ctx.db.patch("users", args.userId, { libraryItemCount: currentCount + 1 });
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
 * Check if a screening job is done and finalize it.
 *
 * Aggregate-backed progress is the read truth. Terminal statuses
 * (completed/cancelled/failed/creditsExhausted) are no-ops.
 */
export const finalizeScreeningJobIfDone = internalMutation({
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
 * On success: scores the paper, saves qualifying papers to library,
 * optionally adds to collection, records aggregate state, and patches the
 * legacy job counters still present until plan 03 removes them.
 * On failure: marks result as failed, records aggregate state, and patches
 * the temporary failed counter.
 * Always calls finalizeScreeningJobIfDone at the end.
 */
export const handleScreeningComplete = screeningPool.defineOnComplete({
  context: v.object({
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    if (result.kind === "success") {
      const data = result.returnValue as {
        responses: Record<string, boolean | null>;
        confidence: number;
        usage: { inputTokens: number; outputTokens: number };
      };

      // Load job fresh for current counters (OCC will retry on conflict)
      // Cast needed: defineOnComplete ctx.db.get returns generic Value types
      const job = await ctx.db.get("screeningJobs", context.jobId) as Doc<"screeningJobs"> | null;
      if (!job) return;

      // Skip if job is in a terminal state
      if (isTerminalScreeningJobStatus(job.status)) {
        return;
      }

      // Decode encoded question keys back to original text
      const decodedResponses = decodeQuestionResponseMap(data.responses);

      // Map decoded responses (keyed by question text) to answers keyed by question key
      const answers: Record<string, boolean | null> = {};
      for (const q of job.questions) {
        const response = decodedResponses[q.question];
        answers[q.key] = response ?? null;
      }

      // Score the paper
      const { score, stars, qualified } = scorePaper(answers, job.scoringConfig);
      const aggregateResult = {
        _id: context.resultId,
        jobId: context.jobId,
        status: "completed" as const,
        qualified,
      };

      // Update the screening result
      await ctx.db.patch("screeningResults", context.resultId, {
        status: "completed",
        answers,
        score,
        stars,
        qualified,
        aiMetadata: { confidence: data.confidence },
        completedAt: Date.now(),
      });

      if (qualified) {
        // Load the screening result for paper metadata
        const screeningResult = await ctx.db.get("screeningResults", context.resultId) as Doc<"screeningResults"> | null;
        if (screeningResult) {
          const libraryItemId = await ctx.runMutation(
            internal.screening.mutations.saveQualifiedPaperToLibrary,
            {
              userId: job.userId,
              openalexId: screeningResult.openalexId,
              rating: stars,
              title: screeningResult.title,
              authors: screeningResult.authors?.join(", "),
              doi: screeningResult.doi,
              abstract: screeningResult.abstract,
              publicationYear: screeningResult.publicationYear,
            }
          );

          // Add to target collection if configured
          if (job.targetCollectionId) {
            await ctx.runMutation(
              internal.screening.mutations.addToCollectionInternal,
              {
                userId: job.userId,
                collectionId: job.targetCollectionId,
                libraryItemId,
              }
            );
          }

          // Also record the library item ID on the screening result
          await ctx.db.patch("screeningResults", context.resultId, {
            savedToLibrary: true,
            libraryItemId,
          });
        }

        await Promise.all([
          recordTerminalResult(ctx, aggregateResult),
          recordQualifiedResult(ctx, aggregateResult),
        ]);

        // Increment qualified + processed counters
        await ctx.db.patch("screeningJobs", context.jobId, {
          qualifiedPapers: (job.qualifiedPapers ?? 0) + 1,
          processedPapers: (job.processedPapers ?? 0) + 1,
          updatedAt: Date.now(),
        });
      } else {
        await recordTerminalResult(ctx, aggregateResult);

        // Not qualified: just increment processedPapers
        await ctx.db.patch("screeningJobs", context.jobId, {
          processedPapers: (job.processedPapers ?? 0) + 1,
          updatedAt: Date.now(),
        });
      }
    } else {
      // Error or canceled
      await ctx.db.patch("screeningResults", context.resultId, {
        status: "failed",
        completedAt: Date.now(),
      });

      await recordTerminalResult(ctx, {
        _id: context.resultId,
        jobId: context.jobId,
        status: "failed",
        qualified: false,
      });

      // Load job fresh for current counters
      const job = await ctx.db.get("screeningJobs", context.jobId) as Doc<"screeningJobs"> | null;
      if (job) {
        await ctx.db.patch("screeningJobs", context.jobId, {
          failedPapers: (job.failedPapers ?? 0) + 1,
          updatedAt: Date.now(),
        });
      }
    }

    // Always check if job is complete
    await ctx.runMutation(
      internal.screening.mutations.finalizeScreeningJobIfDone,
      { jobId: context.jobId }
    );
  },
});
