import type { Pricing, Usage } from './types'
import { getModelPricing } from '@/lib/ai-models'
import { AIProvider } from '@/lib/types/ai.types'

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
