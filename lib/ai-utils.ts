import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { AIProvider } from "@/lib/types";

/**
 * Creates an AI model instance based on provider, API key, and model ID.
 * Centralizes AI provider configuration to avoid code duplication.
 */
export function createAIModel(provider: AIProvider, apiKey: string, modelId: string) {
  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(modelId);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(modelId);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(modelId);
    }
    case "openrouter": {
      const openrouter = createOpenRouter({ apiKey });
      return openrouter(modelId);
    }
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}
