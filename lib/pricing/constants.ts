/** 30% margin applied on raw provider USD cost when converting to credits.
 *  Single source of truth for the global markup. The wallet gateway path
 *  uses a per-model `costMarkup` column instead — see plans/unified-pricing
 *  /00-README.md § 10. */
export const AI_COST_MARKUP = 1.3;

/** Default credit/USD exchange rate. Live runtime reads
 *  `process.env.CREDITS_PER_USD` via `getCreditsPerUsd()` (Convex side).
 *  This is the build-time fallback used by `convertUsdToCredits` when no
 *  explicit rate is provided. */
export const DEFAULT_CREDITS_PER_USD = 10_000;
