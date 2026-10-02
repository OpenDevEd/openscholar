import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { OPENALEX_REQUEST_LIMITS, RequestLimiter } from "./request-limiter";
import { OPENALEX_LIMITED, type OpenAlexLimited } from "./limited";

/** How long a search waits for Convex to count its requests before counting them here instead. */
const CONVEX_COUNT_TIMEOUT_MS = 2_000;

const limiter = new RequestLimiter();

/** The address a request came from: Cloudflare's header first, then the proxies'. */
function clientAddress(list: Headers) {
  return list.get("cf-connecting-ip") ?? list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? list.get("x-real-ip") ?? "unknown";
}

/** The session's Convex token, chosen as `ConvexProviderWithClerk` chooses it. */
async function convexToken(session: Awaited<ReturnType<typeof auth>>) {
  return session.sessionClaims?.aud === "convex" ? session.getToken() : session.getToken({ template: "convex" });
}

/** Whether Convex counted the account's requests: true or false when it answered, null when it couldn't. */
async function spendInConvex(session: Awaited<ReturnType<typeof auth>>, count: number): Promise<boolean | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(resolve, CONVEX_COUNT_TIMEOUT_MS, null));
  const counted = (async () => {
    const token = await convexToken(session);
    return token ? await fetchMutation(api.openalex.limits.spend, { count }, { token }) : null;
  })().catch((error: unknown) => {
    // Caught here, not around the race, so a call that fails after the timeout is caught too.
    console.error("[openalex] couldn't count requests in Convex", error);
    return null;
  });
  return await Promise.race([counted, timeout]);
}

/**
 * Counts `count` OpenAlex requests against the caller. A signed-in account's are counted
 * in Convex, which Convex actions spend from too; a visitor's by address, here. When
 * Convex can't answer in time, the account is counted here, so a search neither waits nor
 * goes uncounted. Returns the limit answer when they have none left, for the action to
 * return instead of asking OpenAlex.
 */
export async function spendOpenAlexRequests(count = 1): Promise<OpenAlexLimited | null> {
  const session = await auth();
  if (session.userId) {
    const counted = await spendInConvex(session, count);
    if (counted !== null) return counted ? null : OPENALEX_LIMITED;
    return limiter.take(`account:${session.userId}`, OPENALEX_REQUEST_LIMITS.account, count) ? null : OPENALEX_LIMITED;
  }
  return limiter.take(`visitor:${clientAddress(await headers())}`, OPENALEX_REQUEST_LIMITS.visitor, count) ? null : OPENALEX_LIMITED;
}
