import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { OPENALEX_REQUEST_LIMITS, RequestLimiter } from "./request-limiter";
import { OPENALEX_LIMITED, type OpenAlexLimited } from "./limited";

const limiter = new RequestLimiter();

/** The address a request came from: Cloudflare's header first, then the proxies'. */
function clientAddress(list: Headers) {
  return list.get("cf-connecting-ip") ?? list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? list.get("x-real-ip") ?? "unknown";
}

/**
 * Counts `count` OpenAlex requests against the caller: their account when signed in,
 * their address when not. Returns the limit answer when they have none left, for the
 * action to return instead of asking OpenAlex.
 */
export async function spendOpenAlexRequests(count = 1): Promise<OpenAlexLimited | null> {
  const { userId } = await auth();
  const key = userId ? `account:${userId}` : `visitor:${clientAddress(await headers())}`;
  const limit = userId ? OPENALEX_REQUEST_LIMITS.account : OPENALEX_REQUEST_LIMITS.visitor;
  return limiter.take(key, limit, count) ? null : OPENALEX_LIMITED;
}
