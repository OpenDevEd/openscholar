import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireAuth } from "../lib/auth";
import { userValidator, subscriptionValidator, creditsValidator, orgWithMembershipValidator } from "../lib/validators";

/**
 * Get the current authenticated user
 */
export const me = query({
  args: {},
  returns: v.union(userValidator, v.null()),
  handler: async (ctx) => {
    return await getCurrentUser(ctx);
  },
});

/**
 * Get user by ID (requires authentication)
 * Only accessible for own profile or org members
 */
export const getById = query({
  args: { userId: v.id("users") },
  returns: v.union(userValidator, v.null()),
  handler: async (ctx, { userId }) => {
    const currentUser = await requireAuth(ctx);
    
    // Allow fetching own profile
    if (currentUser._id === userId) {
      return currentUser;
    }
    
    // Check if target user shares an organization with current user
    const currentUserMemberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
      .collect();
    
    const currentUserOrgIds = new Set(currentUserMemberships.map(m => m.organizationId));
    
    const targetUserMemberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    
    const sharesOrg = targetUserMemberships.some(m => currentUserOrgIds.has(m.organizationId));
    
    if (!sharesOrg) {
      return null; // Don't reveal user exists
    }
    
    return await ctx.db.get(userId);
  },
});

/**
 * Get user's organizations
 */
export const getMyOrganizations = query({
  args: {},
  returns: v.array(orgWithMembershipValidator),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const organizations = await Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db.get(m.organizationId);
        return org ? { ...org, role: m.role, membership: m } : null;
      })
    );

    return organizations.filter((org) => org !== null) as any;
  },
});

/**
 * Get user's subscription
 */
export const getMySubscription = query({
  args: {},
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    return await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", user._id).eq("ownerType", "user")
      )
      .unique();
  },
});

/**
 * Get user's credits
 */
export const getMyCredits = query({
  args: {},
  returns: v.union(creditsValidator, v.null()),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    return await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", user._id).eq("ownerType", "user")
      )
      .unique();
  },
});
