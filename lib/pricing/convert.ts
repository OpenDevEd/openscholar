import { calculateCostInDollars } from "../ai/core/cost";
import type { Usage } from "../ai/core/types";
import { AI_COST_MARKUP, CREDITS_PER_USD } from "./constants";

export interface ConvertUsdToCreditsArgs {
  usd: number;
  markup?: number;
}

/** Convert a USD cost into integer credits.
 *
 *    credits = max(1, ceil( usd × markup × CREDITS_PER_USD ))
 *
 *  - Returns 0 when `usd <= 0` or non-finite (no charge for free / invalid calls).
 *  - Returns 1 when the math rounds below 1 but the call wasn't free
 *    (sub-cent floor still bills 1 credit).
 *  - `markup` defaults to {@link AI_COST_MARKUP}. The wallet gateway path
 *    passes its per-model `costMarkup` here instead.
 *  - The intermediate product is rounded to 1e-8 precision before ceiling
 *    so JS FP noise (e.g. `0.008 × 1.3 = 0.010400000000000001`) does not
 *    silently overcharge by 1 credit on otherwise-integer values. */
export function convertUsdToCredits(args: ConvertUsdToCreditsArgs): number {
  const { usd } = args;
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const markup = args.markup ?? AI_COST_MARKUP;
  const raw = Math.round(usd * markup * CREDITS_PER_USD * 1e8) / 1e8;
  return Math.max(1, Math.ceil(raw));
}

/** Credits for a model call priced in USD per million tokens. A call that
 *  used tokens costs at least 1 credit, even before the model's price syncs. */
export function creditsForUsage(
  usage: Usage,
  pricing: { input: number; output: number },
): number {
  const credits = convertUsdToCredits({ usd: calculateCostInDollars(usage, pricing) });
  if (credits > 0) return credits;
  const tokens =
    (usage.inputTokens ?? usage.promptTokens ?? 0) +
    (usage.outputTokens ?? usage.completionTokens ?? 0);
  return tokens > 0 ? 1 : 0;
}
