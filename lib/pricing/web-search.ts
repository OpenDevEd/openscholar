/**
 * The wallet searches the web through OpenRouter on Exa. Exa returned
 * sources on every model we tried, where native search gave none on GPT-6 Luna
 * and Google redirect links on Gemini, and it costs a flat $0.007 a search for
 * up to 10 results. Verified 2026-09-29 against
 * openrouter.ai/docs/guides/features/web-search.
 */
export const WEB_SEARCH_ENGINE = "exa";
export const WEB_SEARCH_USD = 0.007;
export const WEB_SEARCH_MAX_RESULTS = 5;

/**
 * The assistant's web search (#648) runs the plugin on a small model that only has to cite
 * what it found: OpenRouter returns the pages as citations, with their text, once the model
 * writes a few words. The model's share is a fraction of a cent.
 */
export const WEB_SEARCH_MODEL = "google/gemini-3.1-flash-lite-preview";
export const WEB_SEARCH_MODEL_TOKENS = 300;
/** What one search is held at: the search, and the small model's few hundred tokens with room to spare. */
export const WEB_SEARCH_HOLD_USD = WEB_SEARCH_USD + 0.003;
