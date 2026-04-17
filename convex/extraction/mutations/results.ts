/**
 * Extraction result mutations — the write-side of the result/review
 * domain, plus the job-status primitive used by the workflow.
 *
 * setResultReviewState is the public review-workflow entrypoint. The two
 * internal mutations here (updateJobStatus + saveExtractionResultsAndComplete)
 * own the result persistence + job-state transitions triggered by the
 * extraction pipeline.
 *
 * saveExtractionResultsAndComplete still writes the legacy
 * extractionJobStats table; Task 11 will add aggregate dual-write here.
 */

import { mutation, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { createError } from "../../lib/errors";
import { assertJobOwnership } from "../access";
import {
  assertValidJobTransition,
  type JobStatus,
} from "../stateMachine";
import { markPaperTerminalTx } from "../paperLifecycle";
import { recordResult } from "../aggregates";

export const setResultReviewState = mutation({
  args: {
    resultId: v.id("extractionResults"),
    state: v.union(
      v.literal("unreviewed"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("needs_followup"),
    ),
    note: v.optional(v.string()),
    correctedAnswer: v.optional(
      v.union(
        v.string(),
        v.boolean(),
        v.number(),
        v.array(v.string()),
        v.null(),
      ),
    ),
  },
  returns: v.union(
    v.object({
      cleared: v.boolean(),
      state: v.literal("unreviewed"),
    }),
    v.object({
      reviewId: v.id("extractionResultReviews"),
      state: v.union(
        v.literal("unreviewed"),
        v.literal("accepted"),
        v.literal("rejected"),
        v.literal("needs_followup"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const result = await ctx.db.get("extractionResults", args.resultId);
    if (!result) throw createError("NOT_FOUND", "Result not found");

    const paper = await ctx.db.get("extractionPapers", result.paperId);
    if (!paper) throw createError("NOT_FOUND", "Paper not found");

    const job = await assertJobOwnership(ctx, user._id, paper.jobId);
    const existing = await ctx.db
      .query("extractionResultReviews")
      .withIndex("by_result", (q) => q.eq("resultId", args.resultId))
      .first();

    const note = args.note?.trim() || undefined;
    const hasCorrection = args.correctedAnswer !== undefined;

    if (args.state === "unreviewed" && !note && !hasCorrection) {
      if (existing) {
        await ctx.db.delete("extractionResultReviews", existing._id);
      }
      return { cleared: true, state: "unreviewed" as const };
    }

    const patchData = {
      state: args.state,
      note,
      correctedAnswer: args.correctedAnswer,
      reviewedBy: user._id,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch("extractionResultReviews", existing._id, patchData);
      return { reviewId: existing._id, state: args.state };
    }

    const reviewId = await ctx.db.insert("extractionResultReviews", {
      jobId: job._id,
      paperId: paper._id,
      resultId: result._id,
      questionKey: result.questionKey,
      ...patchData,
      createdAt: Date.now(),
    });

    return { reviewId, state: args.state };
  },
});

export const updateJobStatus = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    status: v.union(
      v.literal("pending"),
      v.literal("downloading_pdfs"),
      v.literal("indexing"),
      v.literal("extracting"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    totalPapers: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job) return null;

    // Terminal states are sticky. A late workflow step (e.g. the unconditional
    // `extracting` update at the end of runExtractionWorkflow) must not roll
    // a finalized job back to an active state.
    const isTerminal =
      job.status === "cancelled" ||
      job.status === "failed" ||
      job.status === "completed";
    if (isTerminal && args.status !== job.status) {
      return null;
    }

    assertValidJobTransition(job.status as JobStatus, args.status as JobStatus);

    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.totalPapers !== undefined) {
      updates.totalPapers = args.totalPapers;
    }

    await ctx.db.patch("extractionJobs", args.jobId, updates);
    return null;
  },
});

export const saveExtractionResultsAndComplete = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    results: v.array(
      v.object({
        questionKey: v.string(),
        answer: v.union(
          v.string(),
          v.boolean(),
          v.number(),
          v.array(v.string()),
          v.null(),
        ),
        confidence: v.optional(v.number()),
        reasoning: v.optional(v.string()),
        citations: v.array(
          v.object({
            evidenceId: v.string(),
            page: v.number(),
            charRange: v.array(v.number()),
            quote: v.string(),
            retrieval: v.object({
              denseScore: v.optional(v.number()),
              lexicalScore: v.optional(v.number()),
              fusedScore: v.optional(v.number()),
              rerankScore: v.optional(v.number()),
            }),
            validated: v.boolean(),
          }),
        ),
        citationStatus: v.union(
          v.literal("grounded"),
          v.literal("best_effort"),
          v.literal("insufficient_evidence"),
          v.literal("extraction_error"),
        ),
        retrievalDiagnostics: v.optional(
          v.object({
            denseCandidates: v.number(),
            lexicalCandidates: v.number(),
            fusedCandidates: v.number(),
            rerankedCandidates: v.number(),
            validatedCitations: v.number(),
            strictNull: v.boolean(),
          }),
        ),
        pdfContentUsed: v.optional(v.boolean()),
      }),
    ),
    creditsUsed: v.number(),
    storageId: v.optional(v.id("_storage")),
    pdfContentUsed: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // Terminal-state guard: if the job was already cancelled/failed/completed,
    // do not persist new results and do not trigger finalize. A late-arriving
    // workpool completion must not resurrect a terminated job.
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return null;
    const parentJob = await ctx.db.get("extractionJobs", paper.jobId);
    if (
      parentJob &&
      (parentJob.status === "cancelled" ||
        parentJob.status === "failed" ||
        parentJob.status === "completed")
    ) {
      console.log(
        `[saveExtractionResultsAndComplete] Skipping ${args.paperId}; job ${paper.jobId} already ${parentJob.status}`,
      );
      return null;
    }

    // Billing-idempotency guard: if we already persisted results + billed this
    // paper, a re-run from a late onComplete or OCC retry must not re-insert
    // results or re-charge the user.
    if (paper.status === "completed" || paper.extractionBilled) {
      console.log(
        `[saveExtractionResultsAndComplete] Skipping ${args.paperId}; already completed/billed`,
      );
      return null;
    }

    for (const result of args.results.filter(Boolean)) {
      const resultId = await ctx.db.insert("extractionResults", {
        jobId: paper.jobId,
        paperId: args.paperId,
        questionKey: result.questionKey,
        answer: result.answer,
        confidence: result.confidence,
        reasoning: result.reasoning,
        citations: result.citations,
        citationStatus: result.citationStatus,
        retrievalDiagnostics: result.retrievalDiagnostics,
        pdfContentUsed: result.pdfContentUsed,
        processedAt: Date.now(),
      });

      // Dual-write (T11.2): mirror into @convex-dev/aggregate alongside the
      // legacy extractionJobStats upsert below. T11.3 flips readers to the
      // aggregate; T11.4 drops the legacy store.
      await recordResult(ctx, {
        _id: resultId,
        jobId: paper.jobId,
        questionKey: result.questionKey,
        answer: result.answer,
        confidence: result.confidence,
        citationStatus: result.citationStatus,
      });
    }

    // Deduct LLM credits atomically with persisting results. The mutation is
    // a single transaction, so either extractionBilled=true AND credits are
    // deducted, or neither. A retried mutation (OCC) reads the committed
    // extractionBilled=true and short-circuits above.
    if (args.creditsUsed > 0 && parentJob) {
      await ctx.runMutation(internal.credits.internal.deductCredits, {
        userId: parentJob.userId,
        amount: args.creditsUsed,
        description: `AI: Extraction (${args.results.length} questions)`,
        metadata: {
          billingType: "extraction_llm",
          paperId: String(args.paperId),
          jobId: String(paper.jobId),
        },
      });
    }

    // Upsert extractionJobStats for each question result. Task 11 will add
    // a dual-write to @convex-dev/aggregate alongside this block.
    for (const result of args.results.filter(Boolean)) {
      const existingStat = await ctx.db
        .query("extractionJobStats")
        .withIndex("by_job_question", (q) =>
          q.eq("jobId", paper.jobId).eq("questionKey", result.questionKey),
        )
        .unique();

      const isAnswered = result.answer !== null && result.answer !== undefined;
      const conf =
        typeof result.confidence === "number" ? result.confidence : undefined;
      const confBucket =
        conf === undefined
          ? "unknown"
          : conf >= 0.8
            ? "high"
            : conf >= 0.5
              ? "medium"
              : "low";

      const delta = {
        totalPapers: 1,
        totalAnswered: isAnswered ? 1 : 0,
        groundedCount: result.citationStatus === "grounded" ? 1 : 0,
        bestEffortCount: result.citationStatus === "best_effort" ? 1 : 0,
        insufficientEvidenceCount:
          result.citationStatus === "insufficient_evidence" ? 1 : 0,
        extractionErrorCount:
          result.citationStatus === "extraction_error" ? 1 : 0,
        confidenceSum: conf ?? 0,
        confidenceCount: conf !== undefined ? 1 : 0,
        highConfidenceCount: confBucket === "high" ? 1 : 0,
        mediumConfidenceCount: confBucket === "medium" ? 1 : 0,
        lowConfidenceCount: confBucket === "low" ? 1 : 0,
        unknownConfidenceCount: confBucket === "unknown" ? 1 : 0,
      };

      if (existingStat) {
        await ctx.db.patch("extractionJobStats", existingStat._id, {
          totalPapers: existingStat.totalPapers + delta.totalPapers,
          totalAnswered: existingStat.totalAnswered + delta.totalAnswered,
          groundedCount: existingStat.groundedCount + delta.groundedCount,
          bestEffortCount: existingStat.bestEffortCount + delta.bestEffortCount,
          insufficientEvidenceCount:
            existingStat.insufficientEvidenceCount +
            delta.insufficientEvidenceCount,
          extractionErrorCount:
            existingStat.extractionErrorCount + delta.extractionErrorCount,
          confidenceSum: existingStat.confidenceSum + delta.confidenceSum,
          confidenceCount: existingStat.confidenceCount + delta.confidenceCount,
          highConfidenceCount:
            existingStat.highConfidenceCount + delta.highConfidenceCount,
          mediumConfidenceCount:
            existingStat.mediumConfidenceCount + delta.mediumConfidenceCount,
          lowConfidenceCount:
            existingStat.lowConfidenceCount + delta.lowConfidenceCount,
          unknownConfidenceCount:
            existingStat.unknownConfidenceCount + delta.unknownConfidenceCount,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("extractionJobStats", {
          jobId: paper.jobId,
          questionKey: result.questionKey,
          ...delta,
          updatedAt: Date.now(),
        });
      }
    }

    // Terminal transition + counter bump happen atomically inside this mutation.
    await markPaperTerminalTx(ctx, args.paperId, "completed", {
      creditsUsed: args.creditsUsed,
      extractionBilled: true,
      storageId: args.storageId,
      pdfContentUsed: args.pdfContentUsed ? true : undefined,
    });
    await ctx.runMutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, {
      jobId: paper.jobId,
    });
    console.log(
      `[saveExtractionResultsAndComplete] Paper ${args.paperId} completed with ${args.results.length} results`,
    );
    return null;
  },
});
