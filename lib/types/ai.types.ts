/**
 * AI Provider Types
 * Single source of truth for AI-related type definitions
 */

/**
 * Supported AI providers for query enhancement and screening
 */
export type AIProvider = 'openai' | 'google' | 'anthropic' | 'openrouter';

/**
 * AI model definition
 */
export interface AIModel {
  id: string;
  name: string;
  provider: AIProvider;
  description?: string;
  contextWindow?: number;
  pricing: {
    input: number;
    output: number;
  };
  capabilities?: string[];
  category?: string;
}

/**
 * AI provider configuration
 */
export interface AIProviderConfig {
  id: AIProvider;
  name: string;
  description: string;
  models: AIModel[];
  apiKeyPlaceholder: string;
  apiKeyUrl: string;
}

/**
 * AI model configuration
 */
export interface AIModelConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
}

/**
 * AI usage/cost tracking
 */
export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * AI response metadata
 */
export interface AIResponseMetadata {
  provider: AIProvider;
  model: string;
  processedAt: string;
  usage?: AIUsage;
}
