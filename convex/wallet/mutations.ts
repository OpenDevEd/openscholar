import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getCurrentUser } from "../lib/auth";
import { createError } from "../lib/errors";
import { rateLimit } from "../lib/rateLimit";
import type { Id } from "../_generated/dataModel";

/**
 * Approve a wallet connection and create an API key.
 * Called from the /connect consent page after user approves.
 */
export const approveConnection = mutation({
  args: {
    appName: v.string(),
    redirectOrigin: v.string(),
  },
  returns: v.id("walletKeys"),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw createError("UNAUTHENTICATED", "Sign in required");

    // Validate redirect origin against the registered allowlist
    if (args.redirectOrigin !== "manual") {
      const allowed = await ctx.db
        .query("walletAllowedOrigins")
        .withIndex("by_origin", (q) => q.eq("origin", args.redirectOrigin))
        .unique();
      if (!allowed) {
        throw createError("VALIDATION_ERROR", "Unregistered redirect origin");
      }
    }

    await rateLimit(ctx, {
      name: "wallet-connect",
      key: user._id,
      throws: true,
    });

    const walletKeyId = await ctx.db.insert("walletKeys", {
      userId: user._id,
      // Placeholder — the action will patch with the real hash
      hashedKey: "__pending__",
      keyPrefix: "__pending__",
      appName: args.appName,
      redirectOrigin: args.redirectOrigin,
      isActive: true,
      createdAt: Date.now(),
    });

    return walletKeyId;
  },
});

/**
 * Revoke a wallet API key. Called from settings/key management UI.
 */
export const revokeKey = mutation({
  args: { walletKeyId: v.id("walletKeys") },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const user = await getCurrentUser(ctx);
    if (!user) throw createError("UNAUTHENTICATED", "Sign in required");

    const result: boolean = await ctx.runMutation(internal.wallet.internal.revokeKey, {
      walletKeyId: args.walletKeyId,
      userId: user._id,
    });
    return result;
  },
});
