/**
 * AI Provider Types
 * Single source of truth for AI-related type definitions
 */

/**
 * Supported AI providers for query enhancement and screening
 */
export type AIProvider = 'openai' | 'google' | 'anthropic' | 'openrouter' | 'deepseek';

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
