import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";

async function getMembership(
  ctx: any,
  userId: string,
  organizationId: string
) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_user_org", (q: any) =>
      q.eq("userId", userId).eq("organizationId", organizationId)
    )
    .unique();
}

/**
 * Get organization by ID
 */
export const getById = query({
  args: { organizationId: v.id("organizations") },
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

    return await ctx.db.get(organizationId);
  },
});

/**
 * Get organization with membership info
 */
export const getWithMembership = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const membership = await getMembership(ctx, user._id, organizationId);
    if (!membership) return null;
    const org = await ctx.db.get(organizationId);

    return {
      organization: org,
      membership,
      user,
    };
  },
});

/**
 * Get all members of an organization
 */
export const getMembers = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const membership = await getMembership(ctx, user._id, organizationId);
    if (!membership) return [];

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .collect();

    const members = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return { ...m, user };
      })
    );

    return members;
  },
});

/**
 * Get organization credits
 */
export const getCredits = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const membership = await getMembership(ctx, user._id, organizationId);
    if (!membership) return null;

    return await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", organizationId).eq("ownerType", "organization")
      )
      .unique();
  },
});

/**
 * Get organization subscription
 */
export const getSubscription = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const membership = await getMembership(ctx, user._id, organizationId);
    if (!membership) return null;

    return await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", organizationId).eq("ownerType", "organization")
      )
      .unique();
  },
});
