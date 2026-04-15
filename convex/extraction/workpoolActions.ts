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
      console.warn(
        `[ExtractionPipeline] Job ${args.jobId} not found, skipping`
      );
      return { success: false };
    }

    const terminalStatuses = ["completed", "cancelled", "failed"];
    if (terminalStatuses.includes(job.status)) {
      console.log(
        `[ExtractionPipeline] Job ${args.jobId} is ${job.status}, skipping paper ${args.paperId}`
      );
      return { success: false };
    }

    // 2. Load paper -- idempotency guard
    const paper = await ctx.runQuery(
      internal.extraction.queries.getPaperInternal,
      { paperId: args.paperId }
    );
    if (!paper) {
      console.warn(
        `[ExtractionPipeline] Paper ${args.paperId} not found, skipping`
      );
      return { success: false };
    }

    try {
      // Idempotency: skip PARSING if bodyText already populated (workpool retry)
      // But still proceed to extraction below
      if (!paper.bodyText) {
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

        console.log(
          `[ExtractionPipeline] Paper ${args.paperId} parsed via ${result.parsingSource} (${result.bodyText.length} chars)`
        );
      } else {
        console.log(
          `[ExtractionPipeline] Paper ${args.paperId} already parsed, skipping to extraction`
        );
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
        console.error(
          `[ExtractionPipeline] Paper ${args.paperId} has no bodyText after parsing`
        );
        return { success: false };
      }

      // 7. Load questions from job
      const jobForQuestions = await ctx.runQuery(
        internal.extraction.queries.getJobInternal,
        { jobId: args.jobId }
      );
      if (!jobForQuestions || jobForQuestions.questions.length === 0) {
        console.warn(
          `[ExtractionPipeline] Job ${args.jobId} has no questions, skipping extraction`
        );
        return { success: true };
      }

      // 8. Run extraction cascade with credit billing (D-16)
      const questions = jobForQuestions.questions.map((q) => ({
        key: q.key,
        question: q.question,
        expectedType: q.expectedType,
      }));

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
          console.warn(
            `[ExtractionPipeline] Credits exhausted for job ${args.jobId}`
          );
          await ctx.runMutation(
            internal.extraction.mutations.updateJobStatus,
            { jobId: args.jobId, status: "failed" }
          );
        }

        throw error;
      }

      // 9. Save results via saveResult mutation (D-02)
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

      // 10. Determine paper success (D-15)
      const anySucceeded = extractionResults.some((r) => r.answer !== null);
      if (!anySucceeded) {
        console.error(
          `[ExtractionPipeline] All questions failed for paper ${args.paperId}`
        );
        // Paper failed -- but we still return success:false to let onComplete handle status
        return { success: false };
      }

      console.log(
        `[ExtractionPipeline] Paper ${args.paperId} extracted: ${extractionResults.filter((r) => r.answer !== null).length}/${extractionResults.length} questions answered`
      );

      return { success: true };
    } catch (error) {
      console.error(
        `[ExtractionPipeline] Pipeline failed for paper ${args.paperId}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  },
});
