"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

import { z } from "zod";
import { MAX_CATALOG_MODELS } from "./catalog";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const optionalText = z.string().nullish();
const optionalNumber = z.number().finite().nullish();
const rawModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  canonical_slug: optionalText,
  hugging_face_id: optionalText,
  description: optionalText,
  created: optionalNumber,
  pricing: z.object({
    prompt: optionalText, completion: optionalText,
    input_cache_read: optionalText, input_cache_write: optionalText,
    internal_reasoning: optionalText, web_search: optionalText,
    image: optionalText, audio: optionalText,
  }).optional(),
  context_length: optionalNumber,
  architecture: z.object({
    modality: optionalText,
    input_modalities: z.array(z.string()).optional(),
    output_modalities: z.array(z.string()).optional(),
    tokenizer: optionalText, instruct_type: optionalText,
  }).optional(),
  top_provider: z.object({
    max_completion_tokens: optionalNumber,
    is_moderated: z.boolean().optional(),
  }).optional(),
  supported_parameters: z.array(z.string()).optional(),
  knowledge_cutoff: optionalText,
  expiration_date: optionalText,
  default_parameters: z.object({
    temperature: optionalNumber, top_p: optionalNumber, top_k: optionalNumber,
  }).optional(),
});
type OpenRouterModel = z.infer<typeof rawModelSchema>;
const catalogSchema = z.object({data: z.array(rawModelSchema).min(1).max(MAX_CATALOG_MODELS)});

/**
 * Parse a pricing string (USD per token) into USD per million tokens.
 * Returns null for missing, non-finite, or meta-model values ("-1").
 */
function parsePerMillion(value?: string | null): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n * 1_000_000;
}

/**
 * Parse a flat-rate pricing string (USD per request/operation) directly.
 * Used for per-call OpenRouter fields like `pricing.web_search` whose values
 * are literal dollars per invocation (e.g., "0.01" → $0.01/call) — NOT
 * per-token fractions. Cross-ref openrouter.ai docs:
 *   "web_search: string — Cost per web search operation"
 */
function parseDollars(value?: string | null): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Extract provider prefix from an OpenRouter model ID. */
function extractProvider(modelId: string): string {
  const slashIdx = modelId.indexOf("/");
  return slashIdx > 0 ? modelId.slice(0, slashIdx) : "unknown";
}

/**
 * Transform a raw OpenRouter model into the shape expected by the upsert mutation.
 * Returns null for meta/router models with dynamic pricing.
 *
 * Exported for unit testing. Pure function — no Convex / runtime deps.
 */
export function transformModel(raw: OpenRouterModel) {
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
    webSearchPrice: parseDollars(raw.pricing?.web_search) ?? undefined,
    // image/audio: per-token dollars (verified — Gemini bills images and
    // every audio-bearing model bills audio as input tokens; raw values
    // match each provider's published $/M token rate exactly).
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

async function readCatalogResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OpenRouter catalog response is empty");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    // Bound reads too: even a stream of empty chunks cannot spin forever.
    for (let reads = 0; reads < 8192; reads++) {
      const {done, value} = await reader.read();
      if (done) return Buffer.concat(chunks).toString("utf8");
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("OpenRouter catalog exceeds the response size limit");
      chunks.push(value);
    }
    throw new Error("OpenRouter catalog exceeds the response chunk limit");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** One HTTP request and one atomic write. Never schedules itself or retries. */
export const syncFromOpenRouter = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`OpenRouter catalog returned HTTP ${response.status}`);
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new Error("OpenRouter catalog exceeds the response size limit");
    }
    const text = await readCatalogResponse(response);
    const {data} = catalogSchema.parse(JSON.parse(text));
    if (new Set(data.map(model => model.id)).size !== data.length) {
      throw new Error("OpenRouter catalog contains duplicate model ids");
    }
    const entries = data.map(transformModel).filter(entry => entry !== null);
    if (entries.length === 0) throw new Error("OpenRouter catalog contains no models with usable pricing");
    const total: number = await ctx.runMutation(internal.models.mutations.reconcileCatalog, {entries});
    console.log(`[syncFromOpenRouter] Synced ${total} models in one pass`);
    return total;
  },
});
