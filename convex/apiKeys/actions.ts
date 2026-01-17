"use node";
import { action } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// ============================================
// Crypto utilities (Node.js only)
// ============================================

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");

  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes (64 hex characters)");
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
    throw new Error("Invalid encrypted format");
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const key = Buffer.from(keyHex, "hex");

  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes (64 hex characters)");
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
  handler: async (ctx, args) => {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error("Encryption key not configured");
    }

    // Validate key format
    if (!validateApiKeyFormat(args.plainKey, args.provider)) {
      throw new Error(`Invalid ${args.provider} API key format`);
    }

    const encryptedKey = encrypt(args.plainKey, encryptionKey);
    const keyPrefix = getKeyPrefix(args.plainKey);

    await ctx.runMutation(api.apiKeys.mutations.save, {
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
export const getDecrypted: any = action({
  args: {
    provider: v.union(
      v.literal("openai"),
      v.literal("anthropic"),
      v.literal("google"),
      v.literal("openrouter")
    ),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error("Encryption key not configured");
    }

    // Get the encrypted key from internal query
    const keyData: any = await ctx.runQuery(api.apiKeys.queries.getEncryptedKey, {
      provider: args.provider,
    });

    if (!keyData) {
      return null;
    }

    return decrypt(keyData.encryptedKey, encryptionKey);
  },
});
