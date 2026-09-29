import { query, internalQuery, type QueryCtx } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { activeModels, MAX_CATALOG_MODELS, pickable } from "./catalog";
import type { Doc } from "../_generated/dataModel";
import { isVariant, toNativeModelId } from "../../lib/ai/native-model-id";

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

function catalogOption(model: Doc<"models">) {
  return {
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
  };
}

async function modelsById(ctx: QueryCtx, modelIds: readonly string[]) {
  const models: Doc<"models">[] = [];
  for (const modelId of new Set(modelIds.slice(0, 20))) {
    const model = await ctx.db
      .query("models")
      .withIndex("by_model_id", (q) => q.eq("modelId", modelId))
      .unique();
    if (model && model.retiredAt === undefined && !model.hidden) models.push(model);
  }
  return models;
}

/**
 * Public query: list models filtered by provider.
 * If provider is omitted, returns all models.
 * Used by the settings page model selector.
 */
export const list = query({
  args: { provider: v.optional(v.string()) },
  handler: async (ctx, { provider }) => {
    return pickable(await activeModels(ctx, provider).take(MAX_CATALOG_MODELS));
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
    const rows = pickable(await activeModels(ctx, provider).take(MAX_CATALOG_MODELS));

    return rows.map(catalogOption);
  },
});

/**
 * One model users can pick, or null. With `provider`, `modelId` is that
 * provider's native id (what the browser key calls), matched to its catalog row.
 */
export const getCatalogOption = query({
  args: {
    modelId: v.string(),
    provider: v.optional(v.union(v.literal("openai"), v.literal("anthropic"), v.literal("google"), v.literal("deepseek"))),
  },
  returns: v.union(catalogOptionValidator, v.null()),
  handler: async (ctx, { modelId, provider }) => {
    if (provider) {
      const rows = pickable(await activeModels(ctx, provider).take(MAX_CATALOG_MODELS));
      const model = rows.find((row) => !isVariant(row.modelId) && toNativeModelId(row.modelId, provider) === modelId);
      return model ? catalogOption(model) : null;
    }
    const model = await ctx.db
      .query("models")
      .withIndex("by_model_id", (q) => q.eq("modelId", modelId))
      .unique();
    return model && model.retiredAt === undefined && !model.hidden ? catalogOption(model) : null;
  },
});

/** Complete catalog page for the Evidence Library model picker. */
export const paginateCatalogOptions = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await activeModels(ctx).paginate(paginationOpts);
    return { ...result, page: pickable(result.page).map(catalogOption) };
  },
});

/** Resolve only the configured ids, avoiding a full-table validation read. */
export const resolveEvidenceLibrarySelection = internalQuery({
  args: { modelIds: v.array(v.string()) },
  returns: v.object({
    catalogReady: v.boolean(),
    allowedModelIds: v.array(v.string()),
    modelMetadata: v.record(
      v.string(),
      v.object({ name: v.string(), company: v.string() }),
    ),
  }),
  handler: async (ctx, { modelIds }) => {
    const catalogReady = (await ctx.db.query("models").first()) !== null;
    const models = await modelsById(ctx, modelIds);
    return {
      catalogReady,
      allowedModelIds: models.map((model) => model.modelId),
      modelMetadata: Object.fromEntries(
        models.map((model) => {
          const separator = model.name.indexOf(": ");
          const name = (separator > 0 ? model.name.slice(separator + 2) : model.name).trim();
          const company = (separator > 0 ? model.name.slice(0, separator) : model.provider).trim();
          return [model.modelId, {
            name: (name || model.modelId).slice(0, 256),
            company: (company || "OpenRouter").slice(0, 128),
          }];
        }),
      ),
    };
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
      .withIndex("by_isServed_and_retiredAt_and_sortOrder", (q) => q.eq("isServed", true).eq("retiredAt", undefined))
      .take(MAX_CATALOG_MODELS);
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

    if (!model || model.retiredAt !== undefined || !model.isServed) return null;
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
    if (!row || row.retiredAt !== undefined || row.hidden) return null;
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
