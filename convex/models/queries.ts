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
