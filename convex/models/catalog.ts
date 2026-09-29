import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";

// ponytail: one transaction handles up to 2,000 active models. Increase only
// after checking Convex transaction limits; never add a self-scheduling loop.
export const MAX_CATALOG_MODELS = 2_000;

export function activeModels(ctx: QueryCtx, provider?: string) {
  return provider
    ? ctx.db.query("models").withIndex("by_provider_and_retiredAt", q => q.eq("provider", provider).eq("retiredAt", undefined))
    : ctx.db.query("models").withIndex("by_retiredAt", q => q.eq("retiredAt", undefined));
}

/** Models users can pick: everything active that an admin hasn't hidden. */
export const pickable = <T extends { hidden?: boolean }>(rows: T[]) => rows.filter((row) => !row.hidden);

export const MODEL_UNAVAILABLE_MESSAGE = "Selected model is no longer available. Choose another model.";

export async function requireAvailableModel(ctx: QueryCtx, modelId: Id<"models">) {
  const model = await ctx.db.get("models", modelId);
  if (!model || model.retiredAt !== undefined || model.hidden) {
    throw createError("VALIDATION_ERROR", MODEL_UNAVAILABLE_MESSAGE);
  }
  return model;
}
