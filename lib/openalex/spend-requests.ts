import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { OPENALEX_REQUEST_LIMITS, RequestLimiter } from "./request-limiter";

const limiter = new RequestLimiter();

/** A visitor's OpenAlex requests ran out; `message` is safe to show them. */
export class OpenAlexRequestLimitError extends Error {
  readonly status = 429;
  constructor() {
    super("Too many searches in a short time. Wait a minute and try again.");
    this.name = "OpenAlexRequestLimitError";
  }
}

/** The address a request came from: Cloudflare's header first, then the proxies'. */
function clientAddress(list: Headers) {
  return list.get("cf-connecting-ip") ?? list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? list.get("x-real-ip") ?? "unknown";
}

/**
 * Counts `count` OpenAlex requests against the caller: their account when signed in,
 * their address when not. Throws OpenAlexRequestLimitError when they have none left.
 */
export async function spendOpenAlexRequests(count = 1) {
  const { userId } = await auth();
  const key = userId ? `account:${userId}` : `visitor:${clientAddress(await headers())}`;
  const limit = userId ? OPENALEX_REQUEST_LIMITS.account : OPENALEX_REQUEST_LIMITS.visitor;
  if (!limiter.take(key, limit, count)) throw new OpenAlexRequestLimitError();
}
