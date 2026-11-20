import "server-only";
import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { isVerifiedCrawler } from "./verified-crawler";

/**
 * Whether a page may run searches for whoever asked for it: someone signed in, or a crawler Cloudflare vouches for.
 * Anyone else's page is drawn from what its address alone costs, and its searches run from their browser as server
 * actions, which Cloudflare answers only for a browser holding its pass (lib/visitor-pass.ts). Browsers that never
 * earn one then cost a page each and no searches: on 18 November 2026 thousands of them cost 100 searches a second.
 */
export async function isKnownVisitor() {
  const [{ userId }, list] = await Promise.all([auth(), headers()]);
  return !!userId || isVerifiedCrawler(list);
}
