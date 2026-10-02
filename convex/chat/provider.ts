/**
 * Thin helper around the shared getProviderModel — the chat pipeline
 * routes every call through OpenRouter (same helper extraction uses)
 * and returns the pricing row alongside so generateResponse can bill
 * every completed turn from the OpenRouter generation record after the
 * stream settles, regardless of whether it finished normally or was
 * user-stopped.
 *
 * When a GenerationIdSink is provided the helper wraps createOpenRouter's
 * fetch so the `X-Generation-Id` response header is captured abort-
 * safely — see convex/chat/openrouterFetch.ts.
 */

import type { ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getProviderModel } from "../../lib/ai/server/providers";
import { SERVER_AI_CONFIG } from "../ai/config";
import { createError } from "../lib/errors";
import { MODEL_UNAVAILABLE_MESSAGE } from "../models/catalog";
import type { LanguageModel } from "ai";
import {
  withGenerationIdCapture,
  type GenerationIdSink,
} from "./openrouterFetch";

export type Pricing = { input: number; output: number };

export type ResolvedChatModel = {
  // The concrete getProviderModel result (a LanguageModel subtype). Typed
  // precisely so server-feature consumers (extraction pipeline) that thread the
  // narrower getProviderModel type can reuse this resolver without a cast.
  model: Awaited<ReturnType<typeof getProviderModel>>;
  modelSlug: string;
  pricing: Pricing;
};

/**
 * Resolves a user-picked `Id<"models">` to:
 *   - a LanguageModel instance wired through OpenRouter with the
 *     server's provider-order preferences
 *   - the canonical modelId string used for metadata / pricing lookup
 *   - the live pricing (or { input: 0, output: 0 } if not yet synced)
 *
 * Throws VALIDATION_ERROR if the model row doesn't exist or isn't
 * flagged as served.
 */
export async function resolveOpenRouterModel(
  ctx: ActionCtx,
  modelId: Id<"models"> | null,
  options?: { generationIdSink?: GenerationIdSink },
): Promise<ResolvedChatModel> {
  let modelSlug: string;
  let pricing: Pricing;

  if (modelId) {
    const row = await ctx.runQuery(
      internal.models.queries.getById,
      { modelId },
    );
    // `isServed` is a curation flag (gates the preset/served lists), not a
    // runtime capability gate — a Custom pick may be any catalog model. Only
    // require the row to exist; pricing comes from the row regardless.
    if (!row) {
      throw createError(
        "VALIDATION_ERROR",
        MODEL_UNAVAILABLE_MESSAGE,
      );
    }
    modelSlug = row.modelId;
    pricing = {
      input: row.inputPricePerMillion,
      output: row.outputPricePerMillion,
    };
  } else {
    // Fallback to the server default. Matches the UX contract that
    // ModelPicker auto-picks the first served model on first render.
    modelSlug = SERVER_AI_CONFIG.model.includes("/")
      ? SERVER_AI_CONFIG.model
      : `${SERVER_AI_CONFIG.provider}/${SERVER_AI_CONFIG.model}`;
    const [p, offered] = await Promise.all([
      ctx.runQuery(internal.models.queries.getPricing, { modelId: modelSlug }),
      ctx.runQuery(api.models.queries.getCatalogOption, { modelId: modelSlug }),
    ]);
    // A catalog model an admin switched off (or that retired) never runs, even as the default.
    if (p && !offered) {
      throw createError("VALIDATION_ERROR", MODEL_UNAVAILABLE_MESSAGE);
    }
    pricing = p ?? { input: 0, output: 0 };
  }

  return { model: await openRouterModel(modelSlug, options), modelSlug, pricing };
}

/** A catalog model the caller already read, wired through OpenRouter with the server's provider preferences. */
export async function openRouterModel(modelSlug: string, options?: { generationIdSink?: GenerationIdSink }) {
  return await getProviderModel("openrouter", undefined, modelSlug, {
    openrouterProviderOrder: SERVER_AI_CONFIG.openrouterProviderOrder,
    openrouterAllowFallbacks: SERVER_AI_CONFIG.openrouterAllowFallbacks,
    // Bills against providerMetadata.openrouter.usage.cost when
    // present — see convex/chat/billing.ts.
    openrouterUsageInclude: true,
    ...(options?.generationIdSink
      ? { fetch: withGenerationIdCapture(options.generationIdSink) }
      : {}),
  });
}
