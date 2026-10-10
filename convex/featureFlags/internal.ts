import { internalMutation } from "../lib/functions";
import type { QueryCtx } from "../_generated/server";
import { MAX_FEATURE_FLAGS } from "../lib/queryBounds";
import { v } from "convex/values";
import { FLAG_REGISTRY, type FlagDefault } from "../../lib/feature-flags/registry";

/** Refuses another flag once the table holds MAX_FEATURE_FLAGS, so every read of it is one small query. */
export async function assertFlagRoom(ctx: Pick<QueryCtx, "db">) {
  if ((await ctx.db.query("featureFlags").take(MAX_FEATURE_FLAGS)).length >= MAX_FEATURE_FLAGS) {
    throw new Error(`There are already ${MAX_FEATURE_FLAGS} feature flags; remove a retired one first.`);
  }
}

/**
 * Upsert a feature flag. Used for seeding and admin operations.
 */
export const upsert = internalMutation({
  args: {
    key: v.string(),
    enabled: v.boolean(),
    planFeature: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      await ctx.db.patch("featureFlags", existing._id, {
        enabled: args.enabled,
        planFeature: args.planFeature,
        description: args.description,
        updatedAt: Date.now(),
      });
    } else {
      await assertFlagRoom(ctx);
      await ctx.db.insert("featureFlags", { ...args, updatedAt: Date.now() });
    }
    return null;
  },
});

/**
 * Inserts every flag in the registry that doesn't exist yet, with its
 * default, and brings an existing one's plan feature in line. Idempotent.
 */
export const seed = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const [key, flag] of Object.entries<FlagDefault>(FLAG_REGISTRY)) {
      const existing = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (!existing) {
        await assertFlagRoom(ctx);
        await ctx.db.insert("featureFlags", {
          key,
          enabled: flag.enabled,
          ...(flag.planFeature ? { planFeature: flag.planFeature } : {}),
          description: flag.description,
          updatedAt: Date.now(),
        });
        // The registry says which plan feature a flag needs: a row seeded before one was dropped (extraction's, 2026-10-10) loses it here.
      } else if (existing.planFeature !== flag.planFeature) {
        await ctx.db.patch("featureFlags", existing._id, { planFeature: flag.planFeature, updatedAt: Date.now() });
      }
    }
    return null;
  },
});
