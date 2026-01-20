/**
 * Internal Zotero queries - not exposed to clients
 */
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Get Zotero connection for a user (internal use only).
 */
export const getConnection = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.union(
    v.object({
      zoteroUserId: v.string(),
      apiKey: v.string(),
      username: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, { userId }) => {
    const connection = await ctx.db
      .query("zoteroConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!connection) return null;

    return {
      zoteroUserId: connection.zoteroUserId,
      apiKey: connection.apiKey,
      username: connection.username,
    };
  },
});
