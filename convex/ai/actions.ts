"use node";

import { v } from "convex/values";
import {
  getEnhanceQueryConfig,
  getScreeningQuestionsConfig,
  getTranslateQueryConfig,
  getTranslatePaperContentConfig,
  getScreeningResponsesConfig,
} from "@/lib/ai/core/configs";
import { createAIAction } from "./helpers";

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
