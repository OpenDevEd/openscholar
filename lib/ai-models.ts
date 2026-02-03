import type { AIModel, AIProvider, AIProviderConfig } from './types/ai.types'

const OPENAI_MODELS: AIModel[] = [
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'openai',
    description: 'OpenAI\'s latest flagship model',
    contextWindow: 400000,
    pricing: { input: 1.75, output: 14.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gpt-5.2-pro',
    name: 'GPT-5.2 Pro',
    provider: 'openai',
    description: 'Enhanced reasoning with extended computational resources',
    contextWindow: 400000,
    pricing: { input: 21.00, output: 168.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    provider: 'openai',
    description: 'Advanced model with multimodal capabilities',
    contextWindow: 400000,
    pricing: { input: 1.25, output: 10.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    provider: 'openai',
    description: 'GPT-5 base model',
    contextWindow: 400000,
    pricing: { input: 1.25, output: 10.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gpt-5-pro',
    name: 'GPT-5 Pro',
    provider: 'openai',
    description: 'GPT-5 Pro with extended output',
    contextWindow: 400000,
    pricing: { input: 15.00, output: 120.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    provider: 'openai',
    description: 'Fast and cost-effective GPT-5 model',
    contextWindow: 400000,
    pricing: { input: 0.25, output: 2.00 },
    capabilities: ['vision', 'function-calling'],
  },
  {
    id: 'gpt-5-nano',
    name: 'GPT-5 Nano',
    provider: 'openai',
    description: 'Ultra-efficient GPT-5 model',
    contextWindow: 400000,
    pricing: { input: 0.05, output: 0.40 },
    capabilities: ['function-calling'],
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    description: 'OpenAI\'s advanced multimodal model',
    contextWindow: 128000,
    pricing: { input: 2.50, output: 10.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    description: 'Fast and efficient small model',
    contextWindow: 128000,
    pricing: { input: 0.15, output: 0.60 },
    capabilities: ['vision', 'function-calling'],
  },
]

const GOOGLE_MODELS: AIModel[] = [
  {
    id: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro Preview',
    provider: 'google',
    description: 'Latest flagship Gemini 3 Pro model',
    contextWindow: 1048576,
    pricing: { input: 2.00, output: 12.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    provider: 'google',
    description: 'Fastest Gemini 3 model with advanced reasoning',
    contextWindow: 1048576,
    pricing: { input: 0.50, output: 3.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    description: 'Advanced model with 1M token context',
    contextWindow: 1048576,
    pricing: { input: 1.25, output: 10.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    description: 'Fast and efficient multimodal model',
    contextWindow: 1048576,
    pricing: { input: 0.30, output: 2.50 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    provider: 'google',
    description: 'Lightweight and cost-effective model',
    contextWindow: 1048576,
    pricing: { input: 0.10, output: 0.40 },
    capabilities: ['vision', 'function-calling'],
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    description: 'Gemini 2.0 Flash model',
    contextWindow: 1048576,
    pricing: { input: 0.10, output: 0.40 },
    capabilities: ['vision', 'function-calling'],
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    description: 'High-performance Pro model',
    contextWindow: 2097152,
    pricing: { input: 3.50, output: 10.50 },
    capabilities: ['vision', 'function-calling'],
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'google',
    description: 'Fast and cost-effective model',
    contextWindow: 1048576,
    pricing: { input: 0.07, output: 0.30 },
    capabilities: ['vision', 'function-calling'],
  },
]

const ANTHROPIC_MODELS: AIModel[] = [
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    provider: 'anthropic',
    description: 'Latest and most powerful Claude model',
    contextWindow: 200000,
    pricing: { input: 5.00, output: 25.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    description: 'Latest balanced performance model',
    contextWindow: 200000,
    pricing: { input: 3.00, output: 15.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    description: 'Latest fast and efficient model',
    contextWindow: 200000,
    pricing: { input: 1.00, output: 5.00 },
    capabilities: ['vision', 'function-calling'],
  },
  {
    id: 'claude-opus-4-1',
    name: 'Claude Opus 4.1',
    provider: 'anthropic',
    description: 'Advanced Opus model with extended output',
    contextWindow: 200000,
    pricing: { input: 15.00, output: 75.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    description: 'High-performance model with 1M context window',
    contextWindow: 1000000,
    pricing: { input: 3.00, output: 15.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'claude-3-7-sonnet-latest',
    name: 'Claude 3.7 Sonnet',
    provider: 'anthropic',
    description: 'Enhanced Sonnet with extended output',
    contextWindow: 200000,
    pricing: { input: 3.00, output: 15.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'claude-3-5-sonnet-latest',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    description: 'Versatile Sonnet model',
    contextWindow: 200000,
    pricing: { input: 3.00, output: 15.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'claude-3-5-haiku-latest',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    description: 'Fast and lightweight model',
    contextWindow: 200000,
    pricing: { input: 1.00, output: 5.00 },
    capabilities: ['vision', 'function-calling'],
  },
  {
    id: 'claude-3-opus-latest',
    name: 'Claude 3 Opus',
    provider: 'anthropic',
    description: 'Most capable Claude 3 model',
    contextWindow: 200000,
    pricing: { input: 15.00, output: 75.00 },
    capabilities: ['vision', 'function-calling', 'reasoning'],
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    provider: 'anthropic',
    description: 'Fast and cost-effective Claude 3 model',
    contextWindow: 200000,
    pricing: { input: 0.25, output: 1.25 },
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
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'Access DeepSeek\'s models',
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        provider: 'deepseek',
        description: 'DeepSeek Chat model',
        pricing: { input: 0.14, output: 0.28 },
      },
      {
        id: 'deepseek-coder',
        name: 'DeepSeek Coder',
        provider: 'deepseek',
        description: 'DeepSeek Coder model',
        pricing: { input: 0.14, output: 0.28 },
      }
    ],
    apiKeyPlaceholder: 'Enter your DeepSeek API key',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access hundreds of AI models through OpenRouter',
    models: [],
    apiKeyPlaceholder: 'Enter your OpenRouter API key',
    apiKeyUrl: 'https://openrouter.ai/keys',
  },
  azure: {
    id: 'azure',
    name: 'Azure',
    description: 'Access Azure\'s models',
    models: [],
    apiKeyPlaceholder: 'Enter your Azure API key',
    apiKeyUrl: 'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/CognitiveServices',
  },
}

const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-5.2',
  google: 'gemini-3-flash-preview',
  anthropic: 'claude-sonnet-4-5',
  deepseek: 'deepseek-chat',
  openrouter: 'anthropic/claude-sonnet-4-5',
  azure: 'gpt-5-mini',
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
