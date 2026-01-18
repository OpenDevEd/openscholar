export const FREE_CREDIT_CAP = 10_000;

export const PLAN_CONFIG = {
  free: { creditsPerMonth: 0, tier: 0 },
  go: { creditsPerMonth: 100, tier: 10 },
  pro: { creditsPerMonth: 1000, tier: 20 },
  enterprise: { creditsPerMonth: 10000, tier: 30 },
} as const;

export const GO_PRICE_ID = "price_1SqNyJHXajH1NDoWsIPm9mCw";
export const PRO_PRICE_ID = "price_1SqNyhHXajH1NDoWzHFCV3xM";

export type PlanType = keyof typeof PLAN_CONFIG;

/**
 * Get the tier number for a given plan
 * @returns 0 (free), 10 (go), 20 (pro), 30 (enterprise)
 */
export function getPlanTier(plan: PlanType): number {
  return PLAN_CONFIG[plan]?.tier ?? 0;
}
