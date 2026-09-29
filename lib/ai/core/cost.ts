import type { LanguageModelUsage, ProviderMetadata } from 'ai'
import { pickProviderCostUsd } from '../../chat/pick-provider-cost'
import type { Usage } from './types'

/** Token counts and OpenRouter's reported cost from one AI SDK result. */
export function usageOf(result: { usage: LanguageModelUsage; providerMetadata?: ProviderMetadata }): Usage {
  const costUsd = pickProviderCostUsd(result.providerMetadata)
  return {
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
    cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens ?? 0,
    reasoningTokens: result.usage.outputTokenDetails.reasoningTokens ?? 0,
    ...(costUsd !== null && { costUsd }),
  }
}

/** The reported cost when there is one, else tokens at the catalog price. */
export function calculateCostInDollars(
  usage: Usage,
  pricing: { input: number; output: number },
): number {
  if (usage.costUsd !== undefined) return usage.costUsd
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
  const sum = (key: keyof Usage) => usages.reduce((total, usage) => total + (usage[key] ?? 0), 0)
  return {
    promptTokens: sum('promptTokens'),
    inputTokens: sum('inputTokens'),
    completionTokens: sum('completionTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    reasoningTokens: sum('reasoningTokens'),
    // A reported total only when every call reported its cost; otherwise tokens × price for all.
    ...(usages.length > 0 && usages.every((usage) => usage.costUsd !== undefined) && { costUsd: sum('costUsd') }),
  }
}
