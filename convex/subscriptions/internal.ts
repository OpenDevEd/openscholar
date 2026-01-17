import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Plan configurations
const PLAN_CONFIG = {
  free: { creditsPerMonth: 0 },
  pro: { creditsPerMonth: 1000 },
  enterprise: { creditsPerMonth: 10000 },
} as const;

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
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
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
        await ctx.db.patch(byCustomer._id, {
          stripeSubscriptionId: args.stripeSubscriptionId,
          status: args.status,
          currentPeriodStart: args.currentPeriodStart,
          currentPeriodEnd: args.currentPeriodEnd,
          cancelAtPeriodEnd: args.cancelAtPeriodEnd,
          updatedAt: Date.now(),
        });
      }
      return;
    }

    // Determine plan from price ID (you'd map this to your actual Stripe prices)
    const plan = determinePlan(args.priceId);

    await ctx.db.patch(subscription._id, {
      status: args.status,
      plan,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      creditsPerMonth: PLAN_CONFIG[plan].creditsPerMonth,
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
function determinePlan(priceId?: string): "free" | "pro" | "enterprise" {
  if (!priceId) return "free";

  // Map your Stripe price IDs here
  // e.g., price_xxx_pro -> "pro"
  if (priceId.includes("enterprise")) return "enterprise";
  if (priceId.includes("pro")) return "pro";

  return "free";
}
