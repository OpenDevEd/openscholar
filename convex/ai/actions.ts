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
import { createAIAction, getModel, withAuthAndCreditsBatch } from "./helpers";
import { encodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";

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
  })
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
  })
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
  (output) => ({ questions: output.questions })
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
  { minPlanTier: 10 }
);

export const translatePaperContent = createAIAction(
  {
    title: v.string(),
    abstract: v.string(),
    sourceLanguage: v.string(),
    targetLanguage: v.optional(v.string()),
  },
  v.object({
    translatedTitle: v.string(),
    translatedAbstract: v.string(),
    sourceLanguage: v.string(),
    noTranslationNeeded: v.boolean(),
  }),
  "Translate paper content",
  getTranslatePaperContentConfig,
  (output, args) => ({
    translatedTitle: output.translatedTitle,
    translatedAbstract: output.translatedAbstract,
    sourceLanguage: args.sourceLanguage,
    noTranslationNeeded: false,
  }),
  { minPlanTier: 10 }
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
  })
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
    sourceLanguage: v.string(),
    targetLanguage: v.optional(v.string()),
  },
  returns: v.object({
    results: v.record(
      v.string(),
      v.object({
        translatedTitle: v.string(),
        translatedAbstract: v.string(),
        sourceLanguage: v.string(),
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
    const { papers, sourceLanguage, targetLanguage } = args;

    if (papers.length === 0 || !sourceLanguage) {
      return { results: {}, errors: [] };
    }

    return withAuthAndCreditsBatch(
      ctx,
      `Batch translation (${papers.length} papers)`,
      async () => {
        const model = await getModel();
        
        const { results, errors, usages } = await processTranslationBatch({
          model,
          papers,
          sourceLanguage,
          targetLanguage,
        });

        return {
          result: { results, errors },
          totalUsage: aggregateUsage(usages),
        };
      },
      { minPlanTier: 10 }
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
      async () => {
        const model = await getModel();
        
        const { results, errors, usages } = await processScreeningBatch({
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

        return {
          result: { results: encodedResults, errors },
          totalUsage: aggregateUsage(usages),
        };
      }
    );
  },
});
