import type { SearchSource } from "../search/source";

/** OpenAlex's API root. Requests build their URL with `openAlexUrl`, which adds the key. */
const OPENALEX_API = "https://api.openalex.org/";

/**
 * The URL for an OpenAlex API request, with OpenScholar's key and contact email. Every
 * request carries the key: without it a search costs 10 of 1,000 daily credits shared by
 * the server's address, and anonymous search pauses whenever OpenAlex is under load.
 * Server side only, since it reads the key. The SDK client in `lib/openalex.ts` adds the
 * same key itself, and `worksUrl` builds works searches with this. `scripts/check-openalex-key.sh`
 * fails CI on a request built any other way.
 */
export function openAlexUrl(path: string, parameters: Record<string, string | undefined> = {}) {
  const url = new URL(path, OPENALEX_API);
  for (const [key, value] of Object.entries(parameters)) if (value !== undefined) url.searchParams.set(key, value);
  if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  if (process.env.OPENALEX_CONTACT_EMAIL) url.searchParams.set("mailto", process.env.OPENALEX_CONTACT_EMAIL);
  return url;
}

/** Our index's API root, which every request to it is built on. Throws when it isn't set: a request never goes elsewhere in its place. */
function ownApiRoot() {
  const root = process.env.OPENSCHOLAR_API_URL;
  if (!root) throw new Error("OPENSCHOLAR_API_URL is not set, so our index can't be searched. Set it, or switch search to OpenAlex at Settings > Admin > Switches.");
  return root.endsWith("/") ? root : `${root}/`;
}

/** The URL for a request to a search source. Our index takes the same paths and parameters as OpenAlex; its key goes in a header (`searchHeaders`). */
export function searchUrl(source: SearchSource, path: string, parameters: Record<string, string | undefined> = {}) {
  if (source === "openalex") return openAlexUrl(path, parameters);
  const url = new URL(path.replace(/^\/+/, ""), ownApiRoot());
  for (const [key, value] of Object.entries(parameters)) if (value !== undefined) url.searchParams.set(key, value);
  return url;
}

/**
 * What a request to `url` carries beside itself. To our index: its key and Cloudflare Access's service token, following no
 * redirect, because fetch would carry these headers to wherever one points. To OpenAlex: nothing, so it never sees them, and
 * its redirects (a merged work's) are followed. Server side only, since it reads the secrets.
 */
export function searchHeaders(url: URL | string): { headers: Record<string, string>; redirect?: RequestRedirect } {
  const root = process.env.OPENSCHOLAR_API_URL;
  if (!root || new URL(url).origin !== new URL(root).origin) return { headers: {} };
  return {
    headers: {
      ...(process.env.OPENSCHOLAR_API_KEY ? { Authorization: `Bearer ${process.env.OPENSCHOLAR_API_KEY}` } : {}),
      ...(process.env.OPENSCHOLAR_API_ACCESS_CLIENT_ID ? { "CF-Access-Client-Id": process.env.OPENSCHOLAR_API_ACCESS_CLIENT_ID } : {}),
      ...(process.env.OPENSCHOLAR_API_ACCESS_CLIENT_SECRET ? { "CF-Access-Client-Secret": process.env.OPENSCHOLAR_API_ACCESS_CLIENT_SECRET } : {}),
    },
    redirect: "manual",
  };
}
