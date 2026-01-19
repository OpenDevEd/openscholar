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
import { executeAIOperation, type Usage } from "@/lib/ai/core";
import { createAIAction, getModel, aggregateUsage, withAuthAndCreditsBatch } from "./helpers";

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
 * Batch screening action - processes multiple papers in a single action call.
 * Uses Promise.allSettled for fail-soft behavior (partial results on errors).
 */
/**
 * Batch translation action - processes multiple papers in a single action call.
 * Uses Promise.allSettled for fail-soft behavior (partial results on errors).
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
        const usages: Usage[] = [];
        const results: Record<string, { translatedTitle: string; translatedAbstract: string; sourceLanguage: string; isAlreadyInEnglish: boolean }> = {};
        const errors: Array<{ paperId: string; error: string }> = [];

        const promises = papers.map(async (paper) => {
          const config = getTranslatePaperContentConfig({
            title: paper.title,
            abstract: paper.abstract,
            sourceLanguage,
          });

          const { output, usage } = await executeAIOperation({
            model,
            ...config,
          });

          return {
            paperId: paper.id,
            translatedTitle: output.translatedTitle,
            translatedAbstract: output.translatedAbstract,
            sourceLanguage,
            isAlreadyInEnglish: false,
            usage,
          };
        });

        const settledResults = await Promise.allSettled(promises);

        for (let i = 0; i < settledResults.length; i++) {
          const result = settledResults[i];
          if (result.status === "fulfilled") {
            const { paperId, translatedTitle, translatedAbstract, sourceLanguage, isAlreadyInEnglish, usage } = result.value;
            results[paperId] = { translatedTitle, translatedAbstract, sourceLanguage, isAlreadyInEnglish };
            usages.push(usage);
          } else {
            const paperId = papers[i]?.id || "unknown";
            const errorMessage = result.reason instanceof Error 
              ? result.reason.message 
              : String(result.reason);
            errors.push({ paperId, error: errorMessage });
            console.error(`Batch translation error for paper ${paperId}:`, result.reason);
          }
        }

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
 * Uses Promise.allSettled for fail-soft behavior (partial results on errors).
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
        const usages: Usage[] = [];
        const results: Record<string, { responses: Record<string, boolean | null>; confidence: number }> = {};
        const errors: Array<{ paperId: string; error: string }> = [];

        // Process all papers in parallel using Promise.allSettled for fail-soft behavior
        const promises = papers.map(async (paper) => {
          const config = getScreeningResponsesConfig({
            title: paper.title,
            abstract: paper.abstract,
            questions,
          });

          const { output, usage } = await executeAIOperation({
            model,
            ...config,
          });

          return {
            paperId: paper.id,
            responses: output.responses as Record<string, boolean | null>,
            confidence: output.confidence,
            usage,
          };
        });

        const settledResults = await Promise.allSettled(promises);

        for (const result of settledResults) {
          if (result.status === "fulfilled") {
            const { paperId, responses, confidence, usage } = result.value;
            results[paperId] = { responses, confidence };
            usages.push(usage);
          } else {
            // Extract paperId from the error context if possible
            // Since we're iterating in order, we can match by index
            const index = settledResults.indexOf(result);
            const paperId = papers[index]?.id || "unknown";
            const errorMessage = result.reason instanceof Error 
              ? result.reason.message 
              : String(result.reason);
            errors.push({ paperId, error: errorMessage });
            console.error(`Batch screening error for paper ${paperId}:`, result.reason);
          }
        }

        return {
          result: { results, errors },
          totalUsage: aggregateUsage(usages),
        };
      }
    );
  },
});
