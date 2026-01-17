// Non-Node.js utilities for API key handling
// Crypto functions that require Node.js are in apiKeys/actions.ts

/**
 * Get a display-safe prefix from an API key
 * e.g., "sk-proj-abc123..." -> "sk-proj..."
 */
export function getKeyPrefix(apiKey: string): string {
  // Show first 7 characters for identification
  const prefix = apiKey.substring(0, 7);
  return `${prefix}...`;
}

/**
 * Validate that a key looks like a valid API key for a provider
 */
export function validateApiKeyFormat(
  key: string,
  provider: "openai" | "anthropic" | "google" | "openrouter"
): boolean {
  switch (provider) {
    case "openai":
      return key.startsWith("sk-") && key.length > 20;
    case "anthropic":
      return key.startsWith("sk-ant-") && key.length > 20;
    case "google":
      return key.length > 20; // Google keys don't have a standard prefix
    case "openrouter":
      return key.startsWith("sk-or-") && key.length > 20;
    default:
      return key.length > 10;
  }
}
