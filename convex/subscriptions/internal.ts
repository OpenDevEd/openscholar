import { internalMutation, internalQuery, MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import {
  PLAN_CONFIG,
  getPlanFromPriceId,
} from "../lib/constants";
import { Doc } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { subscriptionValidator } from "../lib/validators";
import { selectCanonicalSubscription } from "./lib/selectCanonicalSubscription";

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
    const canonical = selectCanonicalSubscription(bySub);
    if (canonical) return canonical;
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
    const canonical = selectCanonicalSubscription(byCustomer);
    if (canonical) return canonical;
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
    return selectCanonicalSubscription(subs);
  }
  
  if (args.metadata?.organizationId) {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", args.metadata!.organizationId!).eq("ownerType", "organization")
      )
      .order("desc")
      .collect();
    return selectCanonicalSubscription(subs);
  }

  return null;
}

/**
 * Get subscription by owner (user or organization)
 * Uses same logic as getMy/getOrg queries - prefers paid subscriptions
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
    return selectCanonicalSubscription(subscriptions);
  },
});

/**
 * Sync subscription from Stripe webhook
 * This is the single source of truth for subscription state from Stripe
 * Idempotent - safe to call multiple times with same data
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
    // 1. Find subscription by Stripe ID → Customer ID → Metadata
    let subscription = await getSubscriptionByStripeOrMetadata(ctx, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeCustomerId: args.stripeCustomerId,
      metadata: args.metadata as StripeMetadata,
    });

    // 2. Extract owner info
    const metadata = args.metadata as StripeMetadata;
    const ownerId = metadata?.organizationId ?? metadata?.userId ?? subscription?.ownerId;
    const ownerType = metadata?.organizationId ? "organization" : "user";

    if (!ownerId) {
      console.error("[syncSubscription] No owner ID found in metadata or existing subscription");
      throw new ConvexError({ 
        code: "INVALID_DATA", 
        message: "Cannot sync subscription: no owner identifier" 
      });
    }

    // 3. Determine plan from price ID
    const plan = getPlanFromPriceId(args.priceId);
    const quantity = args.quantity ?? 1;
    const baseCredits = PLAN_CONFIG[plan].creditsPerMonth;
    const totalCredits = baseCredits * quantity;

    const now = Date.now();

    // 4. Create if not exists (rare case - usually created during user/org creation)
    if (!subscription) {
      console.log(`[syncSubscription] Creating new subscription for ${ownerType} ${ownerId} - plan:${plan}, credits:${totalCredits}`);
      await ctx.db.insert("subscriptions", {
        ownerId,
        ownerType,
        stripeSubscriptionId: args.stripeSubscriptionId,
        stripeCustomerId: args.stripeCustomerId,
        plan,
        status: args.status,
        currentPeriodStart: args.currentPeriodStart,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
        seats: quantity,
        creditsPerMonth: totalCredits,
        createdAt: now,
        updatedAt: now,
      });
      return null;
    }

    // 5. Update existing subscription with ALL fields in one atomic operation
    console.log(`[syncSubscription] Updating ${subscription._id} → plan:${plan}, credits:${totalCredits}, status:${args.status}`);
    await ctx.db.patch(subscription._id, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeCustomerId: args.stripeCustomerId,
      plan, // KEY FIX: Always update plan from Stripe data
      status: args.status,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      seats: quantity,
      creditsPerMonth: totalCredits,
      updatedAt: now,
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
    const subscription = selectCanonicalSubscription(subscriptions);

    if (!subscription) {
      console.log(`[handleSubscriptionCanceled] No subscription found for Stripe ID: ${args.stripeSubscriptionId}`);
      return null;
    }

    const now = Date.now();

    console.log(`[handleSubscriptionCanceled] Canceling subscription ${subscription._id} (plan: ${subscription.plan})`);

    // 1. Mark current subscription as canceled and clear Stripe IDs
    // Clearing stripeSubscriptionId prevents queries from returning canceled paid subs
    await ctx.db.patch(subscription._id, {
      status: "canceled",
      canceledAt: now,
      updatedAt: now,
      stripeSubscriptionId: undefined, // Clear so queries don't prefer canceled paid sub
      stripeCustomerId: undefined, // Clear for consistency
    });

    // 2. Create new "free" subscription for the owner
    console.log(`[handleSubscriptionCanceled] Creating free subscription for ${subscription.ownerType} ${subscription.ownerId}`);
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
    const subscription = selectCanonicalSubscription(subscriptions);

    if (!subscription) return null;

    await ctx.db.patch(subscription._id, {
      status: "past_due",
      updatedAt: Date.now(),
    });

    return null;
  },
});
