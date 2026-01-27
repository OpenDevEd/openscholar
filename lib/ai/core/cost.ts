import type { Pricing, Usage } from './types'
import { getModelPricing } from '../../ai-models'
import { AIProvider } from '../../types/ai.types'

export function calculateCostInDollars(
  usage: Usage,
  provider: AIProvider,
  modelId: string
): number {
  const promptTokens = usage.promptTokens ?? usage.inputTokens ?? 0
  const completionTokens = usage.completionTokens ?? usage.outputTokens ?? 0

  if (!promptTokens && !completionTokens) return 0

  const pricing = getModelPricing(provider, modelId)

  return ((promptTokens / 1_000_000) * pricing.input) + 
         ((completionTokens / 1_000_000) * pricing.output)
}

export function dollarsToCredits(dollars: number): number {
  return Math.ceil(dollars * 100)
}

/**
 * Aggregates multiple Usage objects into a single total.
 * Useful for batch operations where each item generates usage.
 */
export function aggregateUsage(usages: Usage[]): Usage {
  return usages.reduce(
    (acc, usage) => ({
      promptTokens: (acc.promptTokens || 0) + (usage.promptTokens || 0),
      inputTokens: (acc.inputTokens || 0) + (usage.inputTokens || 0),
      completionTokens: (acc.completionTokens || 0) + (usage.completionTokens || 0),
      outputTokens: (acc.outputTokens || 0) + (usage.outputTokens || 0),
    }),
    { promptTokens: 0, inputTokens: 0, completionTokens: 0, outputTokens: 0 } as Usage
  )
}
