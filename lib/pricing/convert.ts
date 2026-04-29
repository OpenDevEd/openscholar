import { AI_COST_MARKUP, DEFAULT_CREDITS_PER_USD } from "./constants";

export interface ConvertUsdToCreditsArgs {
  usd: number;
  markup?: number;
  creditsPerUsd?: number;
}

/** Convert a USD cost into integer credits.
 *
 *    credits = max(1, ceil( usd × markup × creditsPerUsd ))
 *
 *  - Returns 0 when `usd <= 0` or non-finite (no charge for free / invalid calls).
 *  - Returns 1 when the math rounds below 1 but the call wasn't free
 *    (sub-cent floor still bills 1 credit).
 *  - `markup` defaults to {@link AI_COST_MARKUP}. The wallet gateway path
 *    passes its per-model `costMarkup` here instead.
 *  - `creditsPerUsd` defaults to {@link DEFAULT_CREDITS_PER_USD}. Convex
 *    callers pass `getCreditsPerUsd()` to honour the runtime env override.
 *  - The intermediate product is rounded to 1e-8 precision before ceiling
 *    so JS FP noise (e.g. `0.008 × 1.3 = 0.010400000000000001`) does not
 *    silently overcharge by 1 credit on otherwise-integer values. */
export function convertUsdToCredits(args: ConvertUsdToCreditsArgs): number {
  const { usd } = args;
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const markup = args.markup ?? AI_COST_MARKUP;
  const creditsPerUsd = args.creditsPerUsd ?? DEFAULT_CREDITS_PER_USD;
  const raw = Math.round(usd * markup * creditsPerUsd * 1e8) / 1e8;
  return Math.max(1, Math.ceil(raw));
}
