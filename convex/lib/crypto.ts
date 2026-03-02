import { createError } from "./errors";

// ============================================
// Crypto utilities (Node.js only)
// Lazily requires "crypto" to avoid bundler issues
// ============================================

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getCrypto() {
  // Dynamic module name to prevent esbuild from resolving at bundle time
  const mod = ["cry", "pto"].join("");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(mod) as typeof import("crypto");
}

export function encrypt(plaintext: string, keyHex: string): string {
  const { createCipheriv, randomBytes } = getCrypto();
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

export function decrypt(encrypted: string, keyHex: string): string {
  const { createDecipheriv } = getCrypto();
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

export function getKeyPrefix(apiKey: string): string {
  const prefix = apiKey.substring(0, 7);
  return `${prefix}...`;
}
