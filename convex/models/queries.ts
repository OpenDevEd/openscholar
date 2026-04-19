import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Public query: list models filtered by provider.
 * If provider is omitted, returns all models.
 * Used by the settings page model selector.
 */
export const list = query({
  args: { provider: v.optional(v.string()) },
  handler: async (ctx, { provider }) => {
    if (provider) {
      return await ctx.db
        .query("models")
        .withIndex("by_provider", (q) => q.eq("provider", provider))
        .collect();
    }
    return await ctx.db.query("models").collect();
  },
});

/**
 * Internal query: list served models for the wallet gateway.
 */
export const listServed = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("models")
      .withIndex("by_served_sort", (q) => q.eq("isServed", true))
      .collect();
  },
});

/**
 * Internal query: look up a single served model by ID.
 * Returns null if not found or not served.
 */
export const getServedByModelId = internalQuery({
  args: { modelId: v.string() },
  handler: async (ctx, { modelId }) => {
    const model = await ctx.db
      .query("models")
      .withIndex("by_model_id", (q) => q.eq("modelId", modelId))
      .unique();

    if (!model || !model.isServed) return null;
    return model;
  },
});

/**
 * Internal query: resolve a models row by its Convex _id, returning
 * the fields the chat pipeline needs at per-turn model resolution.
 * Used by convex/chat/provider.ts::resolveOpenRouterModel.
 */
export const getById = internalQuery({
  args: { modelId: v.id("models") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("models"),
      modelId: v.string(),
      name: v.string(),
      provider: v.string(),
      isServed: v.boolean(),
      inputPricePerMillion: v.number(),
      outputPricePerMillion: v.number(),
    }),
  ),
  handler: async (ctx, { modelId }) => {
    const row = await ctx.db.get(modelId);
    if (!row) return null;
    return {
      _id: row._id,
      modelId: row.modelId,
      name: row.name,
      provider: row.provider,
      isServed: row.isServed,
      inputPricePerMillion: row.inputPricePerMillion,
      outputPricePerMillion: row.outputPricePerMillion,
    };
  },
});

/**
 * Internal query: get pricing for a model by ID.
 * Used by the credit billing system.
 */
export const getPricing = internalQuery({
  args: { modelId: v.string() },
  returns: v.union(
    v.object({ input: v.number(), output: v.number() }),
    v.null(),
  ),
  handler: async (ctx, { modelId }) => {
    const row = await ctx.db
      .query("models")
      .withIndex("by_model_id", (q) => q.eq("modelId", modelId))
      .unique();

    if (!row) return null;
    return { input: row.inputPricePerMillion, output: row.outputPricePerMillion };
  },
});
