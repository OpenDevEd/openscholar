import type { AIModel, AIProvider, AIProviderConfig } from './types/ai.types'

const OPENAI_MODELS: AIModel[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    description: 'OpenAI\'s most advanced multimodal model',
    contextWindow: 128000,
    pricing: { input: 2.50, output: 10.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o-mini',
    provider: 'openai',
    description: 'Fast and efficient small model',
    contextWindow: 128000,
    pricing: { input: 0.15, output: 0.60 },
    capabilities: ['vision', 'function-calling'],
  },
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    description: 'OpenAI\'s advanced reasoning model',
    contextWindow: 200000,
    pricing: { input: 15.00, output: 60.00 },
    capabilities: ['reasoning'],
  },
  {
    id: 'o1-mini',
    name: 'o1-mini',
    provider: 'openai',
    description: 'Smaller reasoning model',
    contextWindow: 128000,
    pricing: { input: 1.10, output: 4.40 },
    capabilities: ['reasoning'],
  },
  {
    id: 'o3-mini',
    name: 'o3-mini',
    provider: 'openai',
    description: 'Advanced reasoning model',
    contextWindow: 200000,
    pricing: { input: 1.10, output: 4.40 },
    capabilities: ['reasoning'],
  },
  {
    id: 'o4-mini-2025-04-16',
    name: 'o4-mini',
    provider: 'openai',
    description: 'Optimized reasoning model',
    contextWindow: 200000,
    pricing: { input: 1.10, output: 4.40 },
    capabilities: ['reasoning'],
  },
]

const GOOGLE_MODELS: AIModel[] = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    description: 'Google\'s fast and efficient multimodal model',
    contextWindow: 1000000,
    pricing: { input: 0.10, output: 0.40 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    description: 'Google\'s most capable model',
    contextWindow: 1000000,
    pricing: { input: 1.25, output: 10.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    description: 'Fast and efficient model',
    contextWindow: 1000000,
    pricing: { input: 0.10, output: 0.40 },
    capabilities: ['vision', 'function-calling'],
  },
]

const ANTHROPIC_MODELS: AIModel[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude 4 Sonnet',
    provider: 'anthropic',
    description: 'Anthropic\'s advanced model for complex tasks',
    contextWindow: 200000,
    pricing: { input: 3.00, output: 15.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude 4 Opus',
    provider: 'anthropic',
    description: 'Anthropic\'s most powerful model',
    contextWindow: 200000,
    pricing: { input: 15.00, output: 75.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    provider: 'anthropic',
    description: 'Advanced Sonnet model with reasoning',
    contextWindow: 200000,
    pricing: { input: 3.00, output: 15.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    description: 'Versatile Sonnet model',
    contextWindow: 200000,
    pricing: { input: 3.00, output: 15.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    description: 'Fast and lightweight model',
    contextWindow: 200000,
    pricing: { input: 0.80, output: 4.00 },
    capabilities: ['vision', 'function-calling'],
  },
]

const PROVIDER_CONFIGS: Record<AIProvider, AIProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'Access OpenAI\'s advanced models like GPT-4o and o1',
    models: OPENAI_MODELS,
    apiKeyPlaceholder: 'Enter your OpenAI API key',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  google: {
    id: 'google',
    name: 'Google',
    description: 'Use Google\'s Gemini models',
    models: GOOGLE_MODELS,
    apiKeyPlaceholder: 'Enter your Google AI API key',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Access Anthropic\'s Claude models',
    models: ANTHROPIC_MODELS,
    apiKeyPlaceholder: 'Enter your Anthropic API key',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access hundreds of AI models through OpenRouter',
    models: [],
    apiKeyPlaceholder: 'Enter your OpenRouter API key',
    apiKeyUrl: 'https://openrouter.ai/keys',
  },
}

const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'o4-mini-2025-04-16',
  google: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-4-20250514',
  openrouter: 'anthropic/claude-sonnet-4-20250514',
}

export function getProviderConfig(provider: AIProvider): AIProviderConfig {
  return PROVIDER_CONFIGS[provider]
}

export function getModelById(provider: AIProvider, modelId: string): AIModel | undefined {
  if (provider === 'openrouter') {
    return undefined
  }
  const config = getProviderConfig(provider)
  return config.models.find((model) => model.id === modelId)
}

export function getModelsForProvider(provider: AIProvider): AIModel[] {
  return getProviderConfig(provider).models
}

export function getDefaultModelForProvider(provider: AIProvider): string {
  return DEFAULT_MODELS[provider]
}

export function getModelPricing(provider: AIProvider, modelId: string): { input: number; output: number } {
  if (provider === 'openrouter') {
    return { input: 0, output: 0 }
  }
  const model = getModelById(provider, modelId)
  if (!model) {
    return { input: 0, output: 0 }
  }
  return model.pricing
}

export function getAllProviderConfigs(): AIProviderConfig[] {
  return Object.values(PROVIDER_CONFIGS)
}
