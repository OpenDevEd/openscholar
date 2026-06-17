import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";

const catalogOptionValidator = v.object({
  _id: v.id("models"),
  modelId: v.string(),
  name: v.string(),
  provider: v.string(),
  description: v.optional(v.string()),
  contextLength: v.optional(v.number()),
  inputPricePerMillion: v.number(),
  outputPricePerMillion: v.number(),
  category: v.optional(v.string()),
  modality: v.optional(v.string()),
  tokenizer: v.optional(v.string()),
});

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
 * Public query: compact catalog options for the settings UI.
 * Returns only the fields the page renders and avoids a live whole-row shape.
 */
export const listCatalogOptions = query({
  args: { provider: v.optional(v.string()) },
  returns: v.array(catalogOptionValidator),
  handler: async (ctx, { provider }) => {
    const rows = provider
      ? await ctx.db
          .query("models")
          .withIndex("by_provider", (q) => q.eq("provider", provider))
          .take(500)
      : await ctx.db.query("models").take(1000);

    return rows.map((model) => ({
      _id: model._id,
      modelId: model.modelId,
      name: model.name,
      provider: model.provider,
      description: model.description,
      contextLength: model.contextLength,
      inputPricePerMillion: model.inputPricePerMillion,
      outputPricePerMillion: model.outputPricePerMillion,
      category: model.category,
      modality: model.modality,
      tokenizer: model.tokenizer,
    }));
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
