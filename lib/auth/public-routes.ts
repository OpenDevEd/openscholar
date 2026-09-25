export const PUBLIC_UNAUTHENTICATED_PATHS = [
  "/",
  "/pricing",
  "/topics/:path*",
  "/privacy",
  "/cookie-policy",
  "/results/:path*",
  "/sign-in/:path*",
  "/sign-up/:path*",
  "/bookmarks",
  "/history",
  "/settings/ai",
  "/api/openalex/search",
  "/data/:path*", // PostHog proxy - must work when signed out
  "/connect", // Wallet connection consent flow
] as const;

function normalizePathname(pathname: string) {
  if (!pathname) return "/";

  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (withoutQuery === "/") return "/";

  return withoutQuery.replace(/\/+$/, "") || "/";
}

function matchesPublicPattern(pathname: string, pattern: string) {
  if (!pattern.includes(":path*")) {
    return pathname === pattern;
  }

  const basePath = pattern.replace("/:path*", "");
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function isPublicPath(pathname: string) {
  const normalizedPath = normalizePathname(pathname);

  if (/^\/authors\/[^/]+$/.test(normalizedPath)) return true;

  return PUBLIC_UNAUTHENTICATED_PATHS.some((pattern) =>
    matchesPublicPattern(normalizedPath, pattern),
  );
}

/**
 * Signed-in pages that show their own frame while sign-in finishes, so the
 * route gate skips its full-screen loader for them. Each one must stay
 * correct before access is known (see OrganizationFeatureGate's fallback).
 */
const PAGES_WITH_OWN_LOADING = ["/evidence-libraries"] as const;

export function showsOwnLoading(pathname: string) {
  return (PAGES_WITH_OWN_LOADING as readonly string[]).includes(normalizePathname(pathname));
}
