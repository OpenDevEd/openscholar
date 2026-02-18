export const PUBLIC_UNAUTHENTICATED_PATHS = [
  "/",
  "/pricing",
  "/results/:path*",
  "/auth/:path*",
  "/bookmarks",
  "/history",
  "/settings/ai",
  "/data/:path*", // PostHog proxy - must work when signed out
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

  return PUBLIC_UNAUTHENTICATED_PATHS.some((pattern) =>
    matchesPublicPattern(normalizedPath, pattern),
  );
}
