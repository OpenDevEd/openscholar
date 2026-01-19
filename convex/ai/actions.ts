"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import {
  getEnhanceQueryConfig,
  getScreeningQuestionsConfig,
  getTranslateQueryConfig,
  getTranslatePaperContentConfig,
  getScreeningResponsesConfig,
} from "@/lib/ai/core/configs";
import { 
  processScreeningBatch, 
  processTranslationBatch,
  aggregateUsage,
} from "@/lib/ai/core";
import { createAIAction, getModel, withAuthAndCreditsBatch } from "./helpers";

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
  })
);

export const translatePaperContent = createAIAction(
  {
    title: v.string(),
    abstract: v.string(),
    sourceLanguage: v.string(),
  },
  v.object({
    translatedTitle: v.string(),
    translatedAbstract: v.string(),
    sourceLanguage: v.string(),
    isAlreadyInEnglish: v.boolean(),
  }),
  "Translate paper content",
  getTranslatePaperContentConfig,
  (output, args) => ({
    translatedTitle: output.translatedTitle,
    translatedAbstract: output.translatedAbstract,
    sourceLanguage: args.sourceLanguage,
    isAlreadyInEnglish: false,
  })
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
    responses: output.responses as Record<string, boolean | null>,
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
  },
  returns: v.object({
    results: v.record(
      v.string(),
      v.object({
        translatedTitle: v.string(),
        translatedAbstract: v.string(),
        sourceLanguage: v.string(),
        isAlreadyInEnglish: v.boolean(),
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
    const { papers, sourceLanguage } = args;

    if (papers.length === 0 || !sourceLanguage || sourceLanguage === "en") {
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
        });

        return {
          result: { results, errors },
          totalUsage: aggregateUsage(usages),
        };
      }
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

        return {
          result: { results, errors },
          totalUsage: aggregateUsage(usages),
        };
      }
    );
  },
});
