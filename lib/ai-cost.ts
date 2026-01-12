import { useAIConfigStore } from './store'
import { getModelPricing } from './ai-models'
import type { AIProvider } from '@/lib/types'

/** Throw if the configured budget (if any) has been exceeded */
export function assertWithinBudget() {
  try {
    const { dollarsUsed, budget } = useAIConfigStore.getState()
    if (budget > 0 && dollarsUsed >= budget) {
      throw new Error(`Budget of $${budget.toFixed(2)} exceeded`)
    }
  } catch {
    // If store isn't available (e.g. SSR without client hydration) skip the check.
  }
}

/**
 * Read token usage from Vercel AI SDK result & increment dollarsUsed
 * @param provider the AI provider being used
 * @param modelId the model ID being used
 * @param usage token usage object returned by the SDK
 */
export function addCostFromUsage(provider: AIProvider, modelId: string, usage: any): number {
  try {
    const { addDollarsUsed } = useAIConfigStore.getState()

    const promptTokens = usage?.promptTokens ?? usage?.inputTokens ?? 0
    const completionTokens = usage?.completionTokens ?? usage?.outputTokens ?? 0
    if (!promptTokens && !completionTokens) return 0

    const pricing = getModelPricing(provider, modelId)
    const cost = ((promptTokens / 1_000_000) * pricing.input) + ((completionTokens / 1_000_000) * pricing.output)
    if (cost > 0) addDollarsUsed(cost)
    return cost
  } catch {
    // best-effort; ignore failures
    return 0
  }
} 