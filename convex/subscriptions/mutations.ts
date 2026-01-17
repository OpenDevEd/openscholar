import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth, requireOrgOwner } from "../lib/auth";

/**
 * Link Stripe customer ID to subscription
 */
export const linkStripeCustomer = mutation({
  args: {
    organizationId: v.optional(v.id("organizations")),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";

    if (args.organizationId) {
      await requireOrgOwner(ctx, args.organizationId);
    }

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .unique();

    if (!subscription) throw new Error("Subscription not found");

    await ctx.db.patch(subscription._id, {
      stripeCustomerId: args.stripeCustomerId,
      updatedAt: Date.now(),
    });

    return subscription._id;
  },
});
