"use node";
import { action, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { encrypt, decryptApiKey, getKeyPrefix } from "../lib/crypto";

function validateApiKeyFormat(
  key: string,
  provider: "openai" | "anthropic" | "google" | "openrouter"
): boolean {
  switch (provider) {
    case "openai":
      return key.startsWith("sk-") && key.length > 20;
    case "anthropic":
      return key.startsWith("sk-ant-") && key.length > 20;
    case "google":
      return key.length > 20;
    case "openrouter":
      return key.startsWith("sk-or-") && key.length > 20;
    default:
      return key.length > 10;
  }
}

// ============================================
// Actions
// ============================================

/**
 * Encrypt and save an API key
 */
export const encryptAndSave = action({
  args: {
    provider: v.union(
      v.literal("openai"),
      v.literal("anthropic"),
      v.literal("google"),
      v.literal("openrouter")
    ),
    plainKey: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    keyPrefix: v.string(),
  }),
  handler: async (ctx, args) => {
    // Rate limit check (before any processing)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw createError("UNAUTHENTICATED", "Authentication required");
    }
    await ctx.runMutation(internal.lib.rateLimit.consume, {
      name: "api-key-save",
      key: identity.subject,
    });

    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Encryption key not configured");
    }

    // Validate key format
    if (!validateApiKeyFormat(args.plainKey, args.provider)) {
      throw createError(
        "API_KEY_INVALID_FORMAT",
        `Invalid ${args.provider} API key format`,
      );
    }

    const encryptedKey = encrypt(args.plainKey, encryptionKey);
    const keyPrefix = getKeyPrefix(args.plainKey);

    await ctx.runMutation(internal.apiKeys.mutations.save, {
      provider: args.provider,
      encryptedKey,
      keyPrefix,
    });

    return { success: true, keyPrefix };
  },
});

/**
 * Get a decrypted API key for use in actions
 * This should only be called from other actions, never exposed to client
 */
export const getDecrypted = internalAction({
  args: {
    provider: v.union(
      v.literal("openai"),
      v.literal("anthropic"),
      v.literal("google"),
      v.literal("openrouter")
    ),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Encryption key not configured");
    }

    // Get authenticated user
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) {
      throw createError("UNAUTHENTICATED", "Authentication required");
    }

    // Get the encrypted key from internal query
    const keyData = await ctx.runQuery(internal.apiKeys.queries.getEncryptedKey, {
      userId: user._id,
      provider: args.provider,
    });

    if (!keyData) {
      return null;
    }

    const decrypted = decryptApiKey(keyData.encryptedKey, encryptionKey, {
      userId: user._id,
      purpose: `api-key-decrypt:${args.provider}`,
    });

    await ctx.runMutation(internal.lib.audit.writeAuditLog, {
      action: "KEY_DECRYPT",
      userId: user._id,
      metadata: { purpose: `api-key-decrypt:${args.provider}` },
    });

    return decrypted;
  },
});
