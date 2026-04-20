/**
 * Extraction result mutations — the write-side of the result/review
 * domain, plus the job-status primitive used by the workflow.
 *
 * setResultReviewState is the public review-workflow entrypoint.
 *
 * Per-question lifecycle (plan-02):
 *   - recordOneAnswer: upsert one extractionResults row with the answer
 *     + deduct one question's credits atomically. Gated on result.billed
 *     so a workpool retry never double-charges.
 *   - recordOneAnswerFailure: upsert one extractionResults row with
 *     status="failed" + lastError when the workflow step retries exhaust.
 *   - finalizePaper: aggregate the per-question result rows via
 *     aggregatePaperStatus, flip the paper to its terminal status, fire
 *     maybeFinalizeJob. Idempotent — re-running after the paper is
 *     already terminal is a no-op.
 */

import { mutation, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { createError } from "../../lib/errors";
import { assertJobOwnership } from "../access";
import {
  assertValidJobTransition,
  type JobStatus,
} from "../stateMachine";
import { isTerminalPaperStatus, markPaperTerminalTx } from "../paperLifecycle";
import { forgetResult, recordResult } from "../aggregates";
import {
  answerValidator,
  citationStatusValidator,
  citationValidator,
  classifiedErrorValidator,
  retrievalDiagnosticsValidator,
  structuredErrorValidator,
} from "../validators";
import { aggregatePaperStatus } from "@/lib/extraction/paper-status";
import type { ErrorCode } from "@/lib/errors/taxonomy";

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
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.reviewQueue", user._id);
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
      v.literal("creditsExhausted"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    totalPapers: v.optional(v.number()),
    // Optional structured error stamped on the job when we transition
    // to a failure-ish state (e.g. creditsExhausted). Lets the UI pick
    // a localized title/body without parsing the message.
    error: v.optional(structuredErrorValidator),
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

    // Idempotency for creditsExhausted: if the job is already
    // creditsExhausted, a concurrent second extractOneQuestion catch
    // site transitioning it again is a no-op (plan-03 "race on mid-run
    // detection" pitfall).
    if (
      args.status === "creditsExhausted" &&
      job.status === "creditsExhausted"
    ) {
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
    if (args.error !== undefined) {
      updates.error = args.error;
    }

    await ctx.db.patch("extractionJobs", args.jobId, updates);
    return null;
  },
});

// ──────────────────────────────────────────────────────────────────────
// Plan-02 per-question mutations
// ──────────────────────────────────────────────────────────────────────

/**
 * Return true if the parent job has reached a terminal state — any
 * result-persistence call coming in after that must be a no-op so a
 * late workpool retry cannot resurrect a cancelled/failed/completed
 * job.
 */
function isJobTerminal(
  job: { status?: string } | null | undefined,
): boolean {
  if (!job) return false;
  return (
    job.status === "cancelled" ||
    job.status === "failed" ||
    job.status === "completed"
  );
}

const oneAnswerBody = v.object({
  answer: answerValidator,
  confidence: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  citations: v.array(citationValidator),
  citationStatus: citationStatusValidator,
  retrievalDiagnostics: v.optional(retrievalDiagnosticsValidator),
  pdfContentUsed: v.optional(v.boolean()),
});

export const recordOneAnswer = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    questionKey: v.string(),
    result: oneAnswerBody,
    creditsUsed: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return null;

    const job = await ctx.db.get("extractionJobs", paper.jobId);
    if (isJobTerminal(job)) {
      console.log(
        `[recordOneAnswer] Skipping ${args.paperId}:${args.questionKey}; job ${paper.jobId} terminal`,
      );
      return null;
    }

    const existing = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper_question", (q) =>
        q.eq("paperId", args.paperId).eq("questionKey", args.questionKey),
      )
      .unique();

    // Billing-idempotency gate. A workpool retry that lands here after
    // the question was already billed must not re-debit. The flag flips
    // atomically with the credit deduction inside this mutation.
    if (existing?.billed) {
      console.log(
        `[recordOneAnswer] Skipping ${args.paperId}:${args.questionKey}; already billed`,
      );
      return null;
    }

    // Status-change requires rewriting the aggregate's keyed rows.
    // DirectAggregate keys by (namespace, key, id); an upsert from
    // citationStatus=X → Y leaves the old X-keyed row behind unless we
    // explicitly forget it. Same for answered/unanswered.
    if (existing) {
      await forgetResult(ctx, {
        _id: existing._id,
        jobId: existing.jobId,
        questionKey: existing.questionKey,
        answer: existing.answer,
        confidence: existing.confidence,
        citationStatus: existing.citationStatus,
      });
    }

    const now = Date.now();
    const attemptCount = (existing?.attemptCount ?? 0) + 1;
    const fields = {
      jobId: paper.jobId,
      paperId: args.paperId,
      questionKey: args.questionKey,
      answer: args.result.answer,
      confidence: args.result.confidence,
      reasoning: args.result.reasoning,
      citations: args.result.citations,
      citationStatus: args.result.citationStatus,
      retrievalDiagnostics: args.result.retrievalDiagnostics,
      pdfContentUsed: args.result.pdfContentUsed,
      status: "completed" as const,
      billed: true,
      attemptCount,
      processedAt: now,
    };

    let resultId: Id<"extractionResults">;
    if (existing) {
      await ctx.db.replace(existing._id, fields);
      resultId = existing._id;
    } else {
      resultId = await ctx.db.insert("extractionResults", fields);
    }

    // Accumulate per-paper credits so finalizePaper can surface a total
    // without recomputing from result rows.
    if (args.creditsUsed > 0) {
      await ctx.db.patch(args.paperId, {
        creditsUsed: (paper.creditsUsed ?? 0) + args.creditsUsed,
      });
    }

    if (args.creditsUsed > 0 && job) {
      await ctx.runMutation(internal.credits.internal.deductCredits, {
        userId: job.userId,
        amount: args.creditsUsed,
        description: "AI: Extraction (1 question)",
        metadata: {
          billingType: "extraction_llm",
          paperId: String(args.paperId),
          jobId: String(paper.jobId),
          questionKey: args.questionKey,
        },
      });
    }

    await recordResult(ctx, {
      _id: resultId,
      jobId: paper.jobId,
      questionKey: args.questionKey,
      answer: fields.answer,
      confidence: fields.confidence,
      citationStatus: fields.citationStatus,
    });

    return null;
  },
});

export const recordOneAnswerFailure = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    questionKey: v.string(),
    error: classifiedErrorValidator,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return null;

    const job = await ctx.db.get("extractionJobs", paper.jobId);
    if (isJobTerminal(job)) {
      console.log(
        `[recordOneAnswerFailure] Skipping ${args.paperId}:${args.questionKey}; job ${paper.jobId} terminal`,
      );
      return null;
    }

    const existing = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper_question", (q) =>
        q.eq("paperId", args.paperId).eq("questionKey", args.questionKey),
      )
      .unique();

    // If the question was already billed as completed, don't overwrite
    // the good answer with a stale failure row. Workflow re-entry after
    // a success-then-failure is impossible but the guard makes the
    // invariant explicit.
    if (existing?.billed) return null;

    if (existing) {
      await forgetResult(ctx, {
        _id: existing._id,
        jobId: existing.jobId,
        questionKey: existing.questionKey,
        answer: existing.answer,
        confidence: existing.confidence,
        citationStatus: existing.citationStatus,
      });
    }

    const now = Date.now();
    const attemptCount = (existing?.attemptCount ?? 0) + 1;
    const fields = {
      jobId: paper.jobId,
      paperId: args.paperId,
      questionKey: args.questionKey,
      answer: null,
      confidence: 0,
      reasoning: `Extraction failed: ${args.error.message}`,
      citations: [],
      citationStatus: "extraction_error" as const,
      retrievalDiagnostics: undefined,
      pdfContentUsed: false,
      status: "failed" as const,
      billed: false,
      attemptCount,
      lastError: {
        code: args.error.code,
        message: args.error.message,
        ...(args.error.context !== undefined ? { context: args.error.context } : {}),
        ...(args.error.httpStatus !== undefined ? { httpStatus: args.error.httpStatus } : {}),
        ...(args.error.providerName !== undefined
          ? { providerName: args.error.providerName }
          : {}),
        at: now,
      },
      processedAt: now,
    };

    let resultId: Id<"extractionResults">;
    if (existing) {
      await ctx.db.replace(existing._id, fields);
      resultId = existing._id;
    } else {
      resultId = await ctx.db.insert("extractionResults", fields);
    }

    await recordResult(ctx, {
      _id: resultId,
      jobId: paper.jobId,
      questionKey: args.questionKey,
      answer: null,
      confidence: 0,
      citationStatus: "extraction_error",
    });

    return null;
  },
});

/**
 * Collapse the per-question extractionResults rows into a paper-level
 * terminal status. Called by the workflow once all per-question steps
 * have either succeeded or exhausted their retry budget. Idempotent:
 * running on an already-terminal paper is a no-op.
 */
export const finalizePaper = internalMutation({
  args: { paperId: v.id("extractionPapers") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return null;
    if (isTerminalPaperStatus(paper.status)) return null;

    const job = await ctx.db.get("extractionJobs", paper.jobId);
    if (isJobTerminal(job)) return null;

    const [resultsForPaper, questions] = await Promise.all([
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
        .collect(),
      ctx.db
        .query("extractionQuestions")
        .withIndex("by_job", (q) => q.eq("jobId", paper.jobId))
        .collect(),
    ]);

    const byKey = new Map(resultsForPaper.map((r) => [r.questionKey, r]));
    const rollupInputs = questions.map((q) => {
      const r = byKey.get(q.key);
      if (!r) {
        return { status: "pending" as const };
      }
      // Row inserted by recordOneAnswer / recordOneAnswerFailure. Fall
      // back to "completed" when the row predates plan-02 (no status
      // column).
      const status = r.status ?? ("completed" as const);
      const code = r.lastError?.code as ErrorCode | undefined;
      return {
        status,
        lastError: code !== undefined ? { code } : undefined,
        attemptCount: r.attemptCount,
      };
    });

    const rollup = aggregatePaperStatus(rollupInputs);

    // Not done yet — a question is still pending or a retryable failure
    // hasn't exhausted its budget. Leave the paper in its current
    // non-terminal state and let a later finalizePaper call finish the
    // job once the remaining question steps land.
    if (rollup.status === "pending" || rollup.status === "extracting") {
      return null;
    }

    const terminalStatus = rollup.status === "failed" ? "failed" : "completed";
    const anyPdfUsed = resultsForPaper.some((r) => r.pdfContentUsed);

    await markPaperTerminalTx(ctx, args.paperId, terminalStatus, {
      creditsUsed: paper.creditsUsed,
      pdfContentUsed: anyPdfUsed ? true : undefined,
    });

    await ctx.runMutation(
      internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
      { jobId: paper.jobId },
    );

    console.log(
      `[finalizePaper] ${args.paperId} → ${terminalStatus} (completed=${rollup.completedQuestions} failed=${rollup.failedQuestions})`,
    );
    return null;
  },
});
