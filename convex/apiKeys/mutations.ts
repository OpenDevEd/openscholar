import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { apiKeyProviderValidator } from "../lib/validators";

/**
 * Save an encrypted API key
 */
export const save = internalMutation({
  args: {
    provider: apiKeyProviderValidator,
    encryptedKey: v.string(),
    keyPrefix: v.string(),
  },
  returns: v.id("apiKeys"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Remove existing key for this provider
    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", args.provider)
      )
      .unique();

    if (existing) {
      await ctx.db.delete("apiKeys", existing._id);
    }

    return await ctx.db.insert("apiKeys", {
      userId: user._id,
      provider: args.provider,
      encryptedKey: args.encryptedKey,
      keyPrefix: args.keyPrefix,
      createdAt: Date.now(),
    });
  },
});

/**
 * Delete an API key
 */
export const remove = mutation({
  args: {
    provider: apiKeyProviderValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", args.provider)
      )
      .unique();

    if (existing) {
      await ctx.db.delete("apiKeys", existing._id);
    }

    return null;
  },
});

/**
 * Update last used timestamp
 */
export const markUsed = mutation({
  args: {
    provider: apiKeyProviderValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", args.provider)
      )
      .unique();

    if (key) {
      await ctx.db.patch("apiKeys", key._id, { lastUsedAt: Date.now() });
    }

    return null;
  },
});

