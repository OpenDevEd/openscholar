/**
 * The contact form on openscholar.ai/contact. The Next app's /api/contact checks the visitor is a person (Cloudflare
 * Turnstile) and vouches for their address, hashed, with the shared secret, as /api/overviews does; this checks the
 * message, counts it, and emails it to the team's inbox (./contactMail.ts). /api/contact/institutions asks here for the
 * institutions a visitor's typing matches, from the active search source, counted against the visitor's allowance.
 */
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./lib/functions";
import { rateLimit } from "./lib/rateLimit";
import { v } from "convex/values";
import { autocomplete } from "./paperSets/openalex";
import { spender } from "./paperSets/search";
import { contactMessage } from "../lib/contact";
import { OpenAlexLimitedError } from "../lib/openalex/limited";

/** Suggestions a lookup answers with, and the typing it reads. */
const SUGGESTIONS = 6;
const QUERY = { min: 2, max: 100 };

const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
/** The address the Next app vouched for, or null when the request isn't from it. */
async function vouched(request: Request): Promise<{ address: string; body: Record<string, unknown> } | null> {
  const secret = process.env.FREE_QUERIES_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) return null;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  return body && typeof body.address === "string" && /^[0-9a-f]{64}$/.test(body.address) ? { address: body.address, body } : null;
}

/** Whether a visitor may send another message, counting it if so: their own allowance first, then everyone's. */
export const claim = internalMutation({
  args: { address: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { address }) => {
    if (!(await rateLimit(ctx, { name: "contact-address", key: address })).ok) return false;
    if ((await rateLimit(ctx, { name: "contact-all", key: "all" })).ok) return true;
    console.warn(JSON.stringify({ event: "contact-daily-total-reached" }));
    return false;
  },
});

/** `POST /contact`, from the Next app only: `{ address, message }`. Answers `sent`, or `invalid`, `limit` or `failed`. */
export const send = httpAction(async (ctx, request) => {
  const from = await vouched(request);
  if (!from) return json(401, { error: "unauthorized" });
  const parsed = contactMessage.safeParse(from.body.message);
  if (!parsed.success) return json(400, { invalid: parsed.error.issues.map((issue) => issue.path.join(".")) });
  if (!(await ctx.runMutation(internal.contact.claim, { address: from.address }))) return json(429, { limit: true });
  try {
    await ctx.runAction(internal.contactMail.deliver, { message: parsed.data });
  } catch (error) {
    console.error(JSON.stringify({ event: "contact-mail-failed", topic: parsed.data.topic, error: String(error) }));
    return json(502, { failed: true });
  }
  return json(200, { sent: true });
});

/** `POST /contact/institutions`, from the Next app only: `{ address, q }`. Answers `matches`: each one's name and place. */
export const institutions = httpAction(async (ctx, request) => {
  const from = await vouched(request);
  if (!from) return json(401, { error: "unauthorized" });
  const q = typeof from.body.q === "string" ? from.body.q.trim() : "";
  if (q.length < QUERY.min || q.length > QUERY.max) return json(400, { error: "invalid_request" });
  const source = await ctx.runQuery(internal.featureFlags.internal.searchSource, {});
  try {
    // A visitor's lookups count against their search allowance, kept by their address as their searches are.
    const options = await autocomplete("institutions", q, spender(ctx, `visitor:${from.address}`), source);
    return json(200, { matches: options.slice(0, SUGGESTIONS).map((option) => ({ name: option.name, place: option.detail ?? "" })) });
  } catch (error) {
    if (String(error).includes(new OpenAlexLimitedError().message)) return json(429, { limit: true });
    console.error(JSON.stringify({ event: "contact-institutions-failed", source, error: String(error) }));
    return json(502, { failed: true });
  }
});
