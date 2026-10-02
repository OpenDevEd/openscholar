/** OpenAlex's API root. Requests build their URL with `openAlexUrl`, which adds the key. */
const OPENALEX_API = "https://api.openalex.org/";

/** Works paths (`works`, `works/W1`, `works?…`), and the root, where OQL is posted. */
const WORKS_OR_OQL = /^(?:works(?:[/?].*)?)?$/;

/**
 * The OpenScholar API, when `OPENSCHOLAR_API_URL` names it and the path asks for works or
 * OQL: our own index of papers, answering in OpenAlex's shapes, with the key
 * `OPENSCHOLAR_API_KEY`. Authors, funders and topics stay on OpenAlex, which alone serves them.
 */
function openScholarApi(path: string) {
  const root = process.env.OPENSCHOLAR_API_URL;
  if (!root || !WORKS_OR_OQL.test(path)) return null;
  return { root: root.endsWith("/") ? root : `${root}/`, key: process.env.OPENSCHOLAR_API_KEY };
}

/**
 * The URL for an OpenAlex API request, with OpenScholar's key and contact email. Every
 * request carries the key: without it a search costs 10 of 1,000 daily credits shared by
 * the server's address, and anonymous search pauses whenever OpenAlex is under load.
 * Server side only, since it reads the key. The SDK client in `lib/openalex.ts` adds the
 * same key itself, and `worksUrl` builds works searches with this. `scripts/check-openalex-key.sh`
 * fails CI on a request built any other way.
 *
 * When the OpenScholar API is set, works and OQL requests go to it instead, with its own key
 * and no contact email; that key never goes to OpenAlex, nor OpenAlex's to it.
 */
export function openAlexUrl(path: string, parameters: Record<string, string | undefined> = {}) {
  const relative = path.replace(/^\/+/, "");
  const ours = openScholarApi(relative);
  const url = new URL(relative, ours?.root ?? OPENALEX_API);
  for (const [key, value] of Object.entries(parameters)) if (value !== undefined) url.searchParams.set(key, value);
  if (ours) {
    if (ours.key) url.searchParams.set("api_key", ours.key);
    return url;
  }
  if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  if (process.env.OPENALEX_CONTACT_EMAIL) url.searchParams.set("mailto", process.env.OPENALEX_CONTACT_EMAIL);
  return url;
}
