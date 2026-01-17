import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth, requireOrgMember } from "../lib/auth";

/**
 * Get current user's subscription
 */
export const getMy = query({
  args: {},
  handler: async (ctx) => {

    // Determine user identity without throwing "Unauthenticated" immediately
    // to avoid race conditions during first login sync
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();

    if (!user) return null;

    return await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", user._id).eq("ownerType", "user")
      )
      .unique();
  },
});

/**
 * Get organization's subscription
 */
export const getOrg = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    await requireOrgMember(ctx, organizationId);

    return await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", organizationId).eq("ownerType", "organization")
      )
      .unique();
  },
});

/**
 * Check if user/org has an active paid subscription
 */
export const isPaid = query({
  args: { organizationId: v.optional(v.id("organizations")) },
  handler: async (ctx, { organizationId }) => {
    const user = await requireAuth(ctx);

    const ownerId = organizationId ?? user._id;
    const ownerType = organizationId ? "organization" : "user";

    if (organizationId) {
      await requireOrgMember(ctx, organizationId);
    }

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
      .unique();

    if (!subscription) return false;

    return (
      subscription.status === "active" &&
      (subscription.plan === "pro" || subscription.plan === "enterprise")
    );
  },
});
