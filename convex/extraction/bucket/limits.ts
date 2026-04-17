/**
 * Per-job paper cap. Plan-aware via `PAPER_LIMIT_BY_PLAN`; today every
 * plan maps to the same value, but the helper indirection lets us lift
 * enterprise (or lower the free tier) without touching every callsite.
 *
 * Two public entry points:
 *  - `getPaperLimit(ctx, userId)` — user-scoped QueryCtx / MutationCtx
 *  - `PAPER_LIMIT_MAX` — hard ceiling across all plans; used by
 *    internal sweeps that span users (cascade delete, storage GC)
 *    where a per-user plan lookup doesn't apply.
 */
import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import {
  resolveEffectivePlan,
  type SubscriptionPlan,
} from "../../../lib/billing/entitlements";
import { selectCanonicalSubscription } from "../../subscriptions/lib/selectCanonicalSubscription";

export const PAPER_LIMIT_BY_PLAN: Record<SubscriptionPlan, number> = {
  free: 1000,
  go: 1000,
  pro: 1000,
  enterprise: 1000,
};

export const PAPER_LIMIT_MAX = Math.max(
  ...Object.values(PAPER_LIMIT_BY_PLAN),
);

export async function getPaperLimit(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const subscriptions = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .collect();
  const canonical = selectCanonicalSubscription(subscriptions);
  const plan = resolveEffectivePlan(canonical);
  return PAPER_LIMIT_BY_PLAN[plan];
}

/**
 * ActionCtx-friendly entry point. Actions can't touch ctx.db directly,
 * so they round-trip through this internal query.
 */
export const getPaperLimitForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    return await getPaperLimit(ctx, args.userId);
  },
});
