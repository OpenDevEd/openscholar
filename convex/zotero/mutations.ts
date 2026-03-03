/**
 * Zotero mutations - OAuth flow and connection management
 */
import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireAuth } from "../lib/auth";

/**
 * Store OAuth request token temporarily (during OAuth flow).
 */
export const storeRequestToken = internalMutation({
  args: {
    token: v.string(),
    tokenSecret: v.string(),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { token, tokenSecret, userId }) => {
    // Delete any existing tokens for this user
    const existing = await ctx.db
      .query("zoteroOAuthTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    await Promise.all(existing.map((t) => ctx.db.delete(t._id)));

    // Store new token with 10 minute expiry
    await ctx.db.insert("zoteroOAuthTokens", {
      token,
      tokenSecret,
      userId,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return null;
  },
});

/**
 * Get stored request token for OAuth callback.
 */
export const getRequestToken = internalMutation({
  args: {
    token: v.string(),
  },
  returns: v.union(
    v.object({
      tokenSecret: v.string(),
      userId: v.id("users"),
    }),
    v.null()
  ),
  handler: async (ctx, { token }) => {
    const stored = await ctx.db
      .query("zoteroOAuthTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (!stored) return null;
    if (stored.expiresAt < Date.now()) {
      await ctx.db.delete(stored._id);
      return null;
    }

    // Delete the token after retrieval (one-time use)
    await ctx.db.delete(stored._id);

    return {
      tokenSecret: stored.tokenSecret,
      userId: stored.userId,
    };
  },
});

/**
 * Save Zotero connection after successful OAuth.
 * Accepts encrypted API key + key prefix (plaintext key is never stored for new connections).
 */
export const saveConnection = internalMutation({
  args: {
    userId: v.id("users"),
    zoteroUserId: v.string(),
    encryptedApiKey: v.string(),
    keyPrefix: v.string(),
    username: v.optional(v.string()),
  },
  returns: v.id("zoteroConnections"),
  handler: async (ctx, { userId, zoteroUserId, encryptedApiKey, keyPrefix, username }) => {
    // Delete any existing connection for this user
    const existing = await ctx.db
      .query("zoteroConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return await ctx.db.insert("zoteroConnections", {
      userId,
      zoteroUserId,
      encryptedApiKey,
      keyPrefix,
      username,
      connectedAt: Date.now(),
    });
  },
});

/**
 * Patch encrypted key on an existing connection (for migration in Plan 02).
 */
export const patchEncryptedKey = internalMutation({
  args: {
    connectionId: v.id("zoteroConnections"),
    encryptedApiKey: v.string(),
    keyPrefix: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, encryptedApiKey, keyPrefix }) => {
    await ctx.db.patch(connectionId, { encryptedApiKey, keyPrefix });
    return null;
  },
});

/**
 * Disconnect Zotero account.
 */
export const disconnect = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    const connection = await ctx.db
      .query("zoteroConnections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (connection) {
      await ctx.db.delete(connection._id);
    }

    return null;
  },
});

/**
 * Cron: delete expired OAuth request tokens.
 * Tokens have a 10-minute TTL set during storeRequestToken.
 * This cleans up tokens from abandoned OAuth flows (user starts connect, never completes callback).
 */
export const cleanupExpiredOAuthTokens = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    // Use by_expiry index: only fetch tokens that have already expired
    const expiredTokens = await ctx.db
      .query("zoteroOAuthTokens")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", now))
      .take(100);

    let deletedCount = 0;
    for (const token of expiredTokens) {
      try {
        await ctx.db.delete(token._id);
        deletedCount++;
      } catch {
        // Token may have been deleted by getRequestToken or concurrent process.
        // Safe to ignore -- Convex OCC retries handle this gracefully.
      }
    }

    if (deletedCount > 0) {
      console.log(`[cleanupExpiredOAuthTokens] Deleted ${deletedCount} expired token(s)`);
    }

    return null;
  },
});
