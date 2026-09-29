import type { Doc } from "../../_generated/dataModel";
import { pickWebSearchPricing } from "@/lib/pricing";

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

  // The AI SDK's input count includes cached tokens and its output count
  // includes reasoning, so each part is priced once, at its own rate.
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const inputCost = (uncachedInput / perMillion) * model.inputPricePerMillion;
  const cacheReadCost =
    (usage.cacheReadTokens / perMillion) * (model.cacheReadPricePerMillion ?? model.inputPricePerMillion);
  const cacheWriteCost =
    (usage.cacheWriteTokens / perMillion) * (model.cacheWritePricePerMillion ?? model.inputPricePerMillion);

  const visibleOutput = Math.max(0, usage.outputTokens - usage.reasoningTokens);
  const outputCost = (visibleOutput / perMillion) * model.outputPricePerMillion;
  const reasoningCost =
    (usage.reasoningTokens / perMillion) * (model.reasoningPricePerMillion ?? model.outputPricePerMillion);

  // Web search — priced per request. When `model.webSearchPrice` is
  // null/undefined, the model has no native web search and OpenRouter
  // falls back to the Exa/Parallel server tool (~$0.02/call). The
  // selector picks native vs server-tool fallback; we keep the markup
  // layer separate (per-model `costMarkup` is applied in
  // `creditsFromCost`, not here).
  const webSearchPricing = pickWebSearchPricing({
    path: usage.webSearchRequests > 0 ? "openrouter" : null,
    modelWebSearchPriceUsd: model.webSearchPrice,
  });
  const webSearchCost =
    usage.webSearchRequests * (webSearchPricing.usdPerCall ?? 0);

  return inputCost + outputCost + reasoningCost + cacheReadCost + cacheWriteCost + webSearchCost;
}
