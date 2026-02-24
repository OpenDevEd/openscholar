import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { userValidator } from "../lib/validators";
import { createUserWithDefaults } from "../lib/userCreation";

export const getCurrentUser = internalQuery({
  args: {},
  returns: userValidator,
  handler: async (ctx) => {
    return await requireAuth(ctx);
  },
});

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), userValidator),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return user;
  },
});

export const upsertUserFromClerk = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        firstName: args.firstName,
        lastName: args.lastName,
        avatarUrl: args.avatarUrl,
        state: "active",
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await createUserWithDefaults(ctx, {
      clerkId: args.clerkId,
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      avatarUrl: args.avatarUrl,
    });
  },
});

export const markUserDeletedFromClerk = internalMutation({
  args: { clerkId: v.string() },
  returns: v.null(),
  handler: async (ctx, { clerkId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();

    if (!user) return null;

    await ctx.db.patch(user._id, {
      state: "deleted",
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const updateLastLogin = internalMutation({
  args: { clerkId: v.string() },
  returns: v.null(),
  handler: async (ctx, { clerkId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();

    if (!user) return null;

    await ctx.db.patch(user._id, {
      lastLoginAt: Date.now(),
    });

    return null;
  },
});
