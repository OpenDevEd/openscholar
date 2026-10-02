import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { OPENALEX_REQUEST_LIMITS, RequestLimiter } from "./request-limiter";
import { OPENALEX_LIMITED, type OpenAlexLimited } from "./limited";

const visitors = new RequestLimiter();

/** The address a request came from: Cloudflare's header first, then the proxies'. */
function clientAddress(list: Headers) {
  return list.get("cf-connecting-ip") ?? list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? list.get("x-real-ip") ?? "unknown";
}

/**
 * Counts `count` OpenAlex requests against the caller. A signed-in account's are counted
 * in Convex, which Convex actions spend from too; a visitor's by address, here. Returns
 * the limit answer when they have none left, for the action to return instead of asking
 * OpenAlex.
 */
export async function spendOpenAlexRequests(count = 1): Promise<OpenAlexLimited | null> {
  const session = await auth();
  if (session.userId) {
    try {
      const token = (await session.getToken({ template: "convex" })) ?? undefined;
      return (await fetchMutation(api.openalex.limits.spend, { count }, { token })) ? null : OPENALEX_LIMITED;
    } catch (error) {
      // Fail open, as Firecrawl does when Autumn can't give a limit: a Convex hiccup
      // shouldn't stop search, and the next request is counted again.
      console.error("[openalex] couldn't count requests in Convex", error);
      return null;
    }
  }
  return visitors.take(`visitor:${clientAddress(await headers())}`, OPENALEX_REQUEST_LIMITS.visitor, count) ? null : OPENALEX_LIMITED;
}
