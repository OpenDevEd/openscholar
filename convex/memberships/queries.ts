import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";

/**
 * Get membership by ID
 */
export const getById = query({
  args: { membershipId: v.id("memberships") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, { membershipId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const membership = await ctx.db.get(membershipId);
    if (!membership) return null;

    // Allow users to fetch their own membership.
    if (membership.userId === user._id) {
      return membership;
    }

    // Otherwise, only org admins/owners can fetch another membership by ID.
    const requesterMembership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("organizationId", membership.organizationId)
      )
      .unique();

    if (
      !requesterMembership ||
      (requesterMembership.role !== "admin" && requesterMembership.role !== "owner")
    ) {
      return null;
    }

    return membership;
  },
});

/**
 * Get current user's membership in an organization
 */
export const getMyMembership = query({
  args: { organizationId: v.id("organizations") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, { organizationId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    return await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("organizationId", organizationId)
      )
      .unique();
  },
});
