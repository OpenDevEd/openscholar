"use node";
import { action, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { createError } from "../lib/errors";

// ============================================
// Crypto utilities (Node.js only)
// ============================================

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");

  if (key.length !== 32) {
    throw createError(
      "API_KEY_ENCRYPTION_KEY_INVALID",
      "Encryption key must be 32 bytes (64 hex characters)",
    );
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

function decrypt(encrypted: string, keyHex: string): string {
  const parts = encrypted.split(":");

  if (parts.length !== 3) {
    throw createError("API_KEY_ENCRYPTED_FORMAT_INVALID", "Invalid encrypted format");
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const key = Buffer.from(keyHex, "hex");

  if (key.length !== 32) {
    throw createError(
      "API_KEY_ENCRYPTION_KEY_INVALID",
      "Encryption key must be 32 bytes (64 hex characters)",
    );
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

function getKeyPrefix(apiKey: string): string {
  const prefix = apiKey.substring(0, 7);
  return `${prefix}...`;
}

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

    return decrypt(keyData.encryptedKey, encryptionKey);
  },
});
