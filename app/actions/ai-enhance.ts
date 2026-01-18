"use server";

import { z } from "zod";
import { generateObject } from "ai";
import { addCostFromUsage, assertWithinBudget } from "@/lib/ai-cost";
import { createAIModel } from "@/lib/ai-utils";
import { languageOptions } from "@/components/language-selector";
import type { AIProvider } from "@/lib/types";
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

export async function enhanceSearchQuery(
  query: string,
  provider: AIProvider,
  apiKey: string,
  modelId: string,
  language?: string
) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  if (!query.trim()) {
    throw new Error("Query is required");
  }

  try {
    assertWithinBudget();

    const model = createAIModel(provider, apiKey, modelId);

    const maxRetries = 10;
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount < maxRetries) {
      try {
        const prompts = buildEnhanceQueryPrompts({ query, language }, retryCount);

        const { object, usage } = await generateObject({
          model,
          schema: queryEnhancementSchema,
          experimental_repairText: async ({ text, error }) =>
            repairSingleField(text, error, 'enhancedQuery'),
          providerOptions: STANDARD_PROVIDER_OPTIONS,
          temperature: 1,
          system: prompts.system,
          prompt: prompts.prompt,
        });

        const validatedQuery = validateQuery(object.enhancedQuery);

        addCostFromUsage(provider, modelId, usage);

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
            throw new Error(`Failed to generate valid query after ${maxRetries} attempts. Last error: ${lastError.message}`);
          }
          continue;
        } else {
          throw validationError;
        }
      }
    }

    throw lastError || new Error("Failed to enhance query after all retries");

  } catch (error) {
    logAIError("enhanceSearchQuery", error);
    throw new Error(
      `Failed to enhance query. ${error instanceof Error ? error.message : 'Please try again or try a different AI model.'}`
    );
  }
}

export async function generateScreeningQuestions(
  researchQuestion: string,
  existingQuestions: string[],
  provider: AIProvider,
  apiKey: string,
  modelId: string
) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  if (!researchQuestion.trim()) {
    throw new Error("Research question is required");
  }

  try {
    assertWithinBudget();

    const model = createAIModel(provider, apiKey, modelId);

    const prompts = buildScreeningQuestionsPrompts({ researchQuestion, existingQuestions });

    const { object, usage } = await generateObject({
      model,
      schema: screeningQuestionsSchema,
      experimental_repairText: async ({ text, error }) => repairJSON(text, error),
      providerOptions: STANDARD_PROVIDER_OPTIONS,
      temperature: 0.7,
      system: prompts.system,
      prompt: prompts.prompt,
    });

    addCostFromUsage(provider, modelId, usage);

    const newQuestions = object.questions.filter(newQuestion => {
      const normalizedNew = newQuestion.toLowerCase().trim();
      return !existingQuestions.some(existingQuestion => {
        const normalizedExisting = existingQuestion.toLowerCase().trim();
        return normalizedExisting === normalizedNew ||
               normalizedExisting.includes(normalizedNew) ||
               normalizedNew.includes(normalizedExisting);
      });
    });

    return {
      questions: newQuestions,
    };

  } catch (error) {
    logAIError("generateScreeningQuestions", error);
    throw new Error(
      "Failed to generate screening questions. Please check your API key and try again."
    );
  }
}

export async function translateQuery(
  query: string,
  targetLanguage: string,
  provider: AIProvider,
  apiKey: string,
  modelId: string
) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  if (!query.trim()) {
    throw new Error("Query is required");
  }

  if (!targetLanguage) {
    throw new Error("Target language is required");
  }

  try {
    assertWithinBudget();

    const model = createAIModel(provider, apiKey, modelId);

    const prompts = buildTranslateQueryPrompts({ query, targetLanguage });

    const { object, usage } = await generateObject({
      model,
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

    addCostFromUsage(provider, modelId, usage);

    return object.translatedQuery;
  } catch (error) {
    logAIError("translateQuery", error);
    throw new Error(
      error instanceof Error
        ? `Translation failed: ${error.message}`
        : "Failed to translate query. Please check your API key and try again."
    );
  }
}

export async function translatePaperContent(
  title: string,
  abstract: string,
  sourceLanguage: string,
  provider: AIProvider,
  apiKey: string,
  modelId: string
) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  if (!title.trim() && !abstract.trim()) {
    throw new Error("Title or abstract is required");
  }

  if (!sourceLanguage) {
    throw new Error("Source language is required");
  }

  try {
    assertWithinBudget();

    const model = createAIModel(provider, apiKey, modelId);

    const prompts = buildTranslatePaperContentPrompts({ title, abstract, sourceLanguage });

    const { object, usage } = await generateObject({
      model,
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

    addCostFromUsage(provider, modelId, usage);

    return {
      translatedTitle: object.translatedTitle,
      translatedAbstract: object.translatedAbstract,
      sourceLanguage: sourceLanguage,
      isAlreadyInEnglish: false,
    };
  } catch (error) {
    logAIError("translatePaperContent", error);
    throw new Error(
      error instanceof Error
        ? `Translation failed: ${error.message}`
        : "Failed to translate paper content. Please check your API key and try again."
    );
  }
}

export async function generateScreeningResponses(
  title: string,
  abstract: string,
  questions: string[],
  provider: AIProvider,
  apiKey: string,
  modelId: string
) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  if (!title.trim() && !abstract.trim()) {
    throw new Error("Either title or abstract is required");
  }

  if (!questions || questions.length === 0) {
    throw new Error("Questions list is required");
  }

  try {
    assertWithinBudget();

    const model = createAIModel(provider, apiKey, modelId);

    const schema = createScreeningResponsesSchema(questions);
    const prompts = buildScreeningResponsesPrompts({ title, abstract, questions });

    const { object, usage } = await generateObject({
      model,
      schema,
      experimental_repairText: async ({ text, error }) => repairJSON(text, error),
      providerOptions: STANDARD_PROVIDER_OPTIONS,
      temperature: 0.1,
      system: prompts.system,
      prompt: prompts.prompt,
    });

    addCostFromUsage(provider, modelId, usage);

    return {
      responses: object.responses as Record<string, boolean | null>,
      confidence: object.confidence,
    };

  } catch (error) {
    logAIError("generateScreeningResponses", error);
    throw new Error(
      "Failed to generate screening responses. Please check your API key and try again."
    );
  }
}

// Re-export AIProvider for backwards compatibility
export type { AIProvider } from "@/lib/types";
