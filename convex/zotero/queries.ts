/**
 * Zotero queries - connection status and library data
 */
import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";

/**
 * Get the current user's Zotero connection status.
 */
export const getConnectionStatus = query({
  args: {},
  returns: v.union(
    v.object({
      connected: v.literal(true),
      zoteroUserId: v.string(),
      username: v.optional(v.string()),
      connectedAt: v.number(),
    }),
    v.object({
      connected: v.literal(false),
    })
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return { connected: false as const };
    }

    const connection = await ctx.db
      .query("zoteroConnections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!connection) {
      return { connected: false as const };
    }

    return {
      connected: true as const,
      zoteroUserId: connection.zoteroUserId,
      username: connection.username,
      connectedAt: connection.connectedAt,
    };
  },
});

/**
 * Get current user's Zotero user ID (internal)
 */
export const getZoteroUserIdInternal = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const connection = await ctx.db
      .query("zoteroConnections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!connection) return null;
    return connection.zoteroUserId;
  },
});
