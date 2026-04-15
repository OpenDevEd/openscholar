"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Batch size for mutations to stay within Convex limits. */
const BATCH_SIZE = 50;

interface OpenRouterPricing {
  prompt?: string;
  completion?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  internal_reasoning?: string;
  web_search?: string;
  image?: string;
  audio?: string;
}

interface OpenRouterModel {
  id: string;
  canonical_slug?: string;
  name: string;
  hugging_face_id?: string | null;
  description?: string;
  created?: number;
  pricing?: OpenRouterPricing;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
    instruct_type?: string | null;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number | null;
    is_moderated?: boolean;
  };
  supported_parameters?: string[];
  knowledge_cutoff?: string | null;
  expiration_date?: string | null;
  default_parameters?: {
    temperature?: number | null;
    top_p?: number | null;
    top_k?: number | null;
  };
}

/**
 * Parse a pricing string (USD per token) into USD per million tokens.
 * Returns null for missing, non-finite, or meta-model values ("-1").
 */
function parsePerMillion(value?: string): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n * 1_000_000;
}

/** Extract provider prefix from an OpenRouter model ID. */
function extractProvider(modelId: string): string {
  const slashIdx = modelId.indexOf("/");
  return slashIdx > 0 ? modelId.slice(0, slashIdx) : "unknown";
}

/**
 * Transform a raw OpenRouter model into the shape expected by the upsert mutation.
 * Returns null for meta/router models with dynamic pricing.
 */
function transformModel(raw: OpenRouterModel) {
  const inputPricePerMillion = parsePerMillion(raw.pricing?.prompt);
  const outputPricePerMillion = parsePerMillion(raw.pricing?.completion);

  // Skip models with unparseable or dynamic pricing
  if (inputPricePerMillion === null || outputPricePerMillion === null) return null;

  return {
    modelId: raw.id,
    name: raw.name,
    provider: extractProvider(raw.id),
    description: raw.description ?? undefined,
    canonicalSlug: raw.canonical_slug ?? undefined,
    huggingFaceId: raw.hugging_face_id ?? undefined,

    modality: raw.architecture?.modality ?? undefined,
    inputModalities: raw.architecture?.input_modalities ?? undefined,
    outputModalities: raw.architecture?.output_modalities ?? undefined,
    tokenizer: raw.architecture?.tokenizer ?? undefined,
    instructType: raw.architecture?.instruct_type ?? undefined,

    inputPricePerMillion,
    outputPricePerMillion,
    cacheReadPricePerMillion: parsePerMillion(raw.pricing?.input_cache_read) ?? undefined,
    cacheWritePricePerMillion: parsePerMillion(raw.pricing?.input_cache_write) ?? undefined,
    reasoningPricePerMillion: parsePerMillion(raw.pricing?.internal_reasoning) ?? undefined,
    webSearchPrice: parsePerMillion(raw.pricing?.web_search) ?? undefined,
    imagePricePerMillion: parsePerMillion(raw.pricing?.image) ?? undefined,
    audioPricePerMillion: parsePerMillion(raw.pricing?.audio) ?? undefined,

    contextLength: raw.context_length ?? undefined,
    maxCompletionTokens: raw.top_provider?.max_completion_tokens ?? undefined,
    isModerated: raw.top_provider?.is_moderated ?? undefined,

    supportedParameters: raw.supported_parameters ?? undefined,

    knowledgeCutoff: raw.knowledge_cutoff ?? undefined,
    expirationDate: raw.expiration_date ?? undefined,
    createdOnOpenRouter: raw.created ?? undefined,

    defaultTemperature: raw.default_parameters?.temperature ?? undefined,
    defaultTopP: raw.default_parameters?.top_p ?? undefined,
    defaultTopK: raw.default_parameters?.top_k ?? undefined,
  };
}

/**
 * Fetch all models from OpenRouter and upsert into the models table.
 * Runs daily via cron. Preserves business-layer overrides (isServed, costMarkup, sortOrder).
 */
export const syncFromOpenRouter = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.error(`[syncFromOpenRouter] OpenRouter API returned ${response.status}`);
      return 0;
    }

    const json = (await response.json()) as { data: OpenRouterModel[] };
    if (!Array.isArray(json.data)) {
      console.error("[syncFromOpenRouter] Unexpected response shape");
      return 0;
    }

    const entries = json.data
      .map(transformModel)
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (entries.length === 0) {
      console.warn("[syncFromOpenRouter] No entries to write");
      return 0;
    }

    let total = 0;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const written = await ctx.runMutation(
        internal.models.mutations.upsertBatch,
        { entries: batch },
      );
      total += written;
    }

    console.log(`[syncFromOpenRouter] Synced ${total} models from OpenRouter (${entries.length} total)`);
    return total;
  },
});
