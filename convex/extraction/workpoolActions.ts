"use node";

/**
 * Workpool actions for extraction pipeline.
 *
 * Each paper is processed independently via the workpool. The action runs
 * the full per-paper pipeline: parse -> extract -> critic -> persist.
 *
 * Phase 90: parsing waterfall (PMC -> arXiv -> unpdf -> Gemini -> abstract_only)
 * Phase 91 adds: extraction cascade (Flash Lite -> Flash -> Haiku)
 * Phase 92 adds: critic pass and citation grounding
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { parseFullText } from "./parse";
import { extractAnswers } from "./extract";
import { classifyExtractionError } from "./errors";
import { emitStageLog, emitStageError, computeCostUsd } from "./logging";
import type { ExtractionResult } from "./extract";
import { withUserCreditsBatch } from "../ai/helpers";
import type { Usage } from "../../lib/ai/core/types";

/**
 * Process a single paper through the extraction pipeline.
 *
 * 1. Loads the job and checks for terminal status (credit guard)
 * 2. Loads the paper and checks idempotency
 * 3-5. Parsing waterfall (skipped if bodyText already populated)
 * 6. Reload paper to get bodyText after parsing
 * 7. Load questions from job
 * 8. Run extraction cascade with credit billing (extractAnswers)
 * 9. Save results via saveResult mutation
 * 10. Determine paper success (at least one question answered)
 *
 * On failure: logs error and re-throws for workpool retry.
 */
export const processExtractionPaper = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    traceId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // 1. Load job -- terminal-status guard (mirrors screening pattern)
    const job = await ctx.runQuery(
      internal.extraction.queries.getJobInternal,
      { jobId: args.jobId }
    );
    if (!job) {
      console.warn(JSON.stringify({ event: "job_not_found", jobId: String(args.jobId), traceId: args.traceId }));
      return { success: false };
    }

    const terminalStatuses = ["completed", "cancelled", "failed"];
    if (terminalStatuses.includes(job.status)) {
      console.info(JSON.stringify({ event: "job_terminal_skip", jobId: String(args.jobId), status: job.status, traceId: args.traceId }));
      return { success: false };
    }

    // Read tier from job row (D-04/D-05: null-coalesce to "auto" for pre-Phase-100 rows)
    const tier = job.tier ?? "auto";

    // 2. Load paper -- idempotency guard
    const paper = await ctx.runQuery(
      internal.extraction.queries.getPaperInternal,
      { paperId: args.paperId }
    );
    if (!paper) {
      console.warn(JSON.stringify({ event: "paper_not_found", paperId: String(args.paperId), traceId: args.traceId }));
      return { success: false };
    }

    try {
      // Idempotency: skip PARSING if bodyText already populated (workpool retry)
      // But still proceed to extraction below
      if (!paper.bodyText) {
        const parseStartMs = Date.now();

        // 3. Mark paper as parsing
        await ctx.runMutation(
          internal.extraction.mutations.updatePaperStatus,
          { paperId: args.paperId, status: "parsing" }
        );

        // 4. Run parsing waterfall
        const result = await parseFullText(paper.doi ?? "", paper.openalexId);

        // 5. Store parsed text via mutation
        await ctx.runMutation(
          internal.extraction.mutations.storeParsedText,
          {
            paperId: args.paperId,
            bodyText: result.bodyText,
            parsingSource: result.parsingSource,
          }
        );

        const parseLatencyMs = Date.now() - parseStartMs;
        emitStageLog({
          traceId: args.traceId,
          jobId: args.jobId,
          paperId: args.paperId,
          stage: "parse",
          model: "",
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          latencyMs: parseLatencyMs,
          status: "success",
        });
      } else {
        emitStageLog({
          traceId: args.traceId,
          jobId: args.jobId,
          paperId: args.paperId,
          stage: "parse",
          model: "",
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          latencyMs: 0,
          status: "skip",
        });
      }
      // Continue to extraction (Phase 91) regardless...

      // =============================================
      // Phase 91: Extraction cascade
      // =============================================

      // 6. Reload paper to get bodyText (parsing stored it via mutation)
      const parsedPaper = await ctx.runQuery(
        internal.extraction.queries.getPaperInternal,
        { paperId: args.paperId }
      );
      if (!parsedPaper || !parsedPaper.bodyText) {
        emitStageError({
          traceId: args.traceId,
          jobId: args.jobId,
          paperId: args.paperId,
          stage: "parse",
          model: "",
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          latencyMs: 0,
          status: "failure",
          errorMessage: "No bodyText after parsing",
          errorCategory: "empty_body",
          retryable: false,
        });
        return { success: false };
      }

      // 7. Load questions from job
      const jobForQuestions = await ctx.runQuery(
        internal.extraction.queries.getJobInternal,
        { jobId: args.jobId }
      );
      if (!jobForQuestions || jobForQuestions.questions.length === 0) {
        console.warn(JSON.stringify({ event: "no_questions", jobId: String(args.jobId), traceId: args.traceId }));
        return { success: true };
      }

      // 8. Run extraction cascade with credit billing (D-16)
      const questions = jobForQuestions.questions.map((q) => ({
        key: q.key,
        question: q.question,
        expectedType: q.expectedType,
      }));

      const extractStartMs = Date.now();
      let extractionResults: ExtractionResult[];
      try {
        extractionResults = await withUserCreditsBatch(
          ctx,
          jobForQuestions.userId,
          `Extraction (paper ${args.paperId})`,
          async (_pricing) => {
            const results = await extractAnswers(
              parsedPaper.bodyText!,
              questions,
              parsedPaper.parsingSource,
              args.traceId,
              args.jobId,
              args.paperId,
              tier,
            );

            // Aggregate token usage across all questions for credit billing
            const totalUsage: Usage = {
              inputTokens: results.reduce((sum, r) => sum + (r.tokensIn ?? 0), 0),
              outputTokens: results.reduce((sum, r) => sum + (r.tokensOut ?? 0), 0),
            };

            return { result: results, totalUsage };
          },
        );
      } catch (error) {
        // Handle credit exhaustion: mark job failed and re-throw
        const isInsufficientCredits =
          error instanceof Error &&
          (error.message.includes("AI_INSUFFICIENT_CREDITS") ||
            (typeof (error as { data?: { code?: string } }).data === "object" &&
              (error as { data?: { code?: string } }).data?.code ===
                "AI_INSUFFICIENT_CREDITS"));

        if (isInsufficientCredits) {
          console.warn(JSON.stringify({ event: "credits_exhausted", jobId: String(args.jobId), traceId: args.traceId }));
          await ctx.runMutation(
            internal.extraction.mutations.updateJobStatus,
            { jobId: args.jobId, status: "failed" }
          );
        }

        throw error;
      }
      const extractLatencyMs = Date.now() - extractStartMs;

      // 9. Save results via saveResult mutation (D-02)
      const saveStartMs = Date.now();
      for (const result of extractionResults) {
        await ctx.runMutation(
          internal.extraction.mutations.saveResult,
          {
            jobId: args.jobId,
            paperId: args.paperId,
            questionId: result.questionId,
            answer: result.answer,
            confidence: result.confidence,
            evidenceQuote: result.evidenceQuote,
            evidenceSourceId: result.evidenceSourceId,
            evidenceStartChar: result.evidenceStartChar,
            evidenceEndChar: result.evidenceEndChar,
            reasoning: result.reasoning,
            modelUsed: result.modelUsed,
            parsingSource: parsedPaper.parsingSource,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            errorMessage: result.errorMessage,
            criticVerdict: result.criticVerdict,
          }
        );
      }
      const saveLatencyMs = Date.now() - saveStartMs;
      emitStageLog({
        traceId: args.traceId,
        jobId: args.jobId,
        paperId: args.paperId,
        stage: "save",
        model: "",
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: saveLatencyMs,
        status: "success",
      });

      // 10. Determine paper success (D-15)
      const anySucceeded = extractionResults.some((r) => r.answer !== null);
      if (!anySucceeded) {
        emitStageError({
          traceId: args.traceId,
          jobId: args.jobId,
          paperId: args.paperId,
          stage: "extract",
          model: "",
          tokensIn: extractionResults.reduce((s, r) => s + (r.tokensIn ?? 0), 0),
          tokensOut: extractionResults.reduce((s, r) => s + (r.tokensOut ?? 0), 0),
          costUsd: extractionResults.reduce((s, r) => s + computeCostUsd(r.modelUsed ?? "", r.tokensIn ?? 0, r.tokensOut ?? 0), 0),
          latencyMs: extractLatencyMs,
          status: "failure",
          errorMessage: "All questions failed",
          errorCategory: "validation",
          retryable: false,
        });
        // Paper failed -- but we still return success:false to let onComplete handle status
        return { success: false };
      }

      const totalTokensIn = extractionResults.reduce((s, r) => s + (r.tokensIn ?? 0), 0);
      const totalTokensOut = extractionResults.reduce((s, r) => s + (r.tokensOut ?? 0), 0);
      const totalCostUsd = extractionResults.reduce((s, r) => s + computeCostUsd(r.modelUsed ?? "", r.tokensIn ?? 0, r.tokensOut ?? 0), 0);
      emitStageLog({
        traceId: args.traceId,
        jobId: args.jobId,
        paperId: args.paperId,
        stage: "extract",
        model: extractionResults[0]?.modelUsed ?? "",
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        costUsd: totalCostUsd,
        latencyMs: extractLatencyMs,
        status: "success",
      });

      return { success: true };
    } catch (error) {
      const classified = classifyExtractionError(error);

      emitStageError({
        traceId: args.traceId,
        jobId: args.jobId,
        paperId: args.paperId,
        stage: "extract",
        model: "",
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 0,
        status: "failure",
        errorMessage: classified.message.slice(0, 500),
        errorCategory: classified.category,
        retryable: classified.retryable,
      });

      if (classified.retryable) {
        // Rethrow so workpool retries (up to maxAttempts: 3)
        throw error;
      }

      // Permanent error -- save details and return failure (no retry)
      await ctx.runMutation(
        internal.extraction.mutations.updatePaperStatus,
        {
          paperId: args.paperId,
          status: "failed" as const,
          errorMessage: `[${classified.category}] ${classified.message}`.slice(0, 500),
        }
      );

      return { success: false };
    }
  },
});
