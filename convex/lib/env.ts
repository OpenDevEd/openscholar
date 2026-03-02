/**
 * Environment variable validation utilities.
 * Validate at function entry, not module scope, to avoid breaking unrelated functions.
 */

export function requireAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_URL;
  if (!url) {
    // Allow localhost fallback only in development/CI
    if (
      process.env.CONVEX_CLOUD_URL?.includes("localhost") ||
      process.env.NODE_ENV === "development"
    ) {
      return "http://localhost:3000";
    }
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not configured. Set this environment variable to your production URL.",
    );
  }
  return url;
}
