import "server-only";

/**
 * The sites whose pages may call the contact routes from a browser (app/api/contact): the marketing site, where the
 * form is. CONTACT_ORIGINS replaces the list, comma separated, for a copy of the site served somewhere else.
 */
const ORIGINS = (process.env.CONTACT_ORIGINS ?? "https://openscholar.ai,https://www.openscholar.ai,https://marketing.openscholar.ai")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/** The CORS headers for a request: its origin allowed when it's one of the marketing site's, nothing otherwise. */
export function contactCors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return origin && ORIGINS.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" }
    : { Vary: "Origin" };
}
