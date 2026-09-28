/**
 * Reading Autumn's catalog: which plans to offer, in what order, and what
 * they cost. Shared by Convex functions and the UI.
 */
import type { BillingCatalog, CatalogPlan } from "@/convex/billing/validators";
import { SIGNUP_PLAN, TOPUP_PLAN } from "./plans";

const MONTHS_PER_INTERVAL: Record<string, number> = {
  week: 12 / 52,
  month: 1,
  quarter: 3,
  semi_annual: 6,
  year: 12,
};

/** A plan's price per month, so plans with different intervals compare. */
export function monthlyPrice(plan: CatalogPlan): number {
  if (!plan.price) return 0;
  return plan.price.amount / (MONTHS_PER_INTERVAL[plan.price.interval] ?? 1);
}

/** The plans a customer picks between, cheapest first. */
export function mainPlans(catalog: BillingCatalog): CatalogPlan[] {
  return catalog.plans
    .filter((plan) => !plan.addOn)
    .sort((a, b) => monthlyPrice(a) - monthlyPrice(b) || Number(b.autoEnable) - Number(a.autoEnable));
}

export function findPlan(catalog: BillingCatalog, id: string): CatalogPlan | undefined {
  return catalog.plans.find((plan) => plan.id === id);
}

/** The plan every customer starts on. */
export function defaultPlanId(catalog: BillingCatalog): string | undefined {
  return (mainPlans(catalog).find((plan) => plan.autoEnable) ?? mainPlans(catalog)[0])?.id;
}

/** Whether moving from `fromId` to `toId` costs more each month. */
export function isUpgrade(catalog: BillingCatalog, fromId: string, toId: string): boolean {
  const from = findPlan(catalog, fromId);
  const to = findPlan(catalog, toId);
  if (!to) return false;
  // Autumn charges a move to a longer billing interval at once, like an
  // upgrade, even when it's cheaper per month.
  const months = (plan?: CatalogPlan) =>
    plan?.price ? (MONTHS_PER_INTERVAL[plan.price.interval] ?? 1) : 0;
  if (from?.price && to.price && months(to) > months(from)) return true;
  return monthlyPrice(to) > (from ? monthlyPrice(from) : 0);
}

/** Credits a new customer receives once. */
export function signupCredits(catalog: BillingCatalog): number {
  return findPlan(catalog, SIGNUP_PLAN)?.credits?.included ?? 0;
}

/**
 * Most plan credits a customer can hold: the refill plus what may roll over,
 * or the signup credits on a plan without a refill.
 */
export function planCreditCap(catalog: BillingCatalog, planId: string): number {
  const credits = findPlan(catalog, planId)?.credits;
  if (!credits || credits.interval === "one_off") return signupCredits(catalog);
  return credits.included + (credits.rolloverMax ?? 0);
}

export type TopUpBundle = { credits: number; amount: number };

/**
 * The top-up amounts on offer. The plan's `bundles` metadata picks them;
 * without it, 1, 5 and 10 of its billing units.
 */
export function topUpBundles(catalog: BillingCatalog): TopUpBundle[] {
  const unitPrice = findPlan(catalog, TOPUP_PLAN)?.credits?.unitPrice;
  if (!unitPrice) return [];
  const amounts =
    findPlan(catalog, TOPUP_PLAN)?.bundles ??
    [1, 5, 10].map((units) => units * unitPrice.billingUnits);
  return amounts
    .filter((credits) => credits > 0 && credits % unitPrice.billingUnits === 0)
    .map((credits) => ({
      credits,
      amount: (credits / unitPrice.billingUnits) * unitPrice.amount,
    }));
}

/** Main plans that grant `featureId`, cheapest first. */
export function plansWithFeature(catalog: BillingCatalog, featureId: string): CatalogPlan[] {
  return mainPlans(catalog).filter((plan) => plan.features.includes(featureId));
}
