import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Upsert one curated model-config row by key. Seeding + admin use.
 */
export const upsert = internalMutation({
  args: {
    key: v.string(),
    modelId: v.string(),
    label: v.optional(v.string()),
    blurb: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiModelConfig")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      await ctx.db.patch("aiModelConfig", existing._id, {
        modelId: args.modelId,
        label: args.label,
        blurb: args.blurb,
        sortOrder: args.sortOrder,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("aiModelConfig", { ...args, updatedAt: Date.now() });
    }
    return null;
  },
});

// NOTE: preset slugs MUST be served rows in the `models` catalog or the resolver
// can't map them. These match the current dev catalog's served set; re-point via
// `upsert` whenever the catalog changes.
const DEFAULTS: Array<{ key: string; modelId: string; label?: string; blurb?: string; sortOrder?: number }> = [
  // Credit presets — the three server tiers (served catalog slugs).
  { key: "preset.fast", modelId: "google/gemini-3.1-flash-lite-preview", label: "Fast", blurb: "Quickest & cheapest — screening, bulk work", sortOrder: 0 },
  { key: "preset.balanced", modelId: "anthropic/claude-sonnet-4.6", label: "Balanced", blurb: "Best quality for the price — most work", sortOrder: 1 },
  { key: "preset.intelligent", modelId: "anthropic/claude-opus-4.8", label: "Intelligent", blurb: "Deepest reasoning — hard, long papers", sortOrder: 2 },
  // Per-provider defaults (BYOK native ids; OpenRouter = server custom default).
  { key: "default.openai", modelId: "gpt-4o" },
  { key: "default.anthropic", modelId: "claude-sonnet-4-5" },
  { key: "default.google", modelId: "gemini-2.5-flash" },
  { key: "default.openrouter", modelId: "anthropic/claude-sonnet-4.6" },
];

/**
 * Seed curated defaults. Idempotent — only inserts keys that don't exist yet.
 */
export const seed = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const d of DEFAULTS) {
      const existing = await ctx.db
        .query("aiModelConfig")
        .withIndex("by_key", (q) => q.eq("key", d.key))
        .unique();
      if (!existing) {
        await ctx.db.insert("aiModelConfig", { ...d, updatedAt: Date.now() });
      }
    }
    return null;
  },
});
