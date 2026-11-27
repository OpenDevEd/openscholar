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
  "/settings/:path*",
  "/shared/:path*",
  "/join/:path*",
  "/from-library/:path*",
  // A report's signed agreement is its workspace's to read. Publish itself is open, and asks for sign-in at the first step.
  "/publish/agreements/:path*",
  // What the proxy shows in place of a page while a new account's profile setup is due: only ever for someone signed in.
  "/profile-setup",
  "/o/:path*",
  "/api/:path*",
  "/trpc/:path*",
] as const;

/**
 * Open pages inside a private section: a signed-out visitor's AI overview is written through /api/overviews (#1070), and
 * the contact form on openscholar.ai sends and looks up institutions through /api/contact.
 */
const OPEN_INSIDE_PRIVATE = ["/settings/ai", "/api/overviews", "/api/contact", "/api/contact/institutions"] as const;

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

/**
 * The files and redirects routes serve to anyone, and the only addresses outside /api that aren't pages: a report's PDF,
 * a paper's citation files and cover, a DOI's paper, robots.txt and the sitemaps, the question stage's parts. They need
 * no account, so the proxy never hands them to Clerk; nor does Zenodo's sign-in coming back, which its state vouches for.
 * Exact, because a page takes any other address (`/papers/x.php` is a paper page that isn't found) and a page needs Clerk.
 */
// The .txt file is the IndexNow key in public/, named in full: another name of the same shape is a page that isn't found.
export const isPublicFile = (pathname: string) =>
  /^\/(?:robots\.txt|sitemap\.xml|6be290a44567a13bf59a858fe61708f7\.txt|papers\/sitemap\/\d+\.xml|papers\/doi\/.+|papers\/[^/]+\/(?:report\.pdf|cite\.(?:bib|ris)|cover\.png)|question-stage\/(?:hold|earth\.js)|settings\/connections\/zenodo)$/.test(pathname);

export function isPublicPath(pathname: string) {
  const normalizedPath = normalizePathname(pathname);

  if ((OPEN_INSIDE_PRIVATE as readonly string[]).includes(normalizedPath)) return true;
  // A report's file before its readers may have it: its route asks who is signed in itself, and tells anyone it won't
  // open it for that the PDF is private, in place of a sign-in page that says nothing (app/api/reports/files).
  if (/^\/api\/reports\/files\/[^/]+$/.test(normalizedPath)) return true;
  if (/^\/authors\/[^/]+\/configuration$/.test(normalizedPath)) return false;
  // The Communities page is open, its public communities everyone's (#1090); a community's own pages, and making one, take an account.
  if (/^\/evidence-communities\/.+/.test(normalizedPath)) return false;

  return !PRIVATE_PATHS.some((pattern) => matchesPattern(normalizedPath, pattern));
}

/**
 * Signed-in pages that show their own frame while sign-in finishes, so the
 * route gate skips its full-screen loader for them. Each one must stay
 * correct before access is known (see EvidenceLibrariesGate's fallback).
 */
const PAGES_WITH_OWN_LOADING = ["/evidence-communities", "/authors"] as const;
/** Every page in these sections draws its own frame while loading; a hand-off's page arrives whole from the server. */
const SECTIONS_WITH_OWN_LOADING = ["/extraction", "/screening", "/shared", "/from-library"] as const;

export function showsOwnLoading(pathname: string) {
  // An organization's page under /o/<slug> loads as the same page outside it does.
  const path = bareWorkspacePath(normalizePathname(pathname));
  return (PAGES_WITH_OWN_LOADING as readonly string[]).includes(path)
    || SECTIONS_WITH_OWN_LOADING.some((section) => path === section || path.startsWith(`${section}/`));
}
