/**
 * AI Provider Types
 * Single source of truth for AI-related type definitions
 */

/**
 * Supported AI providers for query enhancement and screening
 */
export type AIProvider = 'openai' | 'google';

/**
 * AI model configuration
 */
export interface AIModelConfig {
  provider: AIProvider;
  apiKey: string;
  model?: string;
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
