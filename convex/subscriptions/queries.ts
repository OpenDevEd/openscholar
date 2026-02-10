import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";
import { getPlanTier } from "../lib/constants";
import { subscriptionValidator } from "../lib/validators";
import { selectCanonicalSubscription } from "./lib/selectCanonicalSubscription";

/**
 * Get current user's subscription
 */
export const getMy = query({
  args: {},
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", user._id).eq("ownerType", "user")
      )
      .order("desc")
      .collect();

    return selectCanonicalSubscription(subscriptions);
  },
});

/**
 * Get organization's subscription
 */
export const getOrg = query({
  args: { organizationId: v.id("organizations") },
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx, { organizationId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("organizationId", organizationId)
      )
      .unique();
    if (!membership) return null;

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", organizationId).eq("ownerType", "organization")
      )
      .order("desc")
      .collect();

    return selectCanonicalSubscription(subscriptions);
  },
});

/**
 * Get subscription tier for user/org
 * Returns tier number: 0 (free), 10 (go), 20 (pro), 30 (enterprise)
 */
export const getTier = query({
  args: { organizationId: v.optional(v.id("organizations")) },
  returns: v.number(),
  handler: async (ctx, { organizationId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return 0;

    const ownerId = organizationId ?? user._id;
    const ownerType = organizationId ? "organization" : "user";

    if (organizationId) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user_org", (q) =>
          q.eq("userId", user._id).eq("organizationId", organizationId)
        )
        .unique();
      if (!membership) return 0;
    }

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .order("desc")
      .collect();

    const subscription = selectCanonicalSubscription(subscriptions);

    if (!subscription) return 0;

    return getPlanTier(subscription.plan);
  },
});
