import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";

/**
 * Check if a redirect origin is registered in the allowlist.
 * Used by the /connect page before showing the consent screen.
 */
export const isOriginAllowed = query({
  args: { origin: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const allowed = await ctx.db
      .query("walletAllowedOrigins")
      .withIndex("by_origin", (q) => q.eq("origin", args.origin))
      .unique();
    return !!allowed;
  },
});

/**
 * List all wallet keys for the current user (for settings/key management).
 */
export const listMyKeys = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("walletKeys"),
      keyPrefix: v.string(),
      appName: v.string(),
      redirectOrigin: v.string(),
      isActive: v.boolean(),
      lastUsedAt: v.optional(v.number()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const keys = await ctx.db
      .query("walletKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    return keys
      .filter((k) => k.hashedKey !== "__pending__")
      .map((k) => ({
        _id: k._id,
        keyPrefix: k.keyPrefix,
        appName: k.appName,
        redirectOrigin: k.redirectOrigin,
        isActive: k.isActive,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
      }));
  },
});
