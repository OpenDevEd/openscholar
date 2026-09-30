import { internalMutation } from "../lib/functions";
import { v } from "convex/values";
import { FLAG_REGISTRY } from "../../lib/feature-flags/registry";

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
      await ctx.db.insert("featureFlags", { ...args, updatedAt: Date.now() });
    }
    return null;
  },
});

/**
 * Inserts every flag in the registry that doesn't exist yet, with its
 * default. Idempotent.
 */
export const seed = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const [key, flag] of Object.entries(FLAG_REGISTRY)) {
      const existing = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (!existing) {
        await ctx.db.insert("featureFlags", {
          key,
          enabled: flag.enabled,
          ...("planFeature" in flag ? { planFeature: flag.planFeature } : {}),
          description: flag.description,
          updatedAt: Date.now(),
        });
      }
    }
    return null;
  },
});

/** Flags that only showed plans on the pricing page; Autumn's catalog does that now. */
const RETIRED_FLAGS = ["subscriptions.plan.go", "subscriptions.plan.pro"];

/**
 * One-off: moves flags from plan tiers to plan features in Autumn. A flag
 * that had a minimum tier takes the plan feature its registry entry names;
 * every flag loses `minimumTier`; flags Autumn replaces are removed.
 * Idempotent. Run once per deployment after the release that adds it.
 */
export const adoptPlanFeatures = internalMutation({
  args: {},
  returns: v.object({ updated: v.number(), removed: v.number() }),
  handler: async (ctx) => {
    let updated = 0;
    let removed = 0;
    for (const flag of await ctx.db.query("featureFlags").collect()) {
      if (RETIRED_FLAGS.includes(flag.key)) {
        await ctx.db.delete("featureFlags", flag._id);
        removed += 1;
        continue;
      }
      if (flag.minimumTier === undefined) continue;
      const registered = FLAG_REGISTRY[flag.key as keyof typeof FLAG_REGISTRY];
      const planFeature =
        flag.minimumTier > 0 && registered && "planFeature" in registered
          ? registered.planFeature
          : flag.planFeature;
      await ctx.db.patch("featureFlags", flag._id, {
        minimumTier: undefined,
        planFeature,
        updatedAt: Date.now(),
      });
      updated += 1;
    }
    return { updated, removed };
  },
});
