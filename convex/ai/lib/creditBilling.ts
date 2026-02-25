import { calculateCostInDollars, type Usage } from "../../../lib/ai/core";
import type { AIProvider } from "../../../lib/types/ai.types";
import { convertDollarsToCredits } from "../../lib/creditTopups";
import { AI_COST_MARKUP } from "../../lib/constants";

function hasTokenUsage(usage: Usage): boolean {
  const inputTokens = usage.inputTokens ?? usage.promptTokens ?? 0;
  const outputTokens = usage.outputTokens ?? usage.completionTokens ?? 0;
  return inputTokens > 0 || outputTokens > 0;
}

/**
 * Convert provider/model dollar cost into credit units.
 */
export function convertUsdCostToCredits(
  costDollars: number,
  markupMultiplier = AI_COST_MARKUP,
): number {
  if (!Number.isFinite(costDollars) || costDollars <= 0) return 0;
  return convertDollarsToCredits(costDollars * markupMultiplier);
}

/**
 * Compute credits for an AI usage payload.
 * Falls back to a minimum 1-credit charge when usage is non-zero but
 * provider/model pricing resolves to $0 (for example dynamic OpenRouter IDs).
 */
export function calculateCreditsToDeductFromUsage(args: {
  usage: Usage;
  provider: AIProvider;
  modelId: string;
  markupMultiplier?: number;
}): number {
  const costDollars = calculateCostInDollars(
    args.usage,
    args.provider,
    args.modelId,
  );

  const pricedCredits = convertUsdCostToCredits(
    costDollars,
    args.markupMultiplier,
  );
  if (pricedCredits > 0) return pricedCredits;

  return hasTokenUsage(args.usage) ? 1 : 0;
}
