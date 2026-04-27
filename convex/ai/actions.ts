"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import {
  getEnhanceQueryConfig,
  getScreeningQuestionsConfig,
  getExtractionQuestionsConfig,
  getTranslateQueryConfig,
  getTranslatePaperContentConfig,
  getScreeningResponsesConfig,
} from "../../lib/ai/core/configs";
import {
  processScreeningBatch,
  processTranslationBatch,
  aggregateUsage,
} from "../../lib/ai/core";
import {
  createAIAction,
  calculateServerCreditsToDeduct,
  getModel,
  withAuthAndCreditsBatch,
} from "./helpers";
import { encodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";
import { truncateForTracking, type AITrackingEntry } from "../../lib/posthog-ai-shared";
import { ESTIMATED_CREDITS_PER_PAPER } from "../lib/constants";
import { extractOpenalexId } from "../../lib/billing/transactions/openalex-id";

export const enhanceSearchQuery = createAIAction(
  {
    query: v.string(),
    language: v.optional(v.string()),
  },
  v.object({
    enhancedQuery: v.string(),
    explanation: v.string(),
  }),
  "Enhance search query",
  getEnhanceQueryConfig,
  (output) => ({
    enhancedQuery: output.enhancedQuery,
    explanation: "",
  }),
  { billingType: "search" },
);

export const generateScreeningQuestions = createAIAction(
  {
    researchQuestion: v.string(),
    existingQuestions: v.array(v.string()),
    responseLanguage: v.optional(v.string()),
  },
  v.object({
    questions: v.array(v.string()),
  }),
  "Generate screening questions",
  getScreeningQuestionsConfig,
  (output) => ({
    questions: output.questions,
  }),
  { billingType: "screening" },
);

export const generateExtractionQuestions = createAIAction(
  {
    jobName: v.string(),
    sourceContext: v.string(),
    existingQuestions: v.array(v.string()),
    responseLanguage: v.optional(v.string()),
  },
  v.object({
    questions: v.array(v.object({
      question: v.string(),
      type: v.union(v.literal("string"), v.literal("boolean"), v.literal("number"), v.literal("array")),
      description: v.optional(v.string()),
    })),
  }),
  "Generate extraction questions",
  getExtractionQuestionsConfig,
  (output) => ({ questions: output.questions }),
  { billingType: "extraction_llm" },
);

export const translateQuery = createAIAction(
  {
    query: v.string(),
    targetLanguage: v.string(),
  },
  v.object({
    translatedQuery: v.string(),
  }),
  "Translate query",
  getTranslateQueryConfig,
  (output) => ({
    translatedQuery: output.translatedQuery,
  }),
  { billingType: "translation" },
);

export const translatePaperContent = createAIAction(
  {
    title: v.string(),
    abstract: v.string(),
    targetLanguage: v.optional(v.string()),
  },
  v.object({
    translatedTitle: v.string(),
    translatedAbstract: v.string(),
    noTranslationNeeded: v.boolean(),
  }),
  "Translate paper content",
  getTranslatePaperContentConfig,
  (output) => ({
    translatedTitle: output.translatedTitle,
    translatedAbstract: output.translatedAbstract,
    noTranslationNeeded: false,
  }),
  { billingType: "translation" },
);

export const generateScreeningResponses = createAIAction(
  {
    title: v.string(),
    abstract: v.string(),
    questions: v.array(v.string()),
  },
  v.object({
    responses: v.record(v.string(), v.union(v.boolean(), v.null())),
    confidence: v.number(),
  }),
  "Generate screening responses",
  getScreeningResponsesConfig,
  (output) => ({
    // Convex requires ASCII-only object keys, so encode question text keys.
    responses: encodeQuestionResponseMap(
      output.responses as Record<string, boolean | null>
    ),
    confidence: output.confidence,
  }),
  { billingType: "screening" },
);

/**
 * Batch translation action - processes multiple papers in a single action call.
 * Uses the shared batch processor factory for consistent behavior with client-side.
 */
export const generateBatchTranslations = action({
  args: {
    papers: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        abstract: v.string(),
      })
    ),
    targetLanguage: v.optional(v.string()),
  },
  returns: v.object({
    results: v.record(
      v.string(),
      v.object({
        translatedTitle: v.string(),
        translatedAbstract: v.string(),
        noTranslationNeeded: v.boolean(),
      })
    ),
    errors: v.array(
      v.object({
        paperId: v.string(),
        error: v.string(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const { papers, targetLanguage } = args;

    if (papers.length === 0) {
      return { results: {}, errors: [] };
    }

    return withAuthAndCreditsBatch(
      ctx,
      `Batch translation (${papers.length} papers)`,
      async (_user, pricing) => {
        const model = await getModel();

        const { results, errors, usages, usageByItemId, trackingByItemId } = await processTranslationBatch({
          model,
          papers,
          targetLanguage,
        });

        const usageBreakdown = Object.entries(usageByItemId).map(
          ([paperRef, usage]) => {
            const amount = calculateServerCreditsToDeduct(usage, pricing);
            const openalexId = extractOpenalexId(paperRef) ?? paperRef;
            return {
              usage,
              billingType: "translation" as const,
              // `itemId` keys back into BatchResult.results — required
              // for the mid-batch salvage path to identify unpaid items.
              itemId: paperRef,
              metadata: {
                openalexId,
                chargedCredits: String(amount),
              },
            };
          },
        );

        const trackingEntries: AITrackingEntry[] = Object.entries(trackingByItemId).map(
          ([itemId, tracking]) => {
            const usage = usageByItemId[itemId];
            return {
              feature: `batch_translation`,
              usage: {
                inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
                outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
              },
              latencyMs: tracking.latencyMs,
              input: truncateForTracking(tracking.input),
              output: truncateForTracking(tracking.output),
              temperature: tracking.temperature,
            };
          },
        );

        return {
          result: { results, errors },
          totalUsage: aggregateUsage(usages),
          usageBreakdown,
          trackingEntries,
        };
      },
      Math.ceil(papers.length * ESTIMATED_CREDITS_PER_PAPER),
    );
  },
});

/**
 * Batch screening action - processes multiple papers in a single action call.
 * Uses the shared batch processor factory for consistent behavior with client-side.
 */
export const generateBatchScreeningResponses = action({
  args: {
    papers: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        abstract: v.string(),
      })
    ),
    questions: v.array(v.string()),
  },
  returns: v.object({
    results: v.record(
      v.string(),
      v.object({
        responses: v.record(v.string(), v.union(v.boolean(), v.null())),
        confidence: v.number(),
      })
    ),
    errors: v.array(
      v.object({
        paperId: v.string(),
        error: v.string(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const { papers, questions } = args;

    // Skip if no papers or no questions
    if (papers.length === 0 || questions.length === 0) {
      return { results: {}, errors: [] };
    }

    return withAuthAndCreditsBatch(
      ctx,
      `Batch screening (${papers.length} papers)`,
      async (_user, pricing) => {
        const model = await getModel();

        const { results, errors, usages, usageByItemId, trackingByItemId } = await processScreeningBatch({
          model,
          papers,
          questions,
        });

        const encodedResults = Object.fromEntries(
          Object.entries(results).map(([paperId, result]) => [
            paperId,
            {
              ...result,
              responses: encodeQuestionResponseMap(result.responses),
            },
          ])
        );

        const usageBreakdown = Object.entries(usageByItemId).map(
          ([paperRef, usage]) => {
            const amount = calculateServerCreditsToDeduct(usage, pricing);
            const openalexId = extractOpenalexId(paperRef) ?? paperRef;
            return {
              usage,
              billingType: "screening" as const,
              // `itemId` keys back into BatchResult.results — required
              // for the mid-batch salvage path to identify unpaid items.
              itemId: paperRef,
              metadata: {
                openalexId,
                chargedCredits: String(amount),
              },
            };
          },
        );

        const trackingEntries: AITrackingEntry[] = Object.entries(trackingByItemId).map(
          ([itemId, tracking]) => {
            const usage = usageByItemId[itemId];
            return {
              feature: `batch_screening`,
              usage: {
                inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
                outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
              },
              latencyMs: tracking.latencyMs,
              input: truncateForTracking(tracking.input),
              output: truncateForTracking(tracking.output),
              temperature: tracking.temperature,
            };
          },
        );

        return {
          result: { results: encodedResults, errors },
          totalUsage: aggregateUsage(usages),
          usageBreakdown,
          trackingEntries,
        };
      },
      Math.ceil(papers.length * ESTIMATED_CREDITS_PER_PAPER),
    );
  },
});
