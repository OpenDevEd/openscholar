import type { AIProvider } from '../../types'

export interface ProviderOptions {
  apiKey?: string
  openrouterProviderOrder?: string
  openrouterAllowFallbacks?: boolean
  /**
   * Optional fetch override. Wired through to providers that accept a
   * custom fetch (OpenRouter does). Used by chat billing to capture
   * X-Generation-Id from the initial HTTP response headers so stopped
   * streams can still reconcile against OpenRouter's generation API —
   * see convex/chat/openrouterFetch.ts.
   */
  fetch?: typeof globalThis.fetch
  /**
   * When true, builds the OpenRouter chat model with `usage: { include: true }`
   * so providerMetadata.openrouter.usage.cost is populated on the AI SDK
   * `finish` event. Chat billing prefers this all-in cost over the
   * pricing×tokens math — see plan-02 and convex/chat/billing.ts.
   */
  openrouterUsageInclude?: boolean
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
        ...(options?.fetch ? { fetch: options.fetch } : {}),
      }

      const modelSettings = options?.openrouterUsageInclude
        ? { usage: { include: true } }
        : undefined

      return createOpenRouter(openRouterOptions)(modelId, modelSettings)
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