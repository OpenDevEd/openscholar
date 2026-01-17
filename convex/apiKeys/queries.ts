import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";

/**
 * Get user's saved API keys (metadata only, not the actual keys)
 */
export const getMy = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Never return encrypted key to client, only metadata
    return keys.map((k) => ({
      _id: k._id,
      provider: k.provider,
      keyPrefix: k.keyPrefix,
      lastUsedAt: k.lastUsedAt,
      isValid: k.isValid,
      createdAt: k.createdAt,
    }));
  },
});

/**
 * Get encrypted key for a provider (used internally by actions)
 */
export const getEncryptedKey = query({
  args: {
    provider: v.union(
      v.literal("openai"),
      v.literal("anthropic"),
      v.literal("google"),
      v.literal("openrouter")
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", args.provider)
      )
      .unique();

    if (!key) return null;

    return {
      encryptedKey: key.encryptedKey,
      provider: key.provider,
    };
  },
});
