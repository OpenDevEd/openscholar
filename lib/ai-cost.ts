import { useAIConfigStore } from './store'
import { PRICING, OPENAI_MODEL, GOOGLE_MODEL } from './screening-utils'
import type { AIProvider } from '@/app/actions/ai-enhance'

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
 * @param provider currently only 'openai' | 'google'
 * @param usage token usage object returned by the SDK
 */
export function addCostFromUsage(provider: AIProvider, usage: any): number {
  try {
    const { addDollarsUsed } = useAIConfigStore.getState()

    const promptTokens = usage?.promptTokens ?? usage?.inputTokens ?? 0
    const completionTokens = usage?.completionTokens ?? usage?.outputTokens ?? 0
    if (!promptTokens && !completionTokens) return 0

    const priceTable = PRICING[provider === 'openai' ? OPENAI_MODEL : GOOGLE_MODEL]
    const cost = ((promptTokens / 1_000_000) * priceTable.input) + ((completionTokens / 1_000_000) * priceTable.output)
    if (cost > 0) addDollarsUsed(cost)
    return cost
  } catch {
    // best-effort; ignore failures
    return 0
  }
} 