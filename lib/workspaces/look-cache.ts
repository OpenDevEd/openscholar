// How the rail looked in this browser (#651): a cookie keeps the signed-in person's name and
// photo, and each workspace's name, colour, logo and the sections it opens, so the server draws
// the rail as it was from the page's first frame, before Clerk or the workspace load. The rail writes it whenever it reads them. It names the account it's for, so someone
// else signing in on the same browser doesn't see it.

/** The cookie the rail's looks are kept in. */
export const LOOK_COOKIE = "workspace-looks";

/** The request header the proxy names the address's workspace in: its slug, or empty for the person's own. */
export const WORKSPACE_HEADER = "x-workspace-slug";

/** A workspace as the rail drew it; `extract`: it showed Extract; `author`: it makes author profiles; `publish`: it showed Publish. */
export type CachedLook = { kind: "personal" | "organization"; workspaceId: string; name: string; imageUrl?: string; colour?: string; extract?: true; author?: true; publish?: true };
/** The signed-in person, as the rail's account button shows them. */
export type CachedMe = { name: string; imageUrl?: string };
export type LookCache = { me?: CachedMe; looks: Record<string, CachedLook> };

/** What the server knew when it drew the page: the address's workspace, who's signed in, and how the rail looked last time. */
export type FirstWorkspace = { slug: string | null; user?: string; me?: CachedMe; look?: CachedLook };

/** Organizations kept besides the person's own: a cookie is sent with every request, so only the latest few. */
const KEPT = 6;
/** The longest value written: browsers drop a cookie whose name and value pass 4,096 bytes. */
const MAX_VALUE = 3_800;

/** The person's own workspace's key; an organization's is its slug. */
const OWN = "~";
export const lookKey = (slug: string | null | undefined) => slug || OWN;

/** The slug of the workspace an address is in: its organization's under /o/<slug>, none for the person's own. */
export const slugOf = (pathname: string) => /^\/o\/([^/]+)/.exec(pathname)?.[1] ?? null;

const COLOUR = /^#[0-9a-f]{6}$/i;
const photo = (value: unknown) => (typeof value === "string" && value.startsWith("https://") ? { imageUrl: value } : {});

/** What the cookie holds for `user` (their Clerk ID), raw or encoded. It's the person's own to change, so anything off is dropped. */
export function readCache(raw: string | undefined, user: string | null | undefined): LookCache {
  if (!raw || !user) return { looks: {} };
  try {
    const parsed = JSON.parse(raw.startsWith("%") ? decodeURIComponent(raw) : raw) as { user?: unknown; me?: Partial<CachedMe>; looks?: unknown } | null;
    if (parsed?.user !== user) return { looks: {} };
    const looks: Record<string, CachedLook> = {};
    for (const [key, value] of Object.entries((parsed.looks ?? {}) as Record<string, Partial<CachedLook>>)) {
      if (!value || (value.kind !== "personal" && value.kind !== "organization") || typeof value.workspaceId !== "string" || typeof value.name !== "string") continue;
      looks[key] = {
        kind: value.kind,
        workspaceId: value.workspaceId,
        name: value.name,
        ...photo(value.imageUrl),
        ...(typeof value.colour === "string" && COLOUR.test(value.colour) ? { colour: value.colour } : {}),
        ...(value.extract === true ? { extract: true as const } : {}),
        ...(value.author === true ? { author: true as const } : {}),
        ...(value.publish === true ? { publish: true as const } : {}),
      };
    }
    const me = typeof parsed.me?.name === "string" ? { name: parsed.me.name, ...photo(parsed.me.imageUrl) } : undefined;
    return { ...(me ? { me } : {}), looks };
  } catch {
    return { looks: {} };
  }
}

/**
 * The cookie's value for `user`, with `me` and the look kept under `key` newest, and the oldest
 * organizations dropped, past KEPT or until it fits. Null when even that doesn't fit.
 */
export function writeCache(cache: LookCache, user: string, key: string, look: CachedLook | undefined, me: CachedMe | undefined) {
  const { [key]: was, ...rest } = cache.looks;
  const kept = look ?? was;
  const keptMe = me ?? cache.me;
  const oldest = Object.keys(rest).filter((other) => other !== OWN);
  for (const old of oldest.splice(0, Math.max(0, oldest.length - (KEPT - 1)))) delete rest[old];
  const encode = () => encodeURIComponent(JSON.stringify({ user, ...(keptMe ? { me: keptMe } : {}), looks: { ...rest, ...(kept ? { [key]: kept } : {}) } }));
  let value = encode();
  while (value.length > MAX_VALUE && oldest.length) {
    delete rest[oldest.shift()!];
    value = encode();
  }
  return value.length > MAX_VALUE ? null : value;
}

/** The cookie's raw value in a `document.cookie` string. */
export const lookCookieIn = (cookies: string) => cookies.split("; ").find((cookie) => cookie.startsWith(`${LOOK_COOKIE}=`))?.slice(LOOK_COOKIE.length + 1);
