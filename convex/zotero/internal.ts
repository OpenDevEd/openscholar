/**
 * Internal Zotero queries - not exposed to clients
 */
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Get Zotero connection for a user (internal use only).
 * Returns both encryptedApiKey and apiKey for dual-read fallback.
 */
export const getConnection = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.union(
    v.object({
      zoteroUserId: v.string(),
      encryptedApiKey: v.optional(v.string()),
      apiKey: v.optional(v.string()),
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
      encryptedApiKey: connection.encryptedApiKey,
      apiKey: connection.apiKey,
      username: connection.username,
    };
  },
});

/**
 * List all Zotero connections for migration (Plan 02).
 */
export const listAllConnections = internalQuery({
  args: {},
  returns: v.array(v.object({
    _id: v.id("zoteroConnections"),
    apiKey: v.optional(v.string()),
    encryptedApiKey: v.optional(v.string()),
  })),
  handler: async (ctx) => {
    const all = await ctx.db.query("zoteroConnections").collect();
    return all.map((c) => ({ _id: c._id, apiKey: c.apiKey, encryptedApiKey: c.encryptedApiKey }));
  },
});
