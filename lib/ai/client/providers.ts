import type { AIProvider } from '../../types'

export interface ProviderOptions {
  apiKey?: string
  openrouterProviderOrder?: string
  openrouterAllowFallbacks?: boolean
}

export async function getProviderModel(
  provider: AIProvider,
  apiKey: string | undefined,
  modelId: string,
  options?: ProviderOptions
) {
  // If apiKey is empty string or undefined, pass undefined to let SDK use env vars
  const baseOptions = apiKey ? { apiKey } : undefined

  switch (provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI(baseOptions)(modelId)
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI(baseOptions)(modelId)
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic(baseOptions)(modelId)
    }
    case 'openrouter': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
      
      // Build extraBody for provider routing if specified
      const extraBody: Record<string, unknown> = {}
      if (options?.openrouterProviderOrder) {
        const providerOrder = options.openrouterProviderOrder
          .split(',')
          .map(p => p.trim())
          .filter(p => p.length > 0)
        
        if (providerOrder.length > 0) {
          extraBody.provider = {
            order: providerOrder,
            allow_fallbacks: options.openrouterAllowFallbacks ?? true,
          }
        }
      }
      
      const openRouterOptions = {
        ...baseOptions,
        ...(Object.keys(extraBody).length > 0 && { extraBody }),
      }
      
      return createOpenRouter(openRouterOptions)(modelId)
    }
    case 'deepseek': {
      const { createDeepSeek } = await import('@ai-sdk/deepseek')
      return createDeepSeek(baseOptions)(modelId)
    }
    case 'azure': {
      const { createAzure } = await import('@ai-sdk/azure')
      return createAzure(baseOptions)(modelId)
    }
    default:
      throw new Error(`Unsupported AI provider: ${provider}`)
  }
}