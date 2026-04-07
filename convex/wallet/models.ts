import { query, mutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";

const providerValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("deepseek"),
  v.literal("azure"),
  v.literal("openrouter"),
);

/**
 * List active wallet models. Used by the HTTP Action handler.
 */
export const listActive = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("walletModels")
      .withIndex("by_active_sort", (q) => q.eq("isActive", true))
      .collect();
  },
});

/**
 * Look up a single model by modelId. Used by the generate handler.
 */
export const getByModelId = internalQuery({
  args: { modelId: v.string() },
  handler: async (ctx, args) => {
    const model = await ctx.db
      .query("walletModels")
      .withIndex("by_model_id", (q) => q.eq("modelId", args.modelId))
      .unique();

    if (!model || !model.isActive) return null;
    return model;
  },
});

/**
 * Public query: list all models (for admin UI / settings).
 */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("walletModels")
      .withIndex("by_active_sort", (q) => q.eq("isActive", true))
      .collect();
  },
});

/**
 * Add a new model to the wallet catalog.
 */
export const add = mutation({
  args: {
    modelId: v.string(),
    name: v.string(),
    provider: providerValidator,
    description: v.optional(v.string()),
    contextWindow: v.optional(v.number()),
    inputPricePerMillion: v.number(),
    outputPricePerMillion: v.number(),
    costMarkup: v.optional(v.number()),
    capabilities: v.optional(v.array(v.string())),
    category: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check for duplicate modelId
    const existing = await ctx.db
      .query("walletModels")
      .withIndex("by_model_id", (q) => q.eq("modelId", args.modelId))
      .unique();
    if (existing) throw createError("VALIDATION_ERROR", `Model "${args.modelId}" already exists`);

    const now = Date.now();
    return await ctx.db.insert("walletModels", {
      modelId: args.modelId,
      name: args.name,
      provider: args.provider,
      description: args.description,
      contextWindow: args.contextWindow,
      inputPricePerMillion: args.inputPricePerMillion,
      outputPricePerMillion: args.outputPricePerMillion,
      costMarkup: args.costMarkup ?? 1.3,
      capabilities: args.capabilities ?? [],
      category: args.category,
      isActive: true,
      sortOrder: args.sortOrder ?? 100,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update an existing model.
 */
export const update = mutation({
  args: {
    id: v.id("walletModels"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    contextWindow: v.optional(v.number()),
    inputPricePerMillion: v.optional(v.number()),
    outputPricePerMillion: v.optional(v.number()),
    costMarkup: v.optional(v.number()),
    capabilities: v.optional(v.array(v.string())),
    category: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw createError("NOT_FOUND", "Model not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }

    await ctx.db.patch(id, patch);
  },
});

/**
 * Remove a model from the catalog.
 */
export const remove = mutation({
  args: { id: v.id("walletModels") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
