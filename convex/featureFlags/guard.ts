import { requireOrganizationFeature } from "../organizationFeatures";
import type { MutationCtx, QueryCtx, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { resolveEffectivePlan } from "../../lib/billing/entitlements";
import { getPlanTier } from "../lib/constants";
import { createError } from "../lib/errors";
import { selectCanonicalSubscription } from "../subscriptions/lib/selectCanonicalSubscription";

/**
 * Assert that a feature flag is enabled for the given user.
 * For use in Convex queries and mutations (which have ctx.db access).
 *
 * Throws FEATURE_DISABLED if the flag is globally off.
 * Throws FEATURE_PLAN_REQUIRED if the user's tier is too low.
 */
export async function requireFeature(
  ctx: QueryCtx | MutationCtx,
  flagKey: string,
  userId?: Id<"users">,
): Promise<void> {
  const flag = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", flagKey))
    .unique();

  if (!flag || !flag.enabled) {
    throw createError("FEATURE_DISABLED", `Feature "${flagKey}" is disabled`);
  }

  if (flagKey === "extraction.enabled") await requireOrganizationFeature(ctx, "extraction");

  if (flag.minimumTier > 0) {
    if (!userId) {
      throw createError("UNAUTHENTICATED", "Authentication required for this feature");
    }

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    const canonical = selectCanonicalSubscription(subscriptions);
    const plan = resolveEffectivePlan(canonical);
    const tier = getPlanTier(plan);

    if (tier < flag.minimumTier) {
      throw createError(
        "FEATURE_PLAN_REQUIRED",
        `${flag.description || flagKey} requires a higher plan. Please upgrade to continue.`,
      );
    }
  }
}

/**
 * Assert that a feature flag is enabled for the given user.
 * For use in Convex actions (which use ctx.runQuery instead of ctx.db).
 *
 * Throws FEATURE_DISABLED if the flag is globally off.
 * Throws FEATURE_PLAN_REQUIRED if the user's tier is too low.
 */
export async function requireFeatureInAction(
  ctx: ActionCtx,
  flagKey: string,
  userId?: Id<"users">,
): Promise<void> {
  const result = await ctx.runQuery(internal.featureFlags.internal.checkFlag, {
    key: flagKey,
    userId,
  });

  if (!result.allowed) {
    if (result.reason === "disabled") {
      throw createError("FEATURE_DISABLED", `Feature "${flagKey}" is disabled`);
    }
    if (result.reason === "unauthenticated") {
      throw createError("UNAUTHENTICATED", "Authentication required for this feature");
    }
    if (result.reason === "insufficient_tier") {
      throw createError("FEATURE_PLAN_REQUIRED", `This feature requires a higher plan. Please upgrade to continue.`);
    }
  }
}

/**
 * Read the enabled/minimumTier of a single flag from the DB.
 * Returns null if the flag doesn't exist. Useful when the caller
 * needs the raw flag data (e.g. to pass pdfEnabled to getProcessableFlags).
 */
export async function getFlag(
  ctx: QueryCtx | MutationCtx,
  flagKey: string,
): Promise<{ enabled: boolean; minimumTier: number } | null> {
  const flag = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", flagKey))
    .unique();

  if (!flag) return null;
  return { enabled: flag.enabled, minimumTier: flag.minimumTier };
}
