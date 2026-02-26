import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { resolveEffectivePlan } from "../../lib/billing/entitlements";
import { getPlanTier } from "../lib/constants";
import { createError } from "../lib/errors";
import { selectCanonicalSubscription } from "../subscriptions/lib/selectCanonicalSubscription";

export function requireExtractionEnabled(): void {
  if (process.env.NEXT_PUBLIC_EXTRACTION_ENABLED === "false") {
    throw new Error("Extraction feature is disabled");
  }
}

export function requireExtractionPdfEnabled(): void {
  if (process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED === "false") {
    throw createError("FORBIDDEN", "PDF processing is disabled");
  }
}

/**
 * Asserts that the given user holds at least `minTier`.
 * Mutations have direct `ctx.db` access, so we can query inline.
 */
export async function requirePlanTier(
  ctx: MutationCtx,
  userId: Id<"users">,
  minTier: number,
  featureName: string
): Promise<void> {
  const subscriptions = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .collect();

  const canonical = selectCanonicalSubscription(subscriptions);
  const plan = resolveEffectivePlan(canonical);
  const tier = getPlanTier(plan);

  if (tier < minTier) {
    throw createError(
      "EXTRACTION_PLAN_REQUIRED",
      `${featureName} requires a higher plan. Please upgrade to continue.`
    );
  }
}

/** Shorthand: requires Go plan (tier ≥ 10). */
export async function requireGoPlan(
  ctx: MutationCtx,
  userId: Id<"users">,
  featureName: string
): Promise<void> {
  return requirePlanTier(ctx, userId, 10, featureName);
}

/** Shorthand: requires Pro plan (tier ≥ 20). */
export async function requireProPlan(
  ctx: MutationCtx,
  userId: Id<"users">,
  featureName: string
): Promise<void> {
  return requirePlanTier(ctx, userId, 20, featureName);
}
