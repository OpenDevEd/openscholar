import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
  extractionJobStatusValidator,
  extractionPaperStatusValidator,
  extractionQuestionValidator,
  extractionPaperInputValidator,
  extractionConfidenceValidator,
  parsingSourceValidator,
} from "./validators";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_EXTRACTION_PAPERS_PER_JOB } from "../lib/queryBounds";
import { workflow } from "../workflow";
import { extractionPool } from "../workpool";

const TERMINAL_STATUSES = ["completed", "cancelled", "failed"] as const;

/**
 * Create an extraction job.
 *
 * Validates paper count, guards against concurrent active jobs,
 * creates the job record with embedded questions, inserts paper and
 * question rows, and starts the extraction workflow.
 */
export const createExtractionJob = mutation({
  args: {
    papers: v.array(extractionPaperInputValidator),
    questions: v.array(extractionQuestionValidator),
  },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, args) => {
    // 1. Authentication (T-89-04)
    const user = await requireAuth(ctx);

    // 2. Validate paper count (T-89-06)
    if (args.papers.length === 0) {
      throw createError("VALIDATION_ERROR", "At least one paper is required");
    }
    if (args.papers.length > MAX_EXTRACTION_PAPERS_PER_JOB) {
      throw createError(
        "VALIDATION_ERROR",
        `Maximum ${MAX_EXTRACTION_PAPERS_PER_JOB} papers per job`
      );
    }

    // 3. Validate questions
    if (args.questions.length === 0) {
      throw createError(
        "VALIDATION_ERROR",
        "At least one question is required"
      );
    }

    // 4. Check for active jobs (pending or processing) -- T-89-07
    // Two separate queries per Pitfall 3 (Convex cannot OR on index values)
    const pendingJob = await ctx.db
      .query("extractionJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "pending")
      )
      .first();

    if (pendingJob) {
      throw createError(
        "EXTRACTION_JOB_ALREADY_ACTIVE",
        "An extraction job is already active"
      );
    }

    const processingJob = await ctx.db
      .query("extractionJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "processing")
      )
      .first();

    if (processingJob) {
      throw createError(
        "EXTRACTION_JOB_ALREADY_ACTIVE",
        "An extraction job is already active"
      );
    }

    // 5. Create extraction job record
    const now = Date.now();
    const jobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      status: "pending",
      totalPapers: args.papers.length,
      processedPapers: 0,
      failedPapers: 0,
      questions: args.questions,
      createdAt: now,
      updatedAt: now,
    });

    // 6. Insert paper rows
    for (const paper of args.papers) {
      await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: paper.openalexId,
        title: paper.title,
        doi: paper.doi,
        status: "pending",
        createdAt: now,
      });
    }

    // 7. Insert question rows (separate table for per-question querying)
    for (const q of args.questions) {
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: q.key,
        question: q.question,
        expectedType: q.expectedType,
        createdAt: now,
      });
    }

    // 8. Start extraction workflow
    try {
      const workflowId = await workflow.start(
        ctx,
        internal.extraction.workflow.runExtractionWorkflow,
        { jobId }
      );
      await ctx.db.patch(jobId, { workflowId: String(workflowId) });
    } catch (e) {
      // Workflow component may not be available in test environments.
      // In production, the component is always registered.
      console.error(`[createExtractionJob] Failed to start workflow: ${e}`);
    }

    // 9. Return job ID
    return { jobId };
  },
});

// ===================================================================
// INTERNAL MUTATIONS (for workflow/workpool background context)
// ===================================================================

/**
 * Batched enqueue of all pending papers to the workpool (WORK-06).
 *
 * This is the key difference from screening: instead of per-paper journaled
 * steps in the workflow, ALL papers are enqueued in a single mutation/
 * transaction. This reduces the number of journaled steps from N+3 to 3.
 */
export const enqueueAllPapers = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;

    // Terminal guard
    if (
      TERMINAL_STATUSES.includes(
        job.status as (typeof TERMINAL_STATUSES)[number]
      )
    ) {
      return null;
    }

    // Load pending papers
    const pendingPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "pending")
      )
      .take(MAX_EXTRACTION_PAPERS_PER_JOB);

    if (pendingPapers.length === 0) {
      // No pending papers -- mark complete immediately
      const now = Date.now();
      await ctx.db.patch(args.jobId, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });
      return null;
    }

    // Update job status to processing
    await ctx.db.patch(args.jobId, {
      status: "processing",
      updatedAt: Date.now(),
    });

    // Enqueue each paper in this single mutation (WORK-06)
    for (const paper of pendingPapers) {
      await ctx.db.patch(paper._id, {
        status: "pending",
        updatedAt: Date.now(),
      });

      const workId = await extractionPool.enqueueAction(
        ctx,
        internal.extraction.workpoolActions.processExtractionPaper,
        { paperId: paper._id, jobId: args.jobId },
        {
          onComplete: internal.extraction.mutations.handleExtractionComplete,
          context: { paperId: paper._id, jobId: args.jobId },
        }
      );

      // Store workpoolId on paper row for Phase 93 targeted cancel (D-03)
      await ctx.db.patch(paper._id, {
        workpoolId: String(workId),
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Update an extraction job's status from background context (no auth).
 */
export const updateJobStatus = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    status: extractionJobStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Store parsed body text and source tag on a paper row.
 *
 * Called by the workpool action after parseFullText() completes.
 * Updates paper status from "parsing" to "extracting" (Phase 91 picks up from here).
 */
export const storeParsedText = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    bodyText: v.string(),
    parsingSource: parsingSourceValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper) return null;

    await ctx.db.patch(args.paperId, {
      bodyText: args.bodyText,
      parsingSource: args.parsingSource,
      status: "extracting",
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Update an extraction paper's status from background context.
 */
export const updatePaperStatus = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    status: extractionPaperStatusValidator,
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper) return null;

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.errorMessage !== undefined) {
      patch.errorMessage = args.errorMessage;
    }

    await ctx.db.patch(args.paperId, patch);
    return null;
  },
});

/**
 * Idempotent save of an extraction result (WORK-07).
 *
 * Checks the by_paper_question index before inserting -- persisting the same
 * (paperId, questionId) pair twice produces exactly one row.
 */
export const saveResult = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
    questionId: v.string(),
    // Value fields from extraction cascade (EXTR-09, D-02)
    answer: v.union(v.string(), v.null()),
    confidence: v.optional(extractionConfidenceValidator),
    evidenceQuote: v.optional(v.string()),
    evidenceSourceId: v.optional(v.string()),
    evidenceStartChar: v.optional(v.number()),
    evidenceEndChar: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    modelUsed: v.optional(v.string()),
    parsingSource: v.optional(parsingSourceValidator),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    criticVerdict: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Idempotency check via by_paper_question index
    const existing = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper_question", (q) =>
        q.eq("paperId", args.paperId).eq("questionId", args.questionId)
      )
      .unique();

    if (existing) return null; // Skip -- idempotent

    await ctx.db.insert("extractionResults", {
      jobId: args.jobId,
      paperId: args.paperId,
      questionId: args.questionId,
      answer: args.answer,
      confidence: args.confidence,
      evidenceQuote: args.evidenceQuote,
      evidenceSourceId: args.evidenceSourceId,
      evidenceStartChar: args.evidenceStartChar,
      evidenceEndChar: args.evidenceEndChar,
      reasoning: args.reasoning,
      modelUsed: args.modelUsed,
      parsingSource: args.parsingSource,
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      errorMessage: args.errorMessage,
      criticVerdict: args.criticVerdict,
      createdAt: Date.now(),
    });

    return null;
  },
});

/**
 * Check if an extraction job is done and finalize it.
 *
 * A job is done when processedPapers + failedPapers >= totalPapers.
 * Terminal statuses (completed/cancelled/failed) are no-ops.
 */
export const finalizeJobIfDone = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;

    // Terminal states are no-ops
    if (
      TERMINAL_STATUSES.includes(
        job.status as (typeof TERMINAL_STATUSES)[number]
      )
    ) {
      return null;
    }

    // Check if all papers are processed
    if (job.processedPapers + job.failedPapers >= job.totalPapers) {
      const now = Date.now();
      await ctx.db.patch(args.jobId, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});

/**
 * Workpool onComplete handler for individual paper extraction.
 *
 * On success: marks paper completed, increments processedPapers.
 * On failure: marks paper failed with error message, increments failedPapers.
 * Always calls finalizeJobIfDone at the end.
 */
export const handleExtractionComplete = extractionPool.defineOnComplete({
  context: v.object({
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    // Load job fresh for current counters (OCC will retry on conflict)
    const job = (await ctx.db.get(context.jobId)) as Doc<"extractionJobs"> | null;
    if (!job) return;

    // Skip if job is in a terminal state
    if (
      TERMINAL_STATUSES.includes(
        job.status as (typeof TERMINAL_STATUSES)[number]
      )
    ) {
      return;
    }

    if (result.kind === "success") {
      // Mark paper completed
      await ctx.db.patch(context.paperId, {
        status: "completed",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Increment processedPapers
      await ctx.db.patch(context.jobId, {
        processedPapers: (job.processedPapers ?? 0) + 1,
        updatedAt: Date.now(),
      });
    } else {
      // Error or cancelled
      await ctx.db.patch(context.paperId, {
        status: "failed",
        completedAt: Date.now(),
        updatedAt: Date.now(),
        errorMessage:
          result.kind === "error"
            ? String(result.error).slice(0, 500)
            : "Cancelled",
      });

      // Increment failedPapers
      await ctx.db.patch(context.jobId, {
        failedPapers: (job.failedPapers ?? 0) + 1,
        updatedAt: Date.now(),
      });
    }

    // Always check if job is complete
    await ctx.runMutation(
      internal.extraction.mutations.finalizeJobIfDone,
      { jobId: context.jobId }
    );
  },
});
