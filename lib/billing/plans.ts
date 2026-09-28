/**
 * OpenScholar's plans. `autumn.config.ts` pushes these to Autumn; the app
 * reads them for display and plan gates.
 */
import { CREDITS_PER_USD } from "../pricing/constants";

export const PLAN_IDS = ["free", "go", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const PAID_PLANS = {
  go: { usdPerMonth: 5, creditsPerMonth: 3_000 },
  pro: { usdPerMonth: 20, creditsPerMonth: 15_000 },
} as const;

/** Most plan credits a customer can hold: one month plus a month rolled over. */
export function planCreditCap(plan: PlanId): number {
  return plan === "free" ? SIGNUP_CREDITS : PAID_PLANS[plan].creditsPerMonth * 2;
}

/** Feature flags with a minimum tier compare against these. */
export const PLAN_TIER: Record<PlanId, number> = { free: 0, go: 10, pro: 20 };

export const SIGNUP_CREDITS = 500;

/** Top-ups are sold in units of $1 and never expire. */
export const TOPUP = {
  usdPerUnit: 1,
  creditsPerUnit: CREDITS_PER_USD,
  bundles: [10_000, 50_000, 100_000],
} as const;
