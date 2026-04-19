/**
 * Thin helper around the shared getProviderModel — the chat pipeline
 * routes every call through OpenRouter (same helper extraction uses)
 * and returns the pricing row alongside so usageHandler's math stays
 * in one place.
 */

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getProviderModel } from "../../lib/ai/server/providers";
import { SERVER_AI_CONFIG } from "../ai/config";
import { createError } from "../lib/errors";
import type { LanguageModel } from "ai";

export type Pricing = { input: number; output: number };

export type ResolvedChatModel = {
  model: LanguageModel;
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
): Promise<ResolvedChatModel> {
  let modelSlug: string;
  let pricing: Pricing;

  if (modelId) {
    const row = await ctx.runQuery(
      internal.models.queries.getById,
      { modelId },
    );
    if (!row || !row.isServed) {
      throw createError(
        "VALIDATION_ERROR",
        "Selected chat model is not available.",
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
    const p = await ctx.runQuery(internal.models.queries.getPricing, {
      modelId: modelSlug,
    });
    pricing = p ?? { input: 0, output: 0 };
  }

  const model = await getProviderModel("openrouter", undefined, modelSlug, {
    openrouterProviderOrder: SERVER_AI_CONFIG.openrouterProviderOrder,
    openrouterAllowFallbacks: SERVER_AI_CONFIG.openrouterAllowFallbacks,
  });

  return { model, modelSlug, pricing };
}
