import type { Usage } from './types'

export function calculateCostInDollars(
  usage: Usage,
  pricing: { input: number; output: number },
): number {
  const promptTokens = usage.promptTokens ?? usage.inputTokens ?? 0
  const completionTokens = usage.completionTokens ?? usage.outputTokens ?? 0

  if (!promptTokens && !completionTokens) return 0

  return ((promptTokens / 1_000_000) * pricing.input) +
         ((completionTokens / 1_000_000) * pricing.output)
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
