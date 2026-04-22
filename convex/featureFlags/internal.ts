import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { resolveEffectivePlan } from "../../lib/billing/entitlements";
import { getPlanTier } from "../lib/constants";
import { selectCanonicalSubscription } from "../subscriptions/lib/selectCanonicalSubscription";

/**
 * Upsert a feature flag. Used for seeding and admin operations.
 */
export const upsert = internalMutation({
  args: {
    key: v.string(),
    enabled: v.boolean(),
    minimumTier: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      await ctx.db.patch("featureFlags", existing._id, {
        enabled: args.enabled,
        minimumTier: args.minimumTier,
        description: args.description,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("featureFlags", {
        ...args,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Seed all feature flags with defaults. Idempotent — only inserts flags
 * that don't already exist.
 */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const defaults: Array<{ key: string; enabled: boolean; minimumTier: number; description: string }> = [
      { key: "extraction.enabled", enabled: true, minimumTier: 0, description: "Master switch for the extraction feature" },
      { key: "extraction.pdf", enabled: true, minimumTier: 0, description: "PDF processing capability gate (per-job toggle visibility)" },
      { key: "extraction.chat", enabled: false, minimumTier: 0, description: "Chat mode for job creation (paper Q&A)" },
      { key: "extraction.reportBuilder", enabled: false, minimumTier: 20, description: "Report builder for extraction jobs" },
      { key: "extraction.start", enabled: true, minimumTier: 20, description: "Start new extraction jobs (Pro+)" },
      { key: "extraction.templates", enabled: true, minimumTier: 20, description: "Workflow template management (Pro+)" },
      { key: "credits.enabled", enabled: true, minimumTier: 0, description: "Credit system master switch" },
      { key: "credits.topups", enabled: true, minimumTier: 0, description: "On-demand credit top-up purchases" },
      { key: "subscriptions.enabled", enabled: true, minimumTier: 0, description: "Subscription/billing system master switch" },
      { key: "subscriptions.plan.go", enabled: true, minimumTier: 0, description: "Show the Go plan on the pricing page" },
      { key: "subscriptions.plan.pro", enabled: true, minimumTier: 0, description: "Show the Pro plan on the pricing page" },
      { key: "subscriptions.plan.enterprise", enabled: true, minimumTier: 0, description: "Show the Enterprise plan on the pricing page" },
    ];

    for (const flag of defaults) {
      const existing = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", flag.key))
        .unique();

      if (!existing) {
        await ctx.db.insert("featureFlags", {
          ...flag,
          updatedAt: Date.now(),
        });
      }
    }
  },
});

/**
 * Internal query to check a feature flag. Used by actions via ctx.runQuery
 * since actions don't have ctx.db access.
 */
export const checkFlag = internalQuery({
  args: {
    key: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (!flag || !flag.enabled) {
      return { allowed: false, reason: "disabled" as const };
    }

    if (flag.minimumTier > 0) {
      if (!args.userId) {
        return { allowed: false, reason: "unauthenticated" as const };
      }

      const subscriptions = await ctx.db
        .query("subscriptions")
        .withIndex("by_user", (q) => q.eq("userId", args.userId!))
        .order("desc")
        .collect();

      const canonical = selectCanonicalSubscription(subscriptions);
      const plan = resolveEffectivePlan(canonical);
      const tier = getPlanTier(plan);

      if (tier < flag.minimumTier) {
        return { allowed: false, reason: "insufficient_tier" as const };
      }
    }

    return { allowed: true, reason: "ok" as const };
  },
});
