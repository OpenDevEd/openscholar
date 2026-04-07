"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Provider prefixes we care about — matches OPENROUTER_PROVIDER_MAP in lib/ai-models.ts */
const KNOWN_PREFIXES = ["openai/", "google/", "anthropic/", "deepseek/"];

interface OpenRouterModel {
  id: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

/**
 * Parse OpenRouter pricing strings (USD per token) into USD per 1M tokens.
 * Returns null if values are missing or not parseable.
 */
export function parseOpenRouterPricing(
  pricing?: { prompt?: string; completion?: string },
): { inputPerMillion: number; outputPerMillion: number } | null {
  if (!pricing?.prompt || !pricing?.completion) return null;

  const inputPerToken = parseFloat(pricing.prompt);
  const outputPerToken = parseFloat(pricing.completion);

  if (!Number.isFinite(inputPerToken) || !Number.isFinite(outputPerToken)) {
    return null;
  }

  return {
    inputPerMillion: inputPerToken * 1_000_000,
    outputPerMillion: outputPerToken * 1_000_000,
  };
}

export const refreshOpenRouterPricing = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const response = await fetch(OPENROUTER_MODELS_URL);
    if (!response.ok) {
      console.error(
        `[refreshOpenRouterPricing] OpenRouter API returned ${response.status}`,
      );
      return 0;
    }

    const json = (await response.json()) as { data: OpenRouterModel[] };
    if (!Array.isArray(json.data)) {
      console.error("[refreshOpenRouterPricing] Unexpected response shape");
      return 0;
    }

    const entries: {
      modelId: string;
      inputPerMillion: number;
      outputPerMillion: number;
    }[] = [];

    for (const model of json.data) {
      if (!KNOWN_PREFIXES.some((p) => model.id.startsWith(p))) continue;

      const parsed = parseOpenRouterPricing(model.pricing);
      if (!parsed) continue;

      entries.push({ modelId: model.id, ...parsed });
    }

    if (entries.length === 0) {
      console.warn("[refreshOpenRouterPricing] No entries to write");
      return 0;
    }

    // Batch into chunks of 100 to stay within mutation limits
    const BATCH_SIZE = 100;
    let total = 0;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const written = await ctx.runMutation(
        internal.pricing.mutations.upsertPricing,
        { entries: batch },
      );
      total += written;
    }

    console.log(
      `[refreshOpenRouterPricing] Updated ${total} model pricing entries`,
    );
    return total;
  },
});
