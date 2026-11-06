import { headers } from "next/headers";
import { clientAddress, hashedClientAddress } from "@/lib/openalex/spend-requests";
import { getConvexSiteUrl } from "@/lib/convex-site";
import { contactCors } from "@/lib/contact-origins";
import { CONTACT_ACTION, verifyTurnstile } from "@/lib/turnstile";

/**
 * The contact form on openscholar.ai/contact. The visitor proves they're a person with a Turnstile token; this vouches
 * for their address, hashed, with the shared secret, and Convex checks the message, counts it and emails it to the
 * team (convex/contact.ts). Answers `sent`, or why not: `verify`, `invalid`, `limit` or `failed`.
 */
export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: contactCors(request) });
}

export async function POST(request: Request) {
  const cors = contactCors(request);
  const reply = (status: number, body: object) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
  const secret = process.env.FREE_QUERIES_SECRET;
  const site = getConvexSiteUrl();
  if (!secret || !site) {
    console.error("[contact] FREE_QUERIES_SECRET or the Convex site address is not set");
    return reply(503, { failed: true });
  }
  const body = (await request.json().catch(() => null)) as ({ token?: unknown } & Record<string, unknown>) | null;
  if (!body || typeof body.token !== "string" || body.token.length > 2_048) return reply(400, { verify: true });
  const { token, ...message } = body;
  const list = await headers();
  if (!(await verifyTurnstile(token, clientAddress(list), CONTACT_ACTION))) return reply(403, { verify: true });
  const answer = await fetch(`${site}/contact`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ address: hashedClientAddress(secret, list), message }),
    signal: AbortSignal.timeout(30_000),
  }).catch((error: unknown) => {
    console.error("[contact] Convex didn't answer", error);
    return null;
  });
  if (!answer) return reply(502, { failed: true });
  const result = (await answer.json().catch(() => ({ failed: true }))) as object;
  if (!answer.ok) console.error("[contact] Convex answered", answer.status, JSON.stringify(result).slice(0, 300));
  return reply(answer.status, result);
}
