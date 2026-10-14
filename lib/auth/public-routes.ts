import { bareWorkspacePath } from "@/lib/workspaces/paths";

const PUBLIC_UNAUTHENTICATED_PATHS = [
  "/",
  "/pricing",
  "/topics/:path*",
  "/authors",
  "/privacy",
  "/cookie-policy",
  "/credits",
  "/results/:path*",
  "/sign-in/:path*",
  "/sign-up/:path*",
  "/bookmarks",
  "/history",
  "/settings/ai",
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
 * correct before access is known (see EvidenceLibrariesGate's fallback).
 */
const PAGES_WITH_OWN_LOADING = ["/evidence-libraries", "/authors", "/screening"] as const;
/** Every page in these sections draws its own frame while loading; a hand-off's page arrives whole from the server. */
const SECTIONS_WITH_OWN_LOADING = ["/extraction", "/from-library"] as const;

export function showsOwnLoading(pathname: string) {
  // An organization's page under /o/<slug> loads as the same page outside it does.
  const path = bareWorkspacePath(normalizePathname(pathname));
  return (PAGES_WITH_OWN_LOADING as readonly string[]).includes(path)
    || SECTIONS_WITH_OWN_LOADING.some((section) => path === section || path.startsWith(`${section}/`));
}
