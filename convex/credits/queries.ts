import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth, requireOrgMember } from "../lib/auth";

/**
 * Get current user's credit balance
 */
export const getMyBalance = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", user._id).eq("ownerType", "user")
      )
      .unique();

    return credits?.balance ?? 0;
  },
});

/**
 * Get organization's credit balance
 */
export const getOrgBalance = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    await requireOrgMember(ctx, organizationId);

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", organizationId).eq("ownerType", "organization")
      )
      .unique();

    return credits?.balance ?? 0;
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
