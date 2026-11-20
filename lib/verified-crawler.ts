/** Cloudflare sets this on every request it passes on, "true" for a crawler it has verified, so a visitor can't send it (docs/agents/project.md, "Bot floods"). */
const VERIFIED_BOT_HEADER = "x-openscholar-verified-bot";

/** Whether Cloudflare vouches for this request as a crawler it has verified. */
export const isVerifiedCrawler = (list: Headers) => list.get(VERIFIED_BOT_HEADER) === "true";
