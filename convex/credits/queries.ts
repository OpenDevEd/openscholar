import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth, requireOrgMember } from "../lib/auth";
import { creditBalanceValidator } from "../lib/validators";

/**
 * Get current user's credit balance (free + paid)
 */
export const getMyBalance = query({
  args: {},
  returns: v.union(creditBalanceValidator, v.null()),
  handler: async (ctx) => {
    // Handle unauthenticated gracefully to avoid race conditions
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();

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
  returns: creditBalanceValidator,
  handler: async (ctx, { organizationId }) => {
    await requireOrgMember(ctx, organizationId);

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
  returns: v.array(v.any()), // Transaction shape is complex, using any for now
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";

    if (args.organizationId) {
      await requireOrgMember(ctx, args.organizationId);
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
