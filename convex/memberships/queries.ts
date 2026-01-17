import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth, requireOrgMember } from "../lib/auth";

/**
 * Get membership by ID
 */
export const getById = query({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, { membershipId }) => {
    return await ctx.db.get(membershipId);
  },
});

/**
 * Get current user's membership in an organization
 */
export const getMyMembership = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    const user = await requireAuth(ctx);

    return await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("organizationId", organizationId)
      )
      .unique();
  },
});
