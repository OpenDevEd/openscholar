/**
 * Markup multiplier applied to raw AI token costs before deducting credits.
 * Single source of truth lives in `lib/pricing/constants.ts`; re-exported
 * here only because this file is a multi-purpose grab-bag and existing
 * callers import it from `@/convex/lib/constants`.
 */
export { AI_COST_MARKUP } from "@/lib/pricing";

/**
 * Estimated credit cost per paper for batch AI operations (screening, translation, extraction).
 * Used for pre-flight balance checks before starting expensive batch jobs.
 * Derived from typical token usage (~900 in / ~50 out) with the server model.
 */
export const ESTIMATED_CREDITS_PER_PAPER = 4.5;

/**
 * Estimated credit cost for single AI query operations
 * (enhance query, generate questions, translate query, etc.).
 * Used for pre-flight balance checks on non-batch operations.
 */
export const ESTIMATED_CREDITS_PER_QUERY = 2;

/**
 * Credits reserved before a chat turn (~20k tokens prompt + ~1k output on
 * a Sonnet-class model). The turn then settles to what it really cost.
 */
export const ESTIMATED_CREDITS_PER_CHAT_MESSAGE = 200;

/**
 * Credits held before an assistant reply, and the most its requests may cost before its
 * tools stop running (#326). A person with fewer holds what they have, down to a chat
 * message's hold. The reply then settles to what it really cost. Measured on
 * 2026-10-04 with Claude Sonnet 5.5: a reply's first request costs about 300 when the
 * fixed tool list isn't cached yet, and a request that reads it from cache about 30.
 */
export const ASSISTANT_REPLY_CREDITS = 1_000;

/**
 * Replies the assistant writes for one person at once. A deployment runs so many actions at
 * a time, 64 unless the backend is set otherwise, shared by everyone on it; this keeps one
 * account to a quarter of them.
 */
export const ASSISTANT_REPLIES_AT_ONCE = 16;

/**
 * Credits reserved before a wallet gateway call, plus one web search when it
 * asks for one. The call then settles to what it really cost.
 */
export const ESTIMATED_CREDITS_PER_WALLET_API_CALL = 200;
