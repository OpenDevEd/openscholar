import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { apiKeyProviderValidator } from "../lib/validators";

/**
 * Get user's saved API keys (metadata only, not the actual keys)
 */
export const getMy = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("apiKeys"),
      provider: apiKeyProviderValidator,
      keyPrefix: v.string(),
      lastUsedAt: v.optional(v.number()),
      isValid: v.optional(v.boolean()),
      createdAt: v.number(),
    })
  ),
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
export const getEncryptedKey = internalQuery({
  args: {
    userId: v.id("users"),
    provider: apiKeyProviderValidator,
  },
  returns: v.union(
    v.object({
      encryptedKey: v.string(),
      provider: apiKeyProviderValidator,
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider)
      )
      .unique();

    if (!key) return null;

    return {
      encryptedKey: key.encryptedKey,
      provider: key.provider,
    };
  },
});
