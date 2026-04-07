/**
 * AI Provider Types
 * Single source of truth for AI-related type definitions
 */

/**
 * Supported AI providers for query enhancement and screening
 */
export type AIProvider = 'openai' | 'google' | 'anthropic' | 'openrouter' | 'deepseek' | 'azure';

/**
 * AI key routing mode selected by the user.
 */
export type AIKeyMode = 'smart' | 'local' | 'credits';

/**
 * AI provider configuration — static metadata for UI display.
 */
export interface AIProviderConfig {
  id: AIProvider;
  name: string;
  description: string;
  apiKeyPlaceholder: string;
  apiKeyUrl: string;
}
