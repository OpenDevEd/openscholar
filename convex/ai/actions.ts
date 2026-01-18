"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal, api } from "../_generated/api";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateObject } from "ai";
import {
  queryEnhancementSchema,
  screeningQuestionsSchema,
  createScreeningResponsesSchema,
  translateQuerySchema,
  translatePaperContentSchema,
  buildEnhanceQueryPrompts,
  buildScreeningQuestionsPrompts,
  buildTranslateQueryPrompts,
  buildTranslatePaperContentPrompts,
  buildScreeningResponsesPrompts,
  validateQuery,
  executeAIOperation,
  calculateCostInDollars,
  dollarsToCredits,
  DEEPSEEK_PRICING,
  AIUnauthenticatedError,
  AIInsufficientCreditsError,
} from "@/lib/ai/core";
import { z } from "zod";
import { SERVER_AI_CONFIG } from "./config";

export const enhanceSearchQuery = action({
  args: {
    query: v.string(),
    language: v.optional(v.string()),
  },
  returns: v.object({
    enhancedQuery: v.string(),
    explanation: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) throw new AIUnauthenticatedError();

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total <= 0) {
      throw new AIInsufficientCreditsError();
    }

    const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });

    const { output, usage } = await executeAIOperation({
      model: deepseek(SERVER_AI_CONFIG.model),
      schema: queryEnhancementSchema,
      buildPrompts: (input, retryCount) => buildEnhanceQueryPrompts(input, retryCount),
      input: args,
      repairStrategy: { type: 'single-field', fieldName: 'enhancedQuery' },
      temperature: 1,
      retryConfig: {
        maxRetries: 10,
        shouldRetry: (error, attempt) =>
          error.message.includes('unbalanced parentheses') ||
          error.message.includes('incomplete operator'),
        onRetry: (error, attempt) => {
          console.warn(`Query validation failed (attempt ${attempt}/10):`, error);
        },
      },
      validator: (output) => ({
        ...output,
        enhancedQuery: validateQuery(output.enhancedQuery),
      }),
    });

    const costDollars = calculateCostInDollars(usage, DEEPSEEK_PRICING);
    const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: user._id,
      amount: creditsToDeduct,
      description: "AI: Enhance search query",
    });

    return {
      enhancedQuery: output.enhancedQuery,
      explanation: "",
    };
  },
});

export const generateScreeningQuestions = action({
  args: {
    researchQuestion: v.string(),
    existingQuestions: v.array(v.string()),
  },
  returns: v.object({
    questions: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) throw new AIUnauthenticatedError();

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total <= 0) {
      throw new AIInsufficientCreditsError();
    }

    const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });

    const { output, usage } = await executeAIOperation({
      model: deepseek(SERVER_AI_CONFIG.model),
      schema: screeningQuestionsSchema,
      buildPrompts: (input, retryCount) => buildScreeningQuestionsPrompts(input),
      input: args,
      repairStrategy: { type: 'full-json' },
      temperature: 0.7,
      postProcess: (output, input) => {
        const newQuestions = output.questions.filter((newQuestion: string) => {
          const normalizedNew = newQuestion.toLowerCase().trim();
          return !input.existingQuestions.some((existingQuestion: string) => {
            const normalizedExisting = existingQuestion.toLowerCase().trim();
            return (
              normalizedExisting === normalizedNew ||
              normalizedExisting.includes(normalizedNew) ||
              normalizedNew.includes(normalizedExisting)
            );
          });
        });
        return { questions: newQuestions };
      },
    });

    const costDollars = calculateCostInDollars(usage, DEEPSEEK_PRICING);
    const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: user._id,
      amount: creditsToDeduct,
      description: "AI: Generate screening questions",
    });

    return {
      questions: output.questions,
    };
  },
});

export const translateQuery = action({
  args: {
    query: v.string(),
    targetLanguage: v.string(),
  },
  returns: v.object({
    translatedQuery: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) throw new AIUnauthenticatedError();

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total <= 0) {
      throw new AIInsufficientCreditsError();
    }

    const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });

    const { output, usage } = await executeAIOperation({
      model: deepseek(SERVER_AI_CONFIG.model),
      schema: translateQuerySchema,
      buildPrompts: (input, retryCount) => buildTranslateQueryPrompts(input),
      input: args,
      repairStrategy: { type: 'single-field', fieldName: 'translatedQuery' },
      temperature: 0.3,
    });

    const costDollars = calculateCostInDollars(usage, DEEPSEEK_PRICING);
    const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: user._id,
      amount: creditsToDeduct,
      description: "AI: Translate query",
    });

    return {
      translatedQuery: output.translatedQuery,
    };
  },
});

export const translatePaperContent = action({
  args: {
    title: v.string(),
    abstract: v.string(),
    sourceLanguage: v.string(),
  },
  returns: v.object({
    translatedTitle: v.string(),
    translatedAbstract: v.string(),
    sourceLanguage: v.string(),
    isAlreadyInEnglish: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) throw new AIUnauthenticatedError();

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total <= 0) {
      throw new AIInsufficientCreditsError();
    }

    const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });

    const { output, usage } = await executeAIOperation({
      model: deepseek(SERVER_AI_CONFIG.model),
      schema: translatePaperContentSchema,
      buildPrompts: (input, retryCount) => buildTranslatePaperContentPrompts(input),
      input: args,
      repairStrategy: { type: 'full-json' },
      temperature: 0.3,
    });

    const costDollars = calculateCostInDollars(usage, DEEPSEEK_PRICING);
    const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: user._id,
      amount: creditsToDeduct,
      description: "AI: Translate paper content",
    });

    return {
      translatedTitle: output.translatedTitle,
      translatedAbstract: output.translatedAbstract,
      sourceLanguage: args.sourceLanguage,
      isAlreadyInEnglish: false,
    };
  },
});

export const generateScreeningResponses = action({
  args: {
    title: v.string(),
    abstract: v.string(),
    questions: v.array(v.string()),
  },
  returns: v.object({
    responses: v.record(v.string(), v.union(v.boolean(), v.null())),
    confidence: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) throw new AIUnauthenticatedError();

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total <= 0) {
      throw new AIInsufficientCreditsError();
    }

    const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });
    const schema = createScreeningResponsesSchema(args.questions);

    const { output, usage } = await executeAIOperation({
      model: deepseek(SERVER_AI_CONFIG.model),
      schema,
      buildPrompts: (input, retryCount) => buildScreeningResponsesPrompts(input),
      input: args,
      repairStrategy: { type: 'full-json' },
      temperature: 0.1,
    });

    const costDollars = calculateCostInDollars(usage, DEEPSEEK_PRICING);
    const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: user._id,
      amount: creditsToDeduct,
      description: "AI: Generate screening responses",
    });

    return {
      responses: output.responses as Record<string, boolean | null>,
      confidence: output.confidence,
    };
  },
});