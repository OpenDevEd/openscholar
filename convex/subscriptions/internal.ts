import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { PLAN_CONFIG, GO_PRICE_ID, PRO_PRICE_ID } from "../lib/constants";

/**
 * Get subscription by owner (user or organization)
 */
export const getSubscriptionByOwner = internalQuery({
  args: {
    ownerId: v.string(),
    ownerType: v.union(v.literal("user"), v.literal("organization")),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", args.ownerId).eq("ownerType", args.ownerType)
      )
      .unique();
  },
});

/**
 * Handle checkout completion from Stripe
 */
export const handleCheckoutComplete = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    // Get owner info from metadata
    const { userId, organizationId } = args.metadata as {
      userId?: string;
      organizationId?: string;
    };

    if (!userId && !organizationId) {
      console.warn("No user or org ID in checkout metadata");
      return;
    }

    const ownerId = organizationId ?? userId!;
    const ownerType = organizationId ? "organization" : "user";

    // Find or create subscription record
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stripeSubscriptionId: args.stripeSubscriptionId,
        stripeCustomerId: args.stripeCustomerId,
        status: "active",
        updatedAt: now,
      });
    }
  },
});

/**
 * Sync subscription from Stripe webhook
 */
export const syncSubscription = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    stripeCustomerId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("past_due"),
      v.literal("canceled"),
      v.literal("trialing")
    ),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
    priceId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    metadata: v.optional(v.any()), // New arg
  },
  handler: async (ctx, args) => {
    let subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
      )
      .unique();

    if (!subscription) {
      // Try to find by customer ID
      const byCustomer = await ctx.db
        .query("subscriptions")
        .withIndex("by_stripe_customer", (q) =>
          q.eq("stripeCustomerId", args.stripeCustomerId)
        )
        .first();
      
      if (byCustomer) {
        subscription = byCustomer;
      } else if (args.metadata?.userId) {
         // Fallback: Find by user ID from metadata (Race condition fix)
         const byUser = await ctx.db
          .query("subscriptions")
          .withIndex("by_owner", (q) => 
            q.eq("ownerId", args.metadata.userId).eq("ownerType", "user")
          )
          .unique();
          
          if (byUser) subscription = byUser;
      }

      if (subscription) {
        // We found it (either by customer or user ID), so link it now
        await ctx.db.patch(subscription._id, {
          stripeSubscriptionId: args.stripeSubscriptionId,
          stripeCustomerId: args.stripeCustomerId,
          status: args.status, // We will update status below anyway, but safe here
        });
      } else {
         // If we STILL can't find it, then it's a real failure (or user doesn't exist)
        throw new Error("Subscription not found for sync. Retrying...");
      }
    }

    // Determine plan from price ID
    const plan = determinePlan(args.priceId);
    
    // Calculate credits based on seats if enterprise, otherwise flat rate or per seat depending on logic
    // Assuming pro/enterprise are per seat for simplicity or just enterprise
    const quantity = args.quantity ?? 1;
    const baseCredits = PLAN_CONFIG[plan].creditsPerMonth;
    // If you want credits to multiply by seats:
    const totalCredits = baseCredits * quantity;

    await ctx.db.patch(subscription._id, {
      status: args.status,
      plan,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      seats: quantity,
      creditsPerMonth: totalCredits,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Handle subscription cancellation
 */
export const handleSubscriptionCanceled = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
      )
      .unique();

    if (!subscription) return;

    await ctx.db.patch(subscription._id, {
      status: "canceled",
      plan: "free",
      creditsPerMonth: 0,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Handle payment failure
 */
export const handlePaymentFailed = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
      )
      .unique();

    if (!subscription) return;

    await ctx.db.patch(subscription._id, {
      status: "past_due",
      updatedAt: Date.now(),
    });
  },
});

// Helper to determine plan from Stripe price ID
function determinePlan(priceId?: string): "free" | "go" | "pro" | "enterprise" {
  if (!priceId) return "free";

  if (priceId === GO_PRICE_ID) return "go";
  if (priceId === PRO_PRICE_ID) return "pro";
  
  // Fallback for testing or if alternate IDs are used (careful with partial matches in prod)
  if (priceId.includes("enterprise")) return "enterprise";
  if (priceId.includes("pro")) return "pro";

  return "free";
}
