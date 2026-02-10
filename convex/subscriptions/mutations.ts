import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth, requireOrgOwner } from "../lib/auth";
import { ConvexError } from "convex/values";

/**
 * Link Stripe customer ID to subscription
 */
export const linkStripeCustomer = mutation({
  args: {
    organizationId: v.optional(v.id("organizations")),
    stripeCustomerId: v.string(),
  },
  returns: v.id("subscriptions"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";

    if (args.organizationId) {
      await requireOrgOwner(ctx, args.organizationId);
    }

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .unique();

    if (!subscription) throw new ConvexError({ code: "NOT_FOUND", message: "Subscription not found" });

    await ctx.db.patch(subscription._id, {
      stripeCustomerId: args.stripeCustomerId,
      updatedAt: Date.now(),
    });

    return subscription._id;
  },
});

/**
 * Cleanup duplicate subscriptions - keeps the paid subscription, cancels all others
 * Run this once to fix users with multiple active subscriptions
 */
export const cleanupDuplicateSubscriptions = mutation({
  args: {},
  returns: v.object({
    cleaned: v.number(),
    keptPlan: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id).eq("ownerType", "user"))
      .collect();

    const activeSubs = subscriptions.filter(s => s.status !== "canceled");
    
    console.log(`[cleanupDuplicateSubscriptions] Found ${activeSubs.length} active subscriptions for user ${user._id}`);

    if (activeSubs.length > 1) {
      // Keep the one with a Stripe subscription ID (paid plan)
      const paidSub = activeSubs.find(s => s.stripeSubscriptionId);
      
      if (paidSub) {
        const now = Date.now();
        let cleanedCount = 0;
        
        // Cancel all others
        for (const sub of activeSubs) {
          if (sub._id !== paidSub._id) {
            console.log(`[cleanupDuplicateSubscriptions] Canceling duplicate: ${sub._id} (plan: ${sub.plan})`);
            await ctx.db.patch(sub._id, {
              status: "canceled",
              canceledAt: now,
              updatedAt: now,
            });
            cleanedCount++;
          }
        }
        
        return { cleaned: cleanedCount, keptPlan: paidSub.plan };
      }
    }
    
    return { cleaned: 0 };
  },
});

/**
 * Internal version for CLI - cleanup all duplicate subscriptions for a specific user
 */
export const cleanupDuplicateSubscriptionsInternal = internalMutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.object({
    cleaned: v.number(),
    keptPlan: v.optional(v.string()),
    totalSubscriptions: v.number(),
  }),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.userId).eq("ownerType", "user"))
      .collect();

    const activeSubs = subscriptions.filter(s => s.status !== "canceled");
    
    console.log(`[cleanupDuplicateSubscriptionsInternal] Found ${activeSubs.length} active of ${subscriptions.length} total subscriptions for user ${args.userId}`);

    if (activeSubs.length > 1) {
      // Keep the one with a Stripe subscription ID (paid plan)
      const paidSub = activeSubs.find(s => s.stripeSubscriptionId);
      
      if (paidSub) {
        const now = Date.now();
        let cleanedCount = 0;
        
        // Cancel all others
        for (const sub of activeSubs) {
          if (sub._id !== paidSub._id) {
            console.log(`[cleanupDuplicateSubscriptionsInternal] Canceling duplicate: ${sub._id} (plan: ${sub.plan}, status: ${sub.status})`);
            await ctx.db.patch(sub._id, {
              status: "canceled",
              canceledAt: now,
              updatedAt: now,
            });
            cleanedCount++;
          }
        }
        
        console.log(`[cleanupDuplicateSubscriptionsInternal] Kept subscription ${paidSub._id} with plan: ${paidSub.plan}`);
        return { cleaned: cleanedCount, keptPlan: paidSub.plan, totalSubscriptions: subscriptions.length };
      } else {
        console.log(`[cleanupDuplicateSubscriptionsInternal] No paid subscription found, keeping most recent`);
        // No paid subscription, keep the most recent one
        const now = Date.now();
        let cleanedCount = 0;
        const [keep, ...cancel] = activeSubs;
        
        for (const sub of cancel) {
          console.log(`[cleanupDuplicateSubscriptionsInternal] Canceling duplicate: ${sub._id} (plan: ${sub.plan})`);
          await ctx.db.patch(sub._id, {
            status: "canceled",
            canceledAt: now,
            updatedAt: now,
          });
          cleanedCount++;
        }
        
        return { cleaned: cleanedCount, keptPlan: keep?.plan, totalSubscriptions: subscriptions.length };
      }
    }
    
    return { cleaned: 0, totalSubscriptions: subscriptions.length };
  },
});
