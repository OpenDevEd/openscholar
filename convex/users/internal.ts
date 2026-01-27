import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { userValidator } from "../lib/validators";
import { createUserWithDefaults } from "../lib/userCreation";

/**
 * Get current user (for use in actions)
 */
export const getCurrentUser = internalQuery({
  args: {},
  returns: userValidator,
  handler: async (ctx) => {
    return await requireAuth(ctx);
  },
});

/**
 * Get user by ID (for background jobs that already have the userId)
 */
export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), userValidator),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return user;
  },
});

/**
 * Sync a new user from WorkOS webhook
 */
export const syncUserFromWorkos = internalMutation({
  args: {
    workosId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    // Check if user already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .unique();

    if (existing) return existing._id;

    // Create new user using helper
    return await createUserWithDefaults(ctx, {
      workosId: args.workosId,
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      avatarUrl: args.avatarUrl,
    });
  },
});

/**
 * Update existing user from WorkOS webhook
 */
export const updateUserFromWorkos = internalMutation({
  args: {
    workosId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .unique();

    if (!user) return;

    await ctx.db.patch(user._id, {
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      avatarUrl: args.avatarUrl,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Mark user as deleted from WorkOS webhook
 */
export const markUserDeleted = internalMutation({
  args: { workosId: v.string() },
  returns: v.null(),
  handler: async (ctx, { workosId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", workosId))
      .unique();

    if (!user) return;

    await ctx.db.patch(user._id, {
      state: "deleted",
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Update user's last login time
 */
export const updateLastLogin = internalMutation({
  args: { workosId: v.string() },
  returns: v.null(),
  handler: async (ctx, { workosId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", workosId))
      .unique();

    if (!user) return;

    await ctx.db.patch(user._id, {
      lastLoginAt: Date.now(),
    });

    return null;
  },
});
