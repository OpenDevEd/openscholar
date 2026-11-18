import "server-only";
import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";

/** Cloudflare sets this on every request it passes on, "true" for a crawler it has verified, so a visitor can't send it (docs/agents/project.md, "Bot floods"). */
const VERIFIED_BOT_HEADER = "x-openscholar-verified-bot";

/**
 * Whether a page may run searches for whoever asked for it: someone signed in, or a crawler Cloudflare vouches for.
 * Anyone else's page is drawn from what its address alone costs, and its searches run from their browser as server
 * actions, which Cloudflare answers only for a browser holding its pass (lib/visitor-pass.ts). Browsers that never
 * earn one then cost a page each and no searches: on 18 November 2026 thousands of them cost 100 searches a second.
 */
export async function isKnownVisitor() {
  const [{ userId }, list] = await Promise.all([auth(), headers()]);
  return !!userId || list.get(VERIFIED_BOT_HEADER) === "true";
}
