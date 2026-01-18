import type { Pricing, Usage } from './types'

export function calculateCostInDollars(
  usage: Usage,
  pricing: Pricing
): number {
  const promptTokens = usage.promptTokens ?? usage.inputTokens ?? 0
  const completionTokens = usage.completionTokens ?? usage.outputTokens ?? 0

  if (!promptTokens && !completionTokens) return 0

  return ((promptTokens / 1_000_000) * pricing.input) + 
         ((completionTokens / 1_000_000) * pricing.output)
}

export function dollarsToCredits(dollars: number): number {
  return Math.ceil(dollars * 100)
}

export const DEEPSEEK_PRICING: Pricing = {
  input: 0.14,
  output: 0.28,
}