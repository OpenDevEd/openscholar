/** OpenAlex's API root. Requests build their URL with `openAlexUrl`, which adds the key. */
export const OPENALEX_API = "https://api.openalex.org/";

/**
 * The URL for an OpenAlex API request, with OpenScholar's key and contact email. Every
 * request carries the key: without it a search costs 10 of 1,000 daily credits shared by
 * the server's address, and anonymous search pauses whenever OpenAlex is under load.
 * Server side only, since it reads the key. The SDK client in `lib/openalex.ts` adds the
 * same key itself. `scripts/check-openalex-key.sh` fails CI on a request built any other way.
 */
export function openAlexUrl(path: string, parameters: Record<string, string | undefined> = {}) {
  const url = new URL(path, OPENALEX_API);
  for (const [key, value] of Object.entries(parameters)) if (value !== undefined) url.searchParams.set(key, value);
  if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  if (process.env.OPENALEX_CONTACT_EMAIL) url.searchParams.set("mailto", process.env.OPENALEX_CONTACT_EMAIL);
  return url;
}
