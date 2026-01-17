import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth, requireOrgOwner } from "../lib/auth";

/**
 * Check if user/org has enough credits
 */
export const checkBalance = mutation({
  args: {
    organizationId: v.optional(v.id("organizations")),
    requiredAmount: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .unique();

    const balance = credits?.balance ?? 0;

    return {
      hasEnough: balance >= args.requiredAmount,
      balance,
      required: args.requiredAmount,
      deficit: Math.max(0, args.requiredAmount - balance),
    };
  },
});
