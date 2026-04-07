"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import type { Id } from "../_generated/dataModel";

/**
 * Finalize wallet key creation. Called after approveConnection mutation.
 * Generates the cryptographic key, patches the DB record, and returns the raw key.
 */
export const finalizeConnection = action({
  args: { walletKeyId: v.id("walletKeys") },
  returns: v.object({
    rawKey: v.string(),
    keyPrefix: v.string(),
  }),
  handler: async (ctx, args): Promise<{ rawKey: string; keyPrefix: string }> => {
    const user: { _id: Id<"users"> } | null = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) throw createError("UNAUTHENTICATED", "Sign in required");

    // Verify ownership
    const key: { appName: string; redirectOrigin: string } | null = await ctx.runQuery(internal.wallet.internal.lookupById, {
      walletKeyId: args.walletKeyId,
      userId: user._id,
    });
    if (!key) throw createError("NOT_FOUND", "Wallet key not found");

    // Generate the real key via the internal action (has crypto access)
    const result: { rawKey: string; keyPrefix: string; walletKeyId: Id<"walletKeys"> } = await ctx.runAction(internal.wallet.nodeActions.createKey, {
      userId: user._id,
      appName: key.appName,
      redirectOrigin: key.redirectOrigin,
    });

    // Clean up the placeholder record
    await ctx.runMutation(internal.wallet.internal.removePendingKey, {
      walletKeyId: args.walletKeyId,
    });

    return {
      rawKey: result.rawKey,
      keyPrefix: result.keyPrefix,
    };
  },
});
