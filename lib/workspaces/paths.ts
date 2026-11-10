// Where a page is, and where it is in another workspace (#651). Nothing here needs React or
// Convex, so the rules can be read by any component and checked against the app's own pages
// (paths.test.ts).

/** A page's path without its organization's prefix (/o/<slug>): the page each section reads itself as. */
export const bareWorkspacePath = (pathname: string) => pathname.replace(/^\/o\/[^/]+(?=\/|$)/, "") || "/";

/** The request header the proxy gives a page its own address in, path and query, which a layout isn't given. */
export const ADDRESS_HEADER = "x-page-address";

/**
 * The sections whose pages are a workspace's: their paths take an organization's prefix. Each is
 * a folder under app/o/[slug] and under app, and nothing else is: paths.test.ts fails when a
 * page is added to one side only.
 */
export const SECTIONS = ["/library", "/publish", "/history", "/results", "/screening", "/extraction", "/bookmarks", "/evidence-communities", "/authors", "/topics", "/settings", "/pricing", "/from-library"];
const within = (path: string, section: string) => path === section || path.startsWith(`${section}/`);

/** An organization's own settings, which a person's own workspace has no page for. */
const ORGANIZATION_ONLY = "/settings/workspace";

/** `path` in the workspace of `slug`: a workspace section's path, or the home page, under /o/<slug>; any other path as it is. */
export function workspaceHref(slug: string | undefined, path: string) {
  if (!slug || !path.startsWith("/") || path.startsWith(`/o/`)) return path;
  const bare = path.split(/[?#]/)[0]!;
  if (bare === "/") return `/o/${slug}${path.slice(1)}`;
  return SECTIONS.some((section) => within(bare, section)) ? `/o/${slug}${path}` : path;
}

type Item = { kind: "search" | "screening" | "extraction" | "collection" | "library" | "profile"; id: string };

/** The item a page shows, by its address: a search's results, a screening, an extraction, a collection, an Evidence Library or an author profile. */
export function pageItem(path: string, params: URLSearchParams): Item | null {
  const [, section, id, page] = path.split("/");
  if (section === "results" && id) return { kind: "search", id: decodeURIComponent(id) };
  if (section === "extraction" && id && id !== "new") return { kind: "extraction", id };
  if (section === "evidence-communities" && id && id !== "new") return { kind: "library", id };
  if (section === "authors" && id) return { kind: "profile", id };
  const job = path === "/screening" ? params.get("job") : null;
  if (job && job !== "new") return { kind: "screening", id: job };
  const collection = path === "/library" ? params.get("col") : null;
  return collection ? { kind: "collection", id: collection } : null;
}

/** Where each kind of item's section starts. */
const SECTION_OF: Record<Item["kind"], string> = { search: "/", screening: "/screening", extraction: "/extraction", collection: "/library", library: "/evidence-communities", profile: "/authors" };

/**
 * Where a switch to another workspace lands, which is always in that workspace, on a page it
 * has, and carrying nothing of the one left:
 * - the same page there, without what the address said after the `?`: a member picked, a search
 *   to screen and a job's costs are the old workspace's, and its page there starts fresh;
 * - where its section starts when the page shows an item, which is in one workspace only (Slack
 *   and Linear do the same);
 * - the workspace's home when the page has no place there at all. Shared with me and the policy
 *   pages are no organization's, and an organization's own settings aren't a person's: from
 *   those a switch used to go nowhere, and left the rail in one workspace and the page in the other.
 */
/**
 * Where an organization's address takes someone who isn't its member (#653): the same page, item
 * and all, in their own workspace, where what the organization shared with them is; for the
 * organization's own settings, which aren't a person's, their own settings.
 */
export function outsiderTarget(pathname: string, search: string) {
  const path = bareWorkspacePath(pathname);
  return within(path, ORGANIZATION_ONLY) ? "/settings" : path + search;
}

export function switchTarget(slug: string | undefined, pathname: string, search: string) {
  const path = bareWorkspacePath(pathname);
  if (!slug && within(path, ORGANIZATION_ONLY)) return "/settings";
  const item = pageItem(path, new URLSearchParams(search));
  const target = workspaceHref(slug, item ? SECTION_OF[item.kind] : path);
  return slug && !within(target, `/o/${slug}`) ? `/o/${slug}` : target;
}
