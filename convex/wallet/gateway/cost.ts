import type { Doc } from "../../_generated/dataModel";
import { getCreditsPerUsd } from "../../lib/creditTopups";

// ─── Types ──────────────────────────────────────────────────

export interface EnhancedUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearchRequests: number;
}

// ─── Extract usage from AI SDK result ───────────────────────

export function extractEnhancedUsage(aiSdkUsage: {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    reasoningTokens?: number;
  };
}): EnhancedUsage {
  return {
    inputTokens: aiSdkUsage.inputTokens ?? 0,
    outputTokens: aiSdkUsage.outputTokens ?? 0,
    reasoningTokens: aiSdkUsage.outputTokenDetails?.reasoningTokens ?? 0,
    cacheReadTokens: aiSdkUsage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: aiSdkUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
    webSearchRequests: 0, // Set externally from source event count
  };
}

// ─── Cost calculation ───────────────────────────────────────

/**
 * Calculate the dollar cost for a generation request, including
 * reasoning and cache token pricing when available.
 */
export function calculateEnhancedModelCost(
  usage: EnhancedUsage,
  model: Doc<"models">,
): number {
  const perMillion = 1_000_000;

  const inputCost =
    (usage.inputTokens / perMillion) * model.inputPricePerMillion;
  const outputCost =
    (usage.outputTokens / perMillion) * model.outputPricePerMillion;

  // Reasoning tokens — fall back to output price if no dedicated pricing
  const reasoningPrice =
    model.reasoningPricePerMillion ?? model.outputPricePerMillion;
  const reasoningCost =
    (usage.reasoningTokens / perMillion) * reasoningPrice;

  // Cache tokens
  const cacheReadCost =
    (usage.cacheReadTokens / perMillion) *
    (model.cacheReadPricePerMillion ?? 0);
  const cacheWriteCost =
    (usage.cacheWriteTokens / perMillion) *
    (model.cacheWritePricePerMillion ?? 0);

  // Web search — priced per request
  const webSearchCost =
    usage.webSearchRequests * (model.webSearchPrice ?? 0);

  return inputCost + outputCost + reasoningCost + cacheReadCost + cacheWriteCost + webSearchCost;
}

/**
 * Convert a dollar cost + markup into credits.
 * Minimum 1 credit for any non-zero usage.
 */
export function creditsFromCost(
  costDollars: number,
  markup: number,
): number {
  const raw = costDollars * markup * getCreditsPerUsd();
  return raw > 0 ? Math.max(1, Math.ceil(raw)) : 0;
}
