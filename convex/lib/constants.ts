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
 * Added to the reservation when the chat thread has web search enabled.
 * Web-search turns carry a flat per-call grounding fee from the provider
 * (OpenRouter surfaces it on `providerMetadata.openrouter.usage.cost`),
 * which dwarfs the token cost on small-output models like Gemini Flash.
 * Empirically observed at ~$0.04 per call ≈ ~480 credits; rounded up to
 * 500 so a typical web-search turn does not overrun the pre-flight gate.
 */
export const ESTIMATED_CREDITS_PER_WEB_SEARCH = 500;

/**
 * Credits reserved before a wallet gateway call, plus
 * `ESTIMATED_CREDITS_PER_WEB_SEARCH` when it asks for web search. The call
 * then settles to what it really cost.
 */
export const ESTIMATED_CREDITS_PER_WALLET_API_CALL = 200;
