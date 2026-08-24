"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { generateOpaqueToken } from "../lib/opaqueToken";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";

const WALLET_KEY_PREFIX = "wk_";

function generateRawKey(): string {
  return generateOpaqueToken(WALLET_KEY_PREFIX);
}

/**
 * Create a wallet API key for a user.
 * Returns the raw key (shown once) and stores the hash.
 */
export const createKey = internalAction({
  args: {
    userId: v.id("users"),
    appName: v.string(),
    redirectOrigin: v.string(),
  },
  returns: v.object({
    rawKey: v.string(),
    keyPrefix: v.string(),
    walletKeyId: v.id("walletKeys"),
  }),
  handler: async (ctx, args): Promise<{ rawKey: string; keyPrefix: string; walletKeyId: Id<"walletKeys"> }> => {
    const rawKey = generateRawKey();
    const hashedKey = await digestOpaqueToken(rawKey);
    const keyPrefix = `${rawKey.substring(0, 7)}...`;

    const walletKeyId: Id<"walletKeys"> = await ctx.runMutation(internal.wallet.internal.insertKey, {
      userId: args.userId,
      hashedKey,
      keyPrefix,
      appName: args.appName,
      redirectOrigin: args.redirectOrigin,
    });

    return { rawKey, keyPrefix, walletKeyId };
  },
});

/**
 * Validate a raw wallet API key.
 * Returns the userId and walletKeyId if valid, null otherwise.
 */
export const validateKey = internalAction({
  args: { rawKey: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      walletKeyId: v.id("walletKeys"),
      appName: v.string(),
      redirectOrigin: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<{ userId: Id<"users">; walletKeyId: Id<"walletKeys">; appName: string; redirectOrigin: string } | null> => {
    if (!args.rawKey.startsWith(WALLET_KEY_PREFIX)) return null;

    const hashedKey = await digestOpaqueToken(args.rawKey);
    const result: { userId: Id<"users">; walletKeyId: Id<"walletKeys">; appName: string; redirectOrigin: string } | null = await ctx.runQuery(internal.wallet.internal.lookupKey, { hashedKey });
    if (!result) return null;

    // Touch lastUsedAt (fire-and-forget)
    await ctx.runMutation(internal.wallet.internal.touchKeyUsage, {
      walletKeyId: result.walletKeyId,
    });

    return result;
  },
});
