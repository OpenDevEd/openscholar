import { requireOrganizationFeature } from "../organizationFeatures";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { hasPlanFeature } from "../billing/accounts";
import { createError } from "../lib/errors";

/**
 * Asserts that a feature flag is on for the user.
 *
 * Throws FEATURE_DISABLED if the flag is off everywhere.
 * Throws FEATURE_PLAN_REQUIRED if the flag names a plan feature and the
 * user's plan in Autumn doesn't grant it.
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

  if (flag.planFeature) {
    if (!userId) {
      throw createError("UNAUTHENTICATED", "Authentication required for this feature");
    }
    if (!(await hasPlanFeature(ctx, userId, flag.planFeature))) {
      throw createError(
        "FEATURE_PLAN_REQUIRED",
        `${flag.description || flagKey} isn't included in your plan. Upgrade to continue.`,
      );
    }
  }
}

/** Whether a flag is on everywhere, ignoring plan features. Null if it doesn't exist. */
export async function getFlag(
  ctx: QueryCtx | MutationCtx,
  flagKey: string,
): Promise<{ enabled: boolean } | null> {
  const flag = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", flagKey))
    .unique();
  return flag ? { enabled: flag.enabled } : null;
}
