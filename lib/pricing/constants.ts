/** 30% margin applied on raw provider USD cost when converting to credits.
 *  The wallet gateway uses a per-model `costMarkup` column instead. */
export const AI_COST_MARKUP = 1.3;

/** Credits per US dollar. Top-up prices in `autumn.config.ts` use the same rate. */
export const CREDITS_PER_USD = 10_000;
