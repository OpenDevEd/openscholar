import { internalMutation, internalQuery } from "../lib/functions";
import { v } from "convex/values";
import { personalWorkspaceOf } from "../workspaces/personal";

export const insertKey = internalMutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    hashedKey: v.string(),
    keyPrefix: v.string(),
    appName: v.string(),
    redirectOrigin: v.string(),
  },
  returns: v.id("walletKeys"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("walletKeys", {
      userId: args.userId,
      workspaceId: args.workspaceId,
      hashedKey: args.hashedKey,
      keyPrefix: args.keyPrefix,
      appName: args.appName,
      redirectOrigin: args.redirectOrigin,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const lookupKey = internalQuery({
  args: { hashedKey: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      workspaceId: v.id("workspaces"),
      walletKeyId: v.id("walletKeys"),
      appName: v.string(),
      redirectOrigin: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("walletKeys")
      .withIndex("by_hashed_key", (q) => q.eq("hashedKey", args.hashedKey))
      .unique();

    if (!key || !key.isActive) return null;

    return {
      userId: key.userId,
      // A key made before keys named a workspace draws on its person's own.
      workspaceId: key.workspaceId ?? (await personalWorkspaceOf(ctx, key.userId)),
      walletKeyId: key._id,
      appName: key.appName,
      redirectOrigin: key.redirectOrigin,
    };
  },
});

export const touchKeyUsage = internalMutation({
  args: { walletKeyId: v.id("walletKeys") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.walletKeyId, { lastUsedAt: Date.now() });
    return null;
  },
});

export const lookupById = internalQuery({
  args: {
    walletKeyId: v.id("walletKeys"),
    userId: v.id("users"),
  },
  returns: v.union(
    v.null(),
    v.object({
      appName: v.string(),
      redirectOrigin: v.string(),
      workspaceId: v.id("workspaces"),
    }),
  ),
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.walletKeyId);
    if (!key || key.userId !== args.userId) return null;
    return { appName: key.appName, redirectOrigin: key.redirectOrigin, workspaceId: key.workspaceId ?? (await personalWorkspaceOf(ctx, key.userId)) };
  },
});

export const removePendingKey = internalMutation({
  args: { walletKeyId: v.id("walletKeys") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.walletKeyId);
    if (key && key.hashedKey === "__pending__") {
      await ctx.db.delete(args.walletKeyId);
    }
    return null;
  },
});

export const revokeKey = internalMutation({
  args: { walletKeyId: v.id("walletKeys"), userId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.walletKeyId);
    if (!key || key.userId !== args.userId) return false;

    await ctx.db.patch(args.walletKeyId, { isActive: false });
    return true;
  },
});
