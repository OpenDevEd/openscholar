import { internalMutation, internalQuery, MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import {
  PLAN_CONFIG,
  getPlanFromPriceId,
} from "../lib/constants";
import { Doc } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { subscriptionValidator } from "../lib/validators";

type StripeMetadata = {
  userId?: string;
  organizationId?: string;
};

/**
 * Helper to find a subscription by Stripe ID, Customer ID, or Metadata (User/Org ID)
 */
async function getSubscriptionByStripeOrMetadata(
  ctx: MutationCtx,
  args: {
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
    metadata?: StripeMetadata;
  }
): Promise<Doc<"subscriptions"> | null> {
  // 1. Try by Stripe Subscription ID
  if (args.stripeSubscriptionId) {
    const bySub = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId!)
      )
      .order("desc")
      .collect();
    const active = bySub.find((sub) => sub.status !== "canceled") ?? bySub[0];
    if (active) return active;
  }

  // 2. Try by Stripe Customer ID
  if (args.stripeCustomerId) {
    const byCustomer = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_customer", (q) =>
        q.eq("stripeCustomerId", args.stripeCustomerId!)
      )
      .order("desc")
      .collect();
    const active = byCustomer.find((sub) => sub.status !== "canceled") ?? byCustomer[0];
    if (active) return active;
  }

  // 3. Try by Metadata (User ID or Org ID) - get active subscription
  if (args.metadata?.userId) {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", args.metadata!.userId!).eq("ownerType", "user")
      )
      .order("desc")
      .collect();
    return subs.find(s => s.status !== "canceled") ?? subs[0] ?? null;
  }
  
  if (args.metadata?.organizationId) {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", args.metadata!.organizationId!).eq("ownerType", "organization")
      )
      .order("desc")
      .collect();
    return subs.find(s => s.status !== "canceled") ?? subs[0] ?? null;
  }

  return null;
}

/**
 * Get subscription by owner (user or organization)
 */
export const getSubscriptionByOwner = internalQuery({
  args: {
    ownerId: v.string(),
    ownerType: v.union(v.literal("user"), v.literal("organization")),
  },
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", args.ownerId).eq("ownerType", args.ownerType)
      )
      .order("desc")
      .collect();

    // Return active subscription, or most recent if none active
    return subscriptions.find(s => s.status !== "canceled") ?? subscriptions[0] ?? null;
  },
});

/**
 * Handle checkout completion from Stripe
 */
export const handleCheckoutComplete = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    metadata: v.record(v.string(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const metadata = args.metadata as StripeMetadata;
    const { userId, organizationId } = metadata;

    if (!userId && !organizationId) {
      console.warn("No user or org ID in checkout metadata");
      return;
    }

    const ownerId = organizationId ?? userId!;
    const ownerType = organizationId ? "organization" : "user";

    // Find the active subscription record (there may be multiple due to soft-delete)
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .order("desc")
      .collect();

    // Get the most recent non-canceled subscription (should be the "free" one)
    const existing = subscriptions.find(s => s.status !== "canceled");

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stripeSubscriptionId: args.stripeSubscriptionId,
        stripeCustomerId: args.stripeCustomerId,
        status: "active",
        updatedAt: now,
      });
    } else {
      // If it doesn't exist, we should probably create it or log error?
      // Usually getOrCreateUser/Org should have created a free sub.
      console.error("Subscription record not found for owner during checkout complete", { ownerId, ownerType });
    }

    return null;
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
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subscription = await getSubscriptionByStripeOrMetadata(ctx, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeCustomerId: args.stripeCustomerId,
      metadata: args.metadata as StripeMetadata,
    });

    if (!subscription) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Subscription not found for sync" });
    }

    // Link it now if it wasn"t linked (e.g. found by metadata)
    if (subscription.stripeSubscriptionId !== args.stripeSubscriptionId) {
         await ctx.db.patch(subscription._id, {
          stripeSubscriptionId: args.stripeSubscriptionId,
          stripeCustomerId: args.stripeCustomerId,
        });
    }

    // Determine plan from price ID
    const plan = getPlanFromPriceId(args.priceId);
    
    // Calculate credits based on seats if enterprise, otherwise flat rate or per seat depending on logic
    const quantity = args.quantity ?? 1;
    const baseCredits = PLAN_CONFIG[plan].creditsPerMonth;
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

    return null;
  },
});

/**
 * Handle subscription cancellation
 */
export const handleSubscriptionCanceled = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
      )
      .order("desc")
      .collect();
    const subscription = subscriptions.find((sub) => sub.status !== "canceled") ?? subscriptions[0] ?? null;

    if (!subscription) return null;

    const now = Date.now();

    // 1. Mark current subscription as canceled (preserve history)
    await ctx.db.patch(subscription._id, {
      status: "canceled",
      canceledAt: now,
      updatedAt: now,
    });

    // 2. Create new "free" subscription for the owner
    await ctx.db.insert("subscriptions", {
      ownerId: subscription.ownerId,
      ownerType: subscription.ownerType,
      plan: "free",
      status: "active",
      creditsPerMonth: 0,
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });

    return null;
  },
});

/**
 * Handle payment failure
 */
export const handlePaymentFailed = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
      )
      .order("desc")
      .collect();
    const subscription = subscriptions.find((sub) => sub.status !== "canceled") ?? subscriptions[0] ?? null;

    if (!subscription) return null;

    await ctx.db.patch(subscription._id, {
      status: "past_due",
      updatedAt: Date.now(),
    });

    return null;
  },
});

