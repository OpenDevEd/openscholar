/**
 * One-time credit grant issued to every new user on account creation.
 * Lets free users experience server-side AI (including extraction) before committing to a plan.
 */
export const FREE_SIGNUP_CREDIT_GRANT = 500;

/**
 * Markup multiplier applied to raw AI token costs before deducting credits.
 * Covers infrastructure overhead and sustains platform margins.
 */
export const AI_COST_MARKUP = 1.3;

export const PLAN_CONFIG = {
  free: { creditsPerMonth: 0, tier: 0, freeCreditCap: FREE_SIGNUP_CREDIT_GRANT },
  go: { creditsPerMonth: 3_000, tier: 10, freeCreditCap: 6_000 },
  pro: { creditsPerMonth: 15_000, tier: 20, freeCreditCap: 30_000 },
  enterprise: { creditsPerMonth: 150_000, tier: 30, freeCreditCap: 300_000 },
} as const;

// Price IDs from environment - allows test/live flexibility
export const GO_PRICE_ID = process.env.STRIPE_GO_PRICE_ID || "";
export const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || "";
export const ENTERPRISE_PRICE_ID = process.env.STRIPE_ENTERPRISE_PRICE_ID || "";

export const PLAN_PRICE_IDS = {
  go: GO_PRICE_ID,
  pro: PRO_PRICE_ID,
  enterprise: ENTERPRISE_PRICE_ID || null,
} as const;

export type PlanType = keyof typeof PLAN_CONFIG;

export type PlanPriceIds = {
  go: string;
  pro: string;
  enterprise?: string;
};

export function getPlanPriceIds(): PlanPriceIds {
  return {
    go: GO_PRICE_ID,
    pro: PRO_PRICE_ID,
    ...(ENTERPRISE_PRICE_ID ? { enterprise: ENTERPRISE_PRICE_ID } : {}),
  };
}

export function getPlanTypeFromMetadata(metadata?: Record<string, string>): PlanType | null {
  const plan = metadata?.plan;
  if (plan === "go" || plan === "pro" || plan === "enterprise" || plan === "free") {
    return plan;
  }
  return null;
}

export function assertPlanPriceConfig(): void {
  if (!GO_PRICE_ID || !PRO_PRICE_ID) {
    throw new Error("Stripe price IDs are not configured");
  }
}

export const ALLOWED_STRIPE_PRICE_IDS = Object.values(PLAN_PRICE_IDS).filter(
  (priceId): priceId is string => typeof priceId === "string" && priceId.length > 0
);

export function isAllowedPriceId(priceId: string): boolean {
  return ALLOWED_STRIPE_PRICE_IDS.includes(priceId);
}

export function getPlanFromPriceId(priceId?: string): PlanType {
  if (!priceId) return "free";

  if (priceId === GO_PRICE_ID) return "go";
  if (priceId === PRO_PRICE_ID) return "pro";
  if (ENTERPRISE_PRICE_ID && priceId === ENTERPRISE_PRICE_ID) return "enterprise";

  console.warn(`[getPlanFromPriceId] Unknown price ID: ${priceId} — defaulting to "free"`);
  return "free";
}

/**
 * Get the tier number for a given plan
 * @returns 0 (free), 10 (go), 20 (pro), 30 (enterprise)
 */
export function getPlanTier(plan: PlanType): number {
  return PLAN_CONFIG[plan]?.tier ?? 0;
}

export function getFreeCreditCapForPlan(plan: PlanType): number {
  return PLAN_CONFIG[plan]?.freeCreditCap ?? PLAN_CONFIG.free.freeCreditCap;
}
