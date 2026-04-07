import type { AIProvider, AIProviderConfig } from './types/ai.types'

/**
 * Provider configurations — static metadata for UI display.
 * Model data itself lives in the Convex `models` table (synced from OpenRouter).
 */
const PROVIDER_CONFIGS: Record<AIProvider, AIProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'Access OpenAI\'s advanced models',
    apiKeyPlaceholder: 'Enter your OpenAI API key',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  google: {
    id: 'google',
    name: 'Google',
    description: 'Use Google\'s Gemini models',
    apiKeyPlaceholder: 'Enter your Google AI API key',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Access Anthropic\'s Claude models',
    apiKeyPlaceholder: 'Enter your Anthropic API key',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'Access DeepSeek\'s models',
    apiKeyPlaceholder: 'Enter your DeepSeek API key',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access hundreds of AI models through OpenRouter',
    apiKeyPlaceholder: 'Enter your OpenRouter API key',
    apiKeyUrl: 'https://openrouter.ai/keys',
  },
  azure: {
    id: 'azure',
    name: 'Azure',
    description: 'Access Azure\'s models',
    apiKeyPlaceholder: 'Enter your Azure API key',
    apiKeyUrl: 'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/CognitiveServices',
  },
}

/**
 * Default model IDs per provider (short format, used by the native SDKs).
 * These are fallback defaults for when a user hasn't selected a model yet.
 */
const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o',
  google: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-4-5',
  deepseek: 'deepseek-chat',
  openrouter: 'anthropic/claude-sonnet-4-5',
  azure: 'gpt-4o',
}

export function getProviderConfig(provider: AIProvider): AIProviderConfig {
  return PROVIDER_CONFIGS[provider]
}

export function getDefaultModelForProvider(provider: AIProvider): string {
  return DEFAULT_MODELS[provider]
}
