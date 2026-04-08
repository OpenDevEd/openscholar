import { calculateCostInDollars, type Usage } from "../../../lib/ai/core";
import { convertDollarsToCredits, getCreditsPerUsd } from "../../lib/creditTopups";
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
 * pricing resolves to $0 (for example models not yet synced).
 */
export function calculateCreditsToDeductFromUsage(args: {
  usage: Usage;
  pricing: { input: number; output: number };
  markupMultiplier?: number;
}): number {
  const costDollars = calculateCostInDollars(args.usage, args.pricing);

  const pricedCredits = convertUsdCostToCredits(
    costDollars,
    args.markupMultiplier,
  );
  if (pricedCredits > 0) return pricedCredits;

  return hasTokenUsage(args.usage) ? 1 : 0;
}

/**
 * Raw fractional credit cost without ceiling or minimum.
 * Use this for analytics; the actual deducted amount uses
 * `calculateCreditsToDeductFromUsage` which applies Math.ceil + min(1).
 */
export function calculateRawCreditCost(args: {
  usage: Usage;
  pricing: { input: number; output: number };
  markupMultiplier?: number;
}): number {
  const costDollars = calculateCostInDollars(args.usage, args.pricing);
  if (!Number.isFinite(costDollars) || costDollars <= 0) return 0;
  const markup = args.markupMultiplier ?? AI_COST_MARKUP;
  return costDollars * markup * getCreditsPerUsd();
}
