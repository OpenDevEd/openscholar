import type { AIProvider } from '@/lib/types'

export async function getProviderModel(provider: AIProvider, apiKey: string | undefined, modelId: string) {
  // If apiKey is empty string or undefined, pass undefined to let SDK use env vars
  const options = apiKey ? { apiKey } : undefined

  switch (provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI(options)(modelId)
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI(options)(modelId)
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic(options)(modelId)
    }
    case 'openrouter': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
      return createOpenRouter(options)(modelId)
    }
    case 'deepseek': {
      const { createDeepSeek } = await import('@ai-sdk/deepseek')
      return createDeepSeek(options)(modelId)
    }
    default:
      throw new Error(`Unsupported AI provider: ${provider}`)
  }
}