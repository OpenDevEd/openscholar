import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { FREE_CREDIT_CAP } from "../lib/constants";
import { ConvexError } from "convex/values";
import { createError } from "../lib/errors";

/**
 * Get credit balance for a user by ID (for background jobs)
 */
export const getBalanceByUserId = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      free: v.number(),
      paid: v.number(),
      total: v.number(),
      lifetimeUsed: v.number(),
    })
  ),
  handler: async (ctx, { userId }) => {
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", userId).eq("ownerType", "user")
      )
      .unique();

    if (!credits) return null;

    return {
      free: credits.freeBalance,
      paid: credits.paidBalance,
      total: credits.freeBalance + credits.paidBalance,
      lifetimeUsed: credits.lifetimeUsed,
    };
  },
});


/**
 * Handle credit purchase from Stripe webhook
 * Purchased credits go to paidBalance (no cap)
 */
export const handleCreditPurchase = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    amountPaid: v.number(),
    metadata: v.record(v.string(), v.string()),
    stripeInvoiceId: v.optional(v.string()), // e.g. Payment Intent ID or Invoice ID
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Idempotency check
    if (args.stripeInvoiceId) {
       const existing = await ctx.db
        .query("creditTransactions")
        .withIndex("by_stripe_invoice", (q) =>
          q.eq("stripeInvoiceId", args.stripeInvoiceId)
        )
        .unique();
      
      if (existing) {
        console.log("Duplicate purchase processed, skipping:", args.stripeInvoiceId);
        return;
      }
    }

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
      console.error(`[Credits] Critical: No credits record found for owner ${subscription.ownerId} (Type: ${subscription.ownerType})`);
      return;
    }

    const now = Date.now();
    const newPaidBalance = credits.paidBalance + creditsToAdd;

    // Update paid balance
    await ctx.db.patch(credits._id, {
      paidBalance: newPaidBalance,
      lastUpdatedAt: now,
    });

    // Record transaction
    await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      type: "purchase",
      creditType: "paid",
      amount: creditsToAdd,
      balanceAfter: newPaidBalance,
      description: `Purchased ${creditsToAdd} credits`,
      metadata: args.metadata,
      stripeInvoiceId: args.stripeInvoiceId,
      createdAt: now,
    });
  },
});

  /**
   * Grant monthly credits for subscription
   * Free credits are capped at FREE_CREDIT_CAP (10k)
   * Uses "add up to cap" logic: if user has 8k and plan grants 1k, they get 9k total
   */
  export const grantMonthlyCredits = internalMutation({
    args: {
      stripeSubscriptionId: v.optional(v.string()),
      stripeCustomerId: v.optional(v.string()),
      stripeInvoiceId: v.optional(v.string()),
      amountPaid: v.optional(v.number()),
    },

  returns: v.null(),
  handler: async (ctx, args) => {
    // Idempotency check
    if (args.stripeInvoiceId) {
      const existing = await ctx.db
        .query("creditTransactions")
        .withIndex("by_stripe_invoice", (q) =>
          q.eq("stripeInvoiceId", args.stripeInvoiceId)
        )
        .unique();
      
      if (existing) {
        console.log("Duplicate invoice processed, skipping credits:", args.stripeInvoiceId);
        return;
      }
    }

    let subscription = null;

    if (args.stripeSubscriptionId) {
      const subs = await ctx.db
        .query("subscriptions")
        .withIndex("by_stripe_sub", (q) =>
          q.eq("stripeSubscriptionId", args.stripeSubscriptionId!)
        )
        .order("desc")
        .collect();
      subscription = subs.find((sub) => sub.status !== "canceled") ?? subs[0] ?? null;
    }

    if (!subscription && args.stripeCustomerId) {
      const subs = await ctx.db
        .query("subscriptions")
        .withIndex("by_stripe_customer", (q) =>
          q.eq("stripeCustomerId", args.stripeCustomerId!)
        )
        .order("desc")
        .collect();
      subscription = subs.find((sub) => sub.status !== "canceled") ?? subs[0] ?? null;
    }

    if (!subscription) {
      const target = args.stripeSubscriptionId ?? args.stripeCustomerId ?? "unknown";
      console.warn(`[Credits] Subscription not found for Stripe reference: ${target}. Will be granted on next invoice.paid.`);
      return null;
    }

    // If plan is still "free" but we have no creditsPerMonth configured,
    // the subscription.created event hasn't been processed yet.
    // Since invoice.paid is the sole credit trigger now, we can safely skip.
    if (subscription.plan === "free" && !subscription.creditsPerMonth) {
      console.warn(`[Credits] Subscription ${subscription._id} still on free plan. Skipping grant.`);
      return null;
    }

    if (!subscription.creditsPerMonth) {
      console.log(`[Credits] Subscription ${subscription._id} has 0 credits/month configured. Plan: ${subscription.plan}`);
      return;
    }

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", subscription.ownerId).eq("ownerType", subscription.ownerType)
      )
      .unique();

    if (!credits) {
      console.error(`[Credits] Critical: No credits record found for owner ${subscription.ownerId} (Type: ${subscription.ownerType})`);
      return;
    }

    const now = Date.now();
    const currentFree = credits.freeBalance;
    const creditsToGrant = subscription.creditsPerMonth;
    
    // Add up to cap logic: add credits but don't exceed the cap
    const newFreeBalance = Math.min(currentFree + creditsToGrant, FREE_CREDIT_CAP);
    const actualGranted = newFreeBalance - currentFree;

    // Only update if we actually granted credits
    if (actualGranted > 0) {
      console.log(`[Credits] Granting ${actualGranted} credits to ${credits.ownerId} (Plan: ${subscription.plan})`);
      await ctx.db.patch(credits._id, {
        freeBalance: newFreeBalance,
        lastUpdatedAt: now,
      });

      await ctx.db.insert("creditTransactions", {
        creditsId: credits._id,
        type: "grant",
        creditType: "free",
        amount: actualGranted,
        balanceAfter: newFreeBalance,
        description: `Monthly credit grant (${subscription.plan} plan) - ${actualGranted}/${creditsToGrant} credits granted`,
        stripeInvoiceId: args.stripeInvoiceId,
        createdAt: now,
      });
    } else {
      console.log(`[Credits] Free balance already at cap (${FREE_CREDIT_CAP}), skipping grant. Current: ${currentFree}`);
    }
  },
});

/**
 * Deduct credits for usage
 * Consumes free credits first, then paid credits
 */
export const deductCredits = internalMutation({
  args: {
    userId: v.id("users"),
    organizationId: v.optional(v.id("organizations")),
    amount: v.number(),
    description: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const ownerId = args.organizationId ?? args.userId;
    const ownerType = args.organizationId ? "organization" : "user";

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .unique();

    if (!credits) throw new ConvexError({ code: "NOT_FOUND", message: "Credits record not found" });
    
    const totalAvailable = credits.freeBalance + credits.paidBalance;
    if (totalAvailable < args.amount) {
      throw new ConvexError({ 
        code: "INSUFFICIENT_CREDITS", 
        message: `Insufficient credits: need ${args.amount}, have ${totalAvailable}` 
      });
    }

    const now = Date.now();
    let amountToDeduct = args.amount;
    let newFreeBalance = credits.freeBalance;
    let newPaidBalance = credits.paidBalance;

    // Deduct from free balance first
    if (newFreeBalance >= amountToDeduct) {
      newFreeBalance -= amountToDeduct;
      
      // Record free credit transaction
      await ctx.db.insert("creditTransactions", {
        creditsId: credits._id,
        userId: args.userId,
        type: "usage",
        creditType: "free",
        amount: -amountToDeduct,
        balanceAfter: newFreeBalance,
        description: args.description,
        metadata: args.metadata,
        createdAt: now,
      });
    } else {
      // Deduct all free credits first
      const freeUsed = newFreeBalance;
      newFreeBalance = 0;
      
      if (freeUsed > 0) {
        await ctx.db.insert("creditTransactions", {
          creditsId: credits._id,
          userId: args.userId,
          type: "usage",
          creditType: "free",
          amount: -freeUsed,
          balanceAfter: 0,
          description: args.description,
          metadata: args.metadata,
          createdAt: now,
        });
      }

      // Deduct remaining from paid
      const paidNeeded = amountToDeduct - freeUsed;
      newPaidBalance -= paidNeeded;
      
      await ctx.db.insert("creditTransactions", {
        creditsId: credits._id,
        userId: args.userId,
        type: "usage",
        creditType: "paid",
        amount: -paidNeeded,
        balanceAfter: newPaidBalance,
        description: args.description,
        metadata: args.metadata,
        createdAt: now,
      });
    }

    // Update balances
    await ctx.db.patch(credits._id, {
      freeBalance: newFreeBalance,
      paidBalance: newPaidBalance,
      lifetimeUsed: credits.lifetimeUsed + args.amount,
      lastUpdatedAt: now,
    });

    return totalAvailable - args.amount; // Return new total
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
    creditType: v.union(v.literal("free"), v.literal("paid")),
    description: v.optional(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", args.ownerId).eq("ownerType", args.ownerType)
      )
      .unique();

    if (!credits) throw new ConvexError({ code: "NOT_FOUND", message: "Credits record not found" });

    const now = Date.now();
    let newFreeBalance = credits.freeBalance;
    let newPaidBalance = credits.paidBalance;
    let actualAdded = args.amount;

    if (args.creditType === "free") {
      // Cap free credits
      newFreeBalance = Math.min(newFreeBalance + args.amount, FREE_CREDIT_CAP);
      actualAdded = newFreeBalance - credits.freeBalance;
    } else {
      // No cap on paid credits
      newPaidBalance += args.amount;
    }

    await ctx.db.patch(credits._id, {
      freeBalance: newFreeBalance,
      paidBalance: newPaidBalance,
      lastUpdatedAt: now,
    });

    await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      type: args.type,
      creditType: args.creditType,
      amount: actualAdded,
      balanceAfter: args.creditType === "free" ? newFreeBalance : newPaidBalance,
      description: args.description,
      createdAt: now,
    });

    return args.creditType === "free" ? newFreeBalance : newPaidBalance;
  },
});
