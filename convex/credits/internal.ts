import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Handle credit purchase from Stripe webhook
 */
export const handleCreditPurchase = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    amountPaid: v.number(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    // Find subscription by Stripe customer ID to get owner
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_customer", (q) =>
        q.eq("stripeCustomerId", args.stripeCustomerId)
      )
      .first();

    if (!subscription) {
      console.warn("No subscription found for Stripe customer:", args.stripeCustomerId);
      return;
    }

    // Calculate credits based on amount paid (e.g., $1 = 100 credits)
    const creditsToAdd = Math.floor(args.amountPaid / 1); // cents to credits

    // Find credits record
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", subscription.ownerId).eq("ownerType", subscription.ownerType)
      )
      .unique();

    if (!credits) {
      console.warn("No credits record found for owner:", subscription.ownerId);
      return;
    }

    const now = Date.now();
    const newBalance = credits.balance + creditsToAdd;

    // Update balance
    await ctx.db.patch(credits._id, {
      balance: newBalance,
      lastUpdatedAt: now,
    });

    // Record transaction
    await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      type: "purchase",
      amount: creditsToAdd,
      balanceAfter: newBalance,
      description: `Purchased ${creditsToAdd} credits`,
      metadata: args.metadata,
      createdAt: now,
    });
  },
});

/**
 * Grant monthly credits for subscription
 */
export const grantMonthlyCredits = internalMutation({
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

    if (!subscription || !subscription.creditsPerMonth) return;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", subscription.ownerId).eq("ownerType", subscription.ownerType)
      )
      .unique();

    if (!credits) return;

    const now = Date.now();
    const newBalance = credits.balance + subscription.creditsPerMonth;

    await ctx.db.patch(credits._id, {
      balance: newBalance,
      lastUpdatedAt: now,
    });

    await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      type: "grant",
      amount: subscription.creditsPerMonth,
      balanceAfter: newBalance,
      description: `Monthly credit grant (${subscription.plan} plan)`,
      createdAt: now,
    });
  },
});

/**
 * Deduct credits for usage
 */
export const deductCredits = internalMutation({
  args: {
    userId: v.id("users"),
    organizationId: v.optional(v.id("organizations")),
    amount: v.number(),
    description: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const ownerId = args.organizationId ?? args.userId;
    const ownerType = args.organizationId ? "organization" : "user";

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .unique();

    if (!credits) throw new Error("Credits record not found");
    if (credits.balance < args.amount) throw new Error("Insufficient credits");

    const now = Date.now();
    const newBalance = credits.balance - args.amount;

    await ctx.db.patch(credits._id, {
      balance: newBalance,
      lifetimeUsed: credits.lifetimeUsed + args.amount,
      lastUpdatedAt: now,
    });

    await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      userId: args.userId,
      type: "usage",
      amount: -args.amount,
      balanceAfter: newBalance,
      description: args.description,
      metadata: args.metadata,
      createdAt: now,
    });

    return newBalance;
  },
});

/**
 * Add credits (admin grant or refund)
 */
export const addCredits = internalMutation({
  args: {
    ownerId: v.string(),
    ownerType: v.union(v.literal("user"), v.literal("organization")),
    amount: v.number(),
    type: v.union(v.literal("grant"), v.literal("refund")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", args.ownerId).eq("ownerType", args.ownerType)
      )
      .unique();

    if (!credits) throw new Error("Credits record not found");

    const now = Date.now();
    const newBalance = credits.balance + args.amount;

    await ctx.db.patch(credits._id, {
      balance: newBalance,
      lastUpdatedAt: now,
    });

    await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      type: args.type,
      amount: args.amount,
      balanceAfter: newBalance,
      description: args.description,
      createdAt: now,
    });

    return newBalance;
  },
});
