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
  STANDARD_PROVIDER_OPTIONS,
} from "@/lib/ai/core/schemas";
import {
  buildEnhanceQueryPrompts,
  buildScreeningQuestionsPrompts,
  buildTranslateQueryPrompts,
  buildTranslatePaperContentPrompts,
  buildScreeningResponsesPrompts,
} from "@/lib/ai/core/prompts";
import { validateQuery, repairSingleField, repairJSON, logAIError } from "@/lib/ai/core/validate";
import { calculateCostInDollars, dollarsToCredits, DEEPSEEK_PRICING } from "@/lib/ai/core/cost";
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
    if (!user) throw new Error("Unauthenticated");

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total <= 0) {
      throw new Error("Insufficient credits");
    }

    const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });
    const prompts = buildEnhanceQueryPrompts(args, 0);

    const maxRetries = 10;
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount < maxRetries) {
      try {
        const { object, usage } = await generateObject({
          model: deepseek(SERVER_AI_CONFIG.model),
          schema: queryEnhancementSchema,
          experimental_repairText: async ({ text, error }) =>
            repairSingleField(text, error, 'enhancedQuery'),
          providerOptions: STANDARD_PROVIDER_OPTIONS,
          temperature: 1,
          system: prompts.system,
          prompt: prompts.prompt,
        });

        const validatedQuery = validateQuery(object.enhancedQuery);

        const costDollars = calculateCostInDollars(usage, DEEPSEEK_PRICING);
        const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

        await ctx.runMutation(internal.credits.internal.deductCredits, {
          userId: user._id,
          amount: creditsToDeduct,
          description: "AI: Enhance search query",
        });

        return {
          enhancedQuery: validatedQuery,
          explanation: "",
        };

      } catch (validationError) {
        lastError = validationError as Error;
        console.warn(`Query validation failed (attempt ${retryCount + 1}/${maxRetries}):`, validationError);

        if (lastError.message.includes("unbalanced parentheses") || lastError.message.includes("incomplete operator")) {
          retryCount++;
          if (retryCount >= maxRetries) {
            throw new Error(`Failed to generate valid query after ${maxRetries} attempts`);
          }
          continue;
        } else {
          throw validationError;
        }
      }
    }

    throw lastError || new Error("Failed to enhance query after all retries");
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
    if (!user) throw new Error("Unauthenticated");

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total <= 0) {
      throw new Error("Insufficient credits");
    }

    const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });
    const prompts = buildScreeningQuestionsPrompts(args);

    const { object, usage } = await generateObject({
      model: deepseek(SERVER_AI_CONFIG.model),
      schema: screeningQuestionsSchema,
      experimental_repairText: async ({ text, error }) => repairJSON(text, error),
      providerOptions: STANDARD_PROVIDER_OPTIONS,
      temperature: 0.7,
      system: prompts.system,
      prompt: prompts.prompt,
    });

    const newQuestions = object.questions.filter((newQuestion: string) => {
      const normalizedNew = newQuestion.toLowerCase().trim();
      return !args.existingQuestions.some((existingQuestion: string) => {
        const normalizedExisting = existingQuestion.toLowerCase().trim();
        return normalizedExisting === normalizedNew ||
               normalizedExisting.includes(normalizedNew) ||
               normalizedNew.includes(normalizedExisting);
      });
    });

    const costDollars = calculateCostInDollars(usage, DEEPSEEK_PRICING);
    const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: user._id,
      amount: creditsToDeduct,
      description: "AI: Generate screening questions",
    });

    return {
      questions: newQuestions,
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
    if (!user) throw new Error("Unauthenticated");

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total <= 0) {
      throw new Error("Insufficient credits");
    }

    const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });
    const prompts = buildTranslateQueryPrompts(args);

    const { object, usage } = await generateObject({
      model: deepseek(SERVER_AI_CONFIG.model),
      schema: z.object({
        translatedQuery: z.string().describe("The query translated to the target language, maintaining the same meaning and structure"),
      }),
      experimental_repairText: async ({ text, error }) =>
        repairSingleField(text, error, 'translatedQuery'),
      providerOptions: STANDARD_PROVIDER_OPTIONS,
      temperature: 0.3,
      system: prompts.system,
      prompt: prompts.prompt,
    });

    const costDollars = calculateCostInDollars(usage, DEEPSEEK_PRICING);
    const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: user._id,
      amount: creditsToDeduct,
      description: "AI: Translate query",
    });

    return {
      translatedQuery: object.translatedQuery,
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
    if (!user) throw new Error("Unauthenticated");

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total <= 0) {
      throw new Error("Insufficient credits");
    }

    const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });
    const prompts = buildTranslatePaperContentPrompts(args);

    const { object, usage } = await generateObject({
      model: deepseek(SERVER_AI_CONFIG.model),
      schema: z.object({
        translatedTitle: z.string().describe("The paper title translated to English"),
        translatedAbstract: z.string().describe("The paper abstract translated to English"),
      }),
      experimental_repairText: async ({ text, error }) => repairJSON(text, error),
      providerOptions: STANDARD_PROVIDER_OPTIONS,
      temperature: 0.3,
      system: prompts.system,
      prompt: prompts.prompt,
    });

    const costDollars = calculateCostInDollars(usage, DEEPSEEK_PRICING);
    const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: user._id,
      amount: creditsToDeduct,
      description: "AI: Translate paper content",
    });

    return {
      translatedTitle: object.translatedTitle,
      translatedAbstract: object.translatedAbstract,
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
    if (!user) throw new Error("Unauthenticated");

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total <= 0) {
      throw new Error("Insufficient credits");
    }

    const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });
    const schema = createScreeningResponsesSchema(args.questions);
    const prompts = buildScreeningResponsesPrompts(args);

    const { object, usage } = await generateObject({
      model: deepseek(SERVER_AI_CONFIG.model),
      schema,
      experimental_repairText: async ({ text, error }) => repairJSON(text, error),
      providerOptions: STANDARD_PROVIDER_OPTIONS,
      temperature: 0.1,
      system: prompts.system,
      prompt: prompts.prompt,
    });

    const costDollars = calculateCostInDollars(usage, DEEPSEEK_PRICING);
    const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: user._id,
      amount: creditsToDeduct,
      description: "AI: Generate screening responses",
    });

    return {
      responses: object.responses as Record<string, boolean | null>,
      confidence: object.confidence,
    };
  },
});