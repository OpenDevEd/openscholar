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

/**
 * `value` as a path on this app, normalized the way a browser reads it, or null when it would leave the app: a
 * sign-in's "come back here" is never another site's address, however it is disguised (`//x.org`, `/\n/x.org`).
 */
export function localPath(value: string): string | null {
  if (!value.startsWith("/")) return null;
  const here = "https://app.invalid";
  const url = new URL(value, here);
  return url.origin === here ? `${url.pathname}${url.search}${url.hash}` : null;
}
