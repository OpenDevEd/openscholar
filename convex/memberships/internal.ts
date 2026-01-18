import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

/**
 * Sync membership from WorkOS webhook
 */
export const syncMembershipFromWorkos = internalMutation({
  args: {
    userWorkosId: v.string(),
    orgWorkosId: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
  },
  returns: v.id("memberships"),
  handler: async (ctx, args) => {
    // Find user
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.userWorkosId))
      .unique();

    // Find organization
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.orgWorkosId))
      .unique();

    if (!user || !org) {
      // Throw to trigger WorkOS retry instead of silent failure
      throw new ConvexError({
        code: "NOT_FOUND",
        message: `User or org not found for membership sync: userWorkosId=${args.userWorkosId}, orgWorkosId=${args.orgWorkosId}`,
      });
    }

    // Check if membership already exists
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("organizationId", org._id)
      )
      .unique();

    if (existing) {
      // Update role if changed
      if (existing.role !== args.role) {
        await ctx.db.patch(existing._id, { role: args.role });
      }
      return existing._id;
    }

    // Create new membership
    return await ctx.db.insert("memberships", {
      userId: user._id,
      organizationId: org._id,
      role: args.role,
      permissions: [],
      joinedAt: Date.now(),
    });
  },
});

/**
 * Get membership for user/org (used by billing checks)
 */
export const getMembershipForUser = internalQuery({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    requiredRole: v.optional(v.union(
      v.literal("member"),
      v.literal("admin"),
      v.literal("owner")
    )),
  },
  returns: v.union(v.id("memberships"), v.null()),
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", args.userId).eq("organizationId", args.organizationId)
      )
      .unique();

    if (!membership) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Not a member of this organization",
      });
    }

    if (args.requiredRole) {
      const roleRank = { member: 0, admin: 1, owner: 2 } as const;
      const requiredRank = roleRank[args.requiredRole];
      if (roleRank[membership.role] < requiredRank) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }
    }

    return membership._id;
  },
});

/**
 * Update membership role from WorkOS webhook
 */
export const updateMembershipFromWorkos = internalMutation({
  args: {
    userWorkosId: v.string(),
    orgWorkosId: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.userWorkosId))
      .unique();

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.orgWorkosId))
      .unique();

    if (!user || !org) return;

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("organizationId", org._id)
      )
      .unique();

    if (membership) {
      await ctx.db.patch(membership._id, { role: args.role });
    }
  },
});

/**
 * Remove membership from WorkOS webhook
 */
export const removeMembership = internalMutation({
  args: {
    userWorkosId: v.string(),
    orgWorkosId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.userWorkosId))
      .unique();

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.orgWorkosId))
      .unique();

    if (!user || !org) return;

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("organizationId", org._id)
      )
      .unique();

    if (membership) {
      await ctx.db.delete(membership._id);
    }
  },
});
