import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";
import { creditBalanceValidator, creditTransactionValidator } from "../lib/validators";

/**
 * Get current user's credit balance (free + paid)
 */
export const getMyBalance = query({
  args: {},
  returns: v.union(creditBalanceValidator, v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", user._id).eq("ownerType", "user")
      )
      .unique();

    if (!credits) {
      return { free: 0, paid: 0, total: 0 };
    }

    return {
      free: credits.freeBalance,
      paid: credits.paidBalance,
      total: credits.freeBalance + credits.paidBalance,
    };
  },
});

/**
 * Get organization's credit balance
 */
export const getOrgBalance = query({
  args: { organizationId: v.id("organizations") },
  returns: v.union(creditBalanceValidator, v.null()),
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

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", organizationId).eq("ownerType", "organization")
      )
      .unique();

    if (!credits) {
      return { free: 0, paid: 0, total: 0 };
    }

    return {
      free: credits.freeBalance,
      paid: credits.paidBalance,
      total: credits.freeBalance + credits.paidBalance,
    };
  },
});

/**
 * Get credit transaction history
 */
export const getTransactions = query({
  args: {
    organizationId: v.optional(v.id("organizations")),
    limit: v.optional(v.number()),
  },
  returns: v.array(creditTransactionValidator),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";

    if (args.organizationId) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user_org", (q) =>
          q.eq("userId", user._id).eq("organizationId", args.organizationId!)
        )
        .unique();
      if (!membership) return [];
    }

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .unique();

    if (!credits) return [];

    const transactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_credits", (q) => q.eq("creditsId", credits._id))
      .order("desc")
      .take(args.limit ?? 50);

    return transactions;
  },
});

/**
 * Check if user/org has enough credits
 */
export const checkBalance = query({
  args: {
    organizationId: v.optional(v.id("organizations")),
    requiredAmount: v.number(),
  },
  returns: v.union(
    v.object({
      hasEnough: v.boolean(),
      free: v.number(),
      paid: v.number(),
      total: v.number(),
      required: v.number(),
      deficit: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    if (args.organizationId) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user_org", (q) =>
          q.eq("userId", user._id).eq("organizationId", args.organizationId!)
        )
        .unique();
      if (!membership) return null;
    }

    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .unique();

    const free = credits?.freeBalance ?? 0;
    const paid = credits?.paidBalance ?? 0;
    const total = free + paid;

    return {
      hasEnough: total >= args.requiredAmount,
      free,
      paid,
      total,
      required: args.requiredAmount,
      deficit: Math.max(0, args.requiredAmount - total),
    };
  },
});
