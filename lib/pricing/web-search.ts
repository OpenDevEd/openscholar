import { convertUsdToCredits } from "./convert";

/**
 * Chat and the wallet search the web through OpenRouter on Exa. Exa returned
 * sources on every model we tried, where native search gave none on GPT-6 Luna
 * and Google redirect links on Gemini, and it costs a flat $0.007 a search for
 * up to 10 results. Verified 2026-09-29 against
 * openrouter.ai/docs/guides/features/web-search.
 */
export const WEB_SEARCH_ENGINE = "exa";
export const WEB_SEARCH_USD = 0.007;
export const WEB_SEARCH_MAX_RESULTS = 5;

/** Searches the chat model may run for one reply. */
export const CHAT_WEB_SEARCHES_PER_REPLY = 3;

/** Credits one search costs at the chat markup. */
export const WEB_SEARCH_CREDITS = convertUsdToCredits({ usd: WEB_SEARCH_USD });
