import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { apiKeyProviderValidator } from "../lib/validators";

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
