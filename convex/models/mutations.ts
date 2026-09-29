import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { activeModels, MAX_CATALOG_MODELS } from "./catalog";

/** Shape of a single model entry from the sync action. */
const modelEntryValidator = v.object({
  modelId: v.string(),
  name: v.string(),
  provider: v.string(),
  description: v.optional(v.string()),
  canonicalSlug: v.optional(v.string()),
  huggingFaceId: v.optional(v.string()),

  modality: v.optional(v.string()),
  inputModalities: v.optional(v.array(v.string())),
  outputModalities: v.optional(v.array(v.string())),
  tokenizer: v.optional(v.string()),
  instructType: v.optional(v.string()),

  inputPricePerMillion: v.number(),
  outputPricePerMillion: v.number(),
  cacheReadPricePerMillion: v.optional(v.number()),
  cacheWritePricePerMillion: v.optional(v.number()),
  reasoningPricePerMillion: v.optional(v.number()),
  webSearchPrice: v.optional(v.number()),
  imagePricePerMillion: v.optional(v.number()),
  audioPricePerMillion: v.optional(v.number()),

  contextLength: v.optional(v.number()),
  maxCompletionTokens: v.optional(v.number()),
  isModerated: v.optional(v.boolean()),

  supportedParameters: v.optional(v.array(v.string())),

  knowledgeCutoff: v.optional(v.string()),
  expirationDate: v.optional(v.string()),
  createdOnOpenRouter: v.optional(v.number()),

  defaultTemperature: v.optional(v.number()),
  defaultTopP: v.optional(v.number()),
  defaultTopK: v.optional(v.number()),
});

/**
 * Apply one complete catalog atomically; keep retired rows for saved references.
 * Preserves business-layer overrides (isServed, costMarkup, sortOrder, category)
 * when updating existing models. New models default to isServed: false.
 */
export const reconcileCatalog = internalMutation({
  args: {
    entries: v.array(modelEntryValidator),
  },
  returns: v.number(),
  handler: async (ctx, { entries }) => {
    const now = Date.now();
    if (entries.length === 0 || entries.length > MAX_CATALOG_MODELS) {
      throw new Error("Catalog size is outside the sync limit");
    }
    const ids = new Set(entries.map(entry => entry.modelId));
    if (ids.size !== entries.length) throw new Error("Catalog contains duplicate model ids");
    const current = await activeModels(ctx).take(MAX_CATALOG_MODELS + 1);
    if (current.length > MAX_CATALOG_MODELS) throw new Error("Stored catalog exceeds the sync limit");
    const retiring = current.filter(model => !ids.has(model.modelId));
    if (retiring.length > Math.max(20, current.length / 2)) {
      throw new Error("OpenRouter catalog unexpectedly shrank; keeping the previous catalog");
    }
    let written = 0;

    for (const entry of entries) {
      const existing = await ctx.db
        .query("models")
        .withIndex("by_model_id", (q) => q.eq("modelId", entry.modelId))
        .unique();

      if (existing) {
        // Update synced fields, preserve business overrides
        await ctx.db.replace(existing._id, {
          ...entry,
          // Preserve business-layer fields
          isServed: existing.isServed,
          costMarkup: existing.costMarkup,
          sortOrder: existing.sortOrder,
          category: existing.category,
          hidden: existing.hidden,
          // Update timestamps
          syncedAt: now,
          updatedAt: now,
          createdAt: existing.createdAt,
        });
      } else {
        await ctx.db.insert("models", {
          ...entry,
          isServed: false,
          costMarkup: 1.3,
          sortOrder: 1000,
          syncedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      written++;
    }

    for (const model of retiring) {
      await ctx.db.patch(model._id, {retiredAt: now, updatedAt: now});
    }
    return written;
  },
});

/**
 * Toggle the isServed flag for a model (admin operation).
 */
export const setServed = internalMutation({
  args: {
    modelId: v.string(),
    isServed: v.boolean(),
    costMarkup: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const model = await ctx.db
      .query("models")
      .withIndex("by_model_id", (q) => q.eq("modelId", args.modelId))
      .unique();

    if (!model) throw new Error(`Model "${args.modelId}" not found`);

    await ctx.db.patch(model._id, {
      isServed: args.isServed,
      ...(args.costMarkup !== undefined && { costMarkup: args.costMarkup }),
      ...(args.sortOrder !== undefined && { sortOrder: args.sortOrder }),
      ...(args.category !== undefined && { category: args.category }),
      updatedAt: Date.now(),
    });
  },
});
