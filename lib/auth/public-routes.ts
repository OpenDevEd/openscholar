import { bareWorkspacePath } from "@/lib/workspaces/paths";

/**
 * Pages that need an account. Everything else is open, so an address that names no page reaches
 * the not-found page instead of sign-in. tests/public-routes-auth.test.ts lists the pages that are
 * open, and fails on a new page until it's on one list or the other.
 */
const PRIVATE_PATHS = [
  "/library/:path*",
  "/screening/:path*",
  "/extraction/:path*",
  "/evidence-communities/:path*",
  "/settings/:path*",
  "/shared/:path*",
  "/join/:path*",
  "/from-library/:path*",
  "/o/:path*",
  "/api/:path*",
  "/trpc/:path*",
] as const;

/** Open pages inside a private section. */
const OPEN_INSIDE_PRIVATE = ["/settings/ai"] as const;

function normalizePathname(pathname: string) {
  if (!pathname) return "/";

  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (withoutQuery === "/") return "/";

  return withoutQuery.replace(/\/+$/, "") || "/";
}

function matchesPattern(pathname: string, pattern: string) {
  if (!pattern.includes(":path*")) {
    return pathname === pattern;
  }

  const basePath = pattern.replace("/:path*", "");
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function isPublicPath(pathname: string) {
  const normalizedPath = normalizePathname(pathname);

  if ((OPEN_INSIDE_PRIVATE as readonly string[]).includes(normalizedPath)) return true;
  if (/^\/authors\/[^/]+\/configuration$/.test(normalizedPath)) return false;

  return !PRIVATE_PATHS.some((pattern) => matchesPattern(normalizedPath, pattern));
}

/**
 * Signed-in pages that show their own frame while sign-in finishes, so the
 * route gate skips its full-screen loader for them. Each one must stay
 * correct before access is known (see EvidenceLibrariesGate's fallback).
 */
const PAGES_WITH_OWN_LOADING = ["/evidence-communities", "/authors"] as const;
/** Every page in these sections draws its own frame while loading; a hand-off's page arrives whole from the server. */
const SECTIONS_WITH_OWN_LOADING = ["/extraction", "/from-library"] as const;

export function showsOwnLoading(pathname: string) {
  // An organization's page under /o/<slug> loads as the same page outside it does.
  const path = bareWorkspacePath(normalizePathname(pathname));
  return (PAGES_WITH_OWN_LOADING as readonly string[]).includes(path)
    || SECTIONS_WITH_OWN_LOADING.some((section) => path === section || path.startsWith(`${section}/`));
}
