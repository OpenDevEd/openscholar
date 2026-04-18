/**
 * Plan-aware knobs for the extraction bucket.
 *
 *  - `PAPER_LIMIT_BY_PLAN`       — total ready-items allowed across the
 *                                  whole bucket (per-job ceiling).
 *  - `PAPER_PULL_CAP_BY_PLAN`    — maximum papers a single history entry
 *                                  can pull from OpenAlex on submit.
 *                                  Today 200 everywhere — the SDK's
 *                                  single-page ceiling without cursor
 *                                  pagination (lifted in P8).
 *  - `PAPER_PULL_DEFAULT_BY_PLAN`— default stepper value for the CountChip
 *                                  when a history row is first selected.
 *                                  Always clamped to cap at read time so
 *                                  a drift in config never lets the
 *                                  default outrun the cap.
 *
 * Three paired entry points mirror the pattern:
 *  - `getPaperLimit / getPaperPullCap / getPaperPullDefault` — QueryCtx-
 *    scoped helpers.
 *  - `getPaperLimitForUser / getPaperPullCapForUser / getPaperPullDefaultForUser`
 *    — `internalQuery` wrappers so actions can round-trip.
 *
 * `PAPER_LIMIT_MAX` is the hard ceiling across all plans; used by
 * internal sweeps that span users (cascade delete, storage GC) where a
 * per-user plan lookup doesn't apply.
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
import {
  effectivePaperCount,
  findOverPullCapIndex,
  type EffectiveCountItem,
} from "../../../lib/bucket/effective-paper-count";
import { createError } from "../../lib/errors";

export const PAPER_LIMIT_BY_PLAN: Record<SubscriptionPlan, number> = {
  free: 1000,
  go: 1000,
  pro: 1000,
  enterprise: 1000,
};

export const PAPER_LIMIT_MAX = Math.max(
  ...Object.values(PAPER_LIMIT_BY_PLAN),
);

export const PAPER_PULL_CAP_BY_PLAN: Record<SubscriptionPlan, number> = {
  free: 200,
  go: 200,
  pro: 200,
  enterprise: 200,
};

export const PAPER_PULL_DEFAULT_BY_PLAN: Record<SubscriptionPlan, number> = {
  free: 200,
  go: 200,
  pro: 200,
  enterprise: 200,
};

async function resolvePlan(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<SubscriptionPlan> {
  const subscriptions = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .collect();
  return resolveEffectivePlan(selectCanonicalSubscription(subscriptions));
}

export async function getPaperLimit(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const plan = await resolvePlan(ctx, userId);
  return PAPER_LIMIT_BY_PLAN[plan];
}

export async function getPaperPullCap(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const plan = await resolvePlan(ctx, userId);
  return PAPER_PULL_CAP_BY_PLAN[plan];
}

export async function getPaperPullDefault(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const plan = await resolvePlan(ctx, userId);
  const cap = PAPER_PULL_CAP_BY_PLAN[plan];
  const raw = PAPER_PULL_DEFAULT_BY_PLAN[plan];
  // `default ≤ cap` invariant enforced at read time so config drift never
  // leaks a too-high default to the client.
  return Math.min(raw, cap);
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

export const getPaperPullCapForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    return await getPaperPullCap(ctx, args.userId);
  },
});

export const getPaperPullDefaultForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    return await getPaperPullDefault(ctx, args.userId);
  },
});

/**
 * Single-source-of-truth pre-flight validation for any mutation that
 * accepts a user-supplied bucket. Enforces both:
 *
 *  1. Per-row pull cap — no history row may request more than `pullCap`
 *     papers via `searchFilters.limit`. Catches crafted requests that
 *     try to bypass the row-count limit by inflating one row's expansion.
 *  2. Plan-level paper cap — the post-expansion sum (history rows count
 *     their `searchFilters.limit`, others count 1) must fit the user's
 *     plan. Catches crafted requests that multiply rows × per-row limit
 *     past the row-count cap.
 *
 * Throws the project-standard `VALIDATION_ERROR` so callers don't have
 * to handle it. Returns the resolved plan limit so the caller can reuse
 * the value (e.g., for downstream `take(limit)` queries).
 */
export async function assertBucketWithinLimits(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  items: ReadonlyArray<EffectiveCountItem>,
): Promise<{ paperLimit: number; pullCap: number; effectiveCount: number }> {
  const [paperLimit, pullCap] = await Promise.all([
    getPaperLimit(ctx, userId),
    getPaperPullCap(ctx, userId),
  ]);

  const overIndex = findOverPullCapIndex(items, pullCap);
  if (overIndex !== -1) {
    throw createError(
      "VALIDATION_ERROR",
      `Bucket row ${overIndex} requests more than the per-row pull cap of ${pullCap} papers`,
    );
  }

  const count = effectivePaperCount(items, pullCap);
  if (count > paperLimit) {
    throw createError(
      "VALIDATION_ERROR",
      `Bucket would produce ${count} papers, exceeding plan limit of ${paperLimit}`,
    );
  }

  return { paperLimit, pullCap, effectiveCount: count };
}
