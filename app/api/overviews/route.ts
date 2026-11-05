import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { clientAddress, hashedClientAddress } from "@/lib/openalex/spend-requests";
import { getConvexSiteUrl } from "@/lib/convex-site";
import { OVERVIEW_ACTION, verifyTurnstile } from "@/lib/turnstile";

const lines = (status: number, part: object) => new Response(`${JSON.stringify(part)}\n`, { status, headers: { "Content-Type": "application/x-ndjson" } });

/**
 * A signed-out visitor's AI overview (#1070), as lines of JSON (convex/research/signedOutOverviews.ts). The visitor
 * proves they're a person with a Turnstile token; this vouches for their address, hashed, with the shared secret,
 * which only the server holds. Someone signed in has their own overviews, kept in their workspace.
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (userId) return lines(403, { signedIn: true });
  const secret = process.env.FREE_QUERIES_SECRET;
  const site = getConvexSiteUrl();
  if (!secret || !site) {
    console.error("[overviews] FREE_QUERIES_SECRET or the Convex site address is not set");
    return lines(503, { failed: true });
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown; params?: unknown; lens?: unknown; locale?: unknown } | null;
  if (!body || typeof body.token !== "string" || body.token.length > 2_048) return lines(400, { verify: true });
  const list = await headers();
  if (!(await verifyTurnstile(body.token, clientAddress(list), OVERVIEW_ACTION))) return lines(403, { verify: true });
  const answer = await fetch(`${site}/overviews/signed-out`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ address: hashedClientAddress(secret, list), params: body.params, lens: body.lens, locale: body.locale }),
    signal: request.signal,
  }).catch((error: unknown) => {
    console.error("[overviews] Convex didn't answer", error);
    return null;
  });
  if (!answer?.ok || !answer.body) {
    if (answer) console.error("[overviews] Convex answered", answer.status, (await answer.text().catch(() => "")).slice(0, 300));
    return lines(502, { failed: true });
  }
  return new Response(answer.body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
