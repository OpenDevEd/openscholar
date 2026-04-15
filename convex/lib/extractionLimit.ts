import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { EXTRACTION_LIMITS_BY_TIER } from "./queryBounds";
import { resolveEffectivePlan } from "../../lib/billing/entitlements";
import { selectCanonicalSubscription } from "../subscriptions/lib/selectCanonicalSubscription";

/**
 * Resolve the extraction paper limit for a specific user based on their subscription plan.
 *
 * Uses the same subscription resolution chain as getTier:
 * 1. Fetch all subscriptions for the user (cardinality: ~1-5)
 * 2. Select canonical subscription via priority logic
 * 3. Resolve effective plan (handles canceled, trialing, past_due)
 * 4. Look up plan's limit in EXTRACTION_LIMITS_BY_TIER
 *
 * Returns the per-job paper limit for the user's effective plan.
 */
export async function getExtractionLimitForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const subscriptions = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .collect();

  const subscription = selectCanonicalSubscription(subscriptions);
  const plan = resolveEffectivePlan(subscription);
  return EXTRACTION_LIMITS_BY_TIER[plan];
}
