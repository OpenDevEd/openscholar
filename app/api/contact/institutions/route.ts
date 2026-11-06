import { headers } from "next/headers";
import { hashedClientAddress } from "@/lib/openalex/spend-requests";
import { getConvexSiteUrl } from "@/lib/convex-site";
import { contactCors } from "@/lib/contact-origins";

/**
 * Institutions matching what a visitor types into the contact form's organisation field, as `?q=`: from the active
 * search source through Convex (convex/contact.ts), which holds its keys and counts the visitor's lookups.
 */
export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: contactCors(request) });
}

export async function GET(request: Request) {
  const cors = contactCors(request);
  const reply = (status: number, body: object, cache = "no-store") => Response.json(body, { status, headers: { ...cors, "Cache-Control": cache } });
  const secret = process.env.FREE_QUERIES_SECRET;
  const site = getConvexSiteUrl();
  if (!secret || !site) {
    console.error("[contact] FREE_QUERIES_SECRET or the Convex site address is not set");
    return reply(503, { failed: true });
  }
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 100) return reply(400, { error: "invalid_request" });
  const answer = await fetch(`${site}/contact/institutions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ address: hashedClientAddress(secret, await headers()), q }),
    signal: AbortSignal.timeout(15_000),
  }).catch((error: unknown) => {
    console.error("[contact] Convex didn't answer an institution lookup", error);
    return null;
  });
  if (!answer) return reply(502, { failed: true });
  const result = (await answer.json().catch(() => ({ failed: true }))) as object;
  // The same typing finds the same institutions for a while, so the browser keeps them.
  return reply(answer.status, result, answer.ok ? "private, max-age=600" : "no-store");
}
