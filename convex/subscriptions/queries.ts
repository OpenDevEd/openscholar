import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth, requireOrgMember } from "../lib/auth";
import { getPlanTier } from "../lib/constants";
import { subscriptionValidator } from "../lib/validators";

/**
 * Get current user's subscription
 */
export const getMy = query({
  args: {},
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx) => {

    // Determine user identity without throwing "Unauthenticated" immediately
    // to avoid race conditions during first login sync
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();

    if (!user) return null;

    // Get all subscriptions ordered by creation time DESC
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", user._id).eq("ownerType", "user")
      )
      .order("desc")
      .collect();

    // Filter to active subscriptions only
    const activeSubscriptions = subscriptions.filter(s => s.status !== "canceled");
    
    // Prefer active subscriptions with stripeSubscriptionId (real paid subscriptions)
    const paidSubscription = activeSubscriptions.find(s => s.stripeSubscriptionId);
    if (paidSubscription) {
      console.log("[getMy] Returning paid subscription:", { 
        id: paidSubscription._id,
        plan: paidSubscription.plan, 
        status: paidSubscription.status,
        stripeSubId: paidSubscription.stripeSubscriptionId,
        totalSubs: subscriptions.length 
      });
      return paidSubscription;
    }

    // Otherwise, return most recent active subscription (free plan stub)
    const result = activeSubscriptions[0] ?? subscriptions[0] ?? null;
    console.log("[getMy] Returning:", { 
      id: result?._id,
      plan: result?.plan, 
      status: result?.status,
      stripeSubId: result?.stripeSubscriptionId,
      totalSubs: subscriptions.length 
    });
    
    return result;
  },
});

/**
 * Get organization's subscription
 */
export const getOrg = query({
  args: { organizationId: v.id("organizations") },
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx, { organizationId }) => {
    await requireOrgMember(ctx, organizationId);

    // Get all subscriptions ordered by creation time DESC
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", organizationId).eq("ownerType", "organization")
      )
      .order("desc")
      .collect();

    // Filter to active subscriptions only
    const activeSubscriptions = subscriptions.filter(s => s.status !== "canceled");
    
    // Prefer active subscriptions with stripeSubscriptionId (real paid subscriptions)
    const paidSubscription = activeSubscriptions.find(s => s.stripeSubscriptionId);
    if (paidSubscription) {
      console.log("[getOrg] Returning paid subscription:", { 
        id: paidSubscription._id,
        plan: paidSubscription.plan, 
        status: paidSubscription.status,
        stripeSubId: paidSubscription.stripeSubscriptionId,
        totalSubs: subscriptions.length 
      });
      return paidSubscription;
    }

    // Otherwise, return most recent active subscription (free plan stub)
    const result = activeSubscriptions[0] ?? subscriptions[0] ?? null;
    console.log("[getOrg] Returning:", { 
      id: result?._id,
      plan: result?.plan, 
      status: result?.status,
      stripeSubId: result?.stripeSubscriptionId,
      totalSubs: subscriptions.length 
    });
    
    return result;
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
    const user = await requireAuth(ctx);

    const ownerId = organizationId ?? user._id;
    const ownerType = organizationId ? "organization" : "user";

    if (organizationId) {
      await requireOrgMember(ctx, organizationId);
    }

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .order("desc")
      .collect();

    const subscription = subscriptions.find((sub) => sub.status !== "canceled") ?? subscriptions[0] ?? null;

    if (!subscription) return 0;

    return getPlanTier(subscription.plan);
  },
});
