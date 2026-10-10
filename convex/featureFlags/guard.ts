import { requireOrganizationFeature } from "../organizationFeatures";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { hasPlanFeature } from "../billing/accounts";
import { PLAN_FEATURES } from "../../lib/billing/plans";
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
  workspaceId?: Id<"workspaces">,
): Promise<void> {
  const flag = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", flagKey))
    .unique();

  if (!flag || !flag.enabled) {
    throw createError("FEATURE_DISABLED", `Feature "${flagKey}" is disabled`);
  }

  if (flagKey === "extraction.enabled") await requireOrganizationFeature(ctx, "extraction", userId);
  // Starting one is the workspace's to do: its plan grants extraction (#652). A Team organization's member doesn't take it into a workspace whose plan has none.
  if (flagKey === "extraction.start" && workspaceId !== undefined && !(await hasPlanFeature(ctx, workspaceId, PLAN_FEATURES.extraction))) {
    throw createError("FEATURE_PLAN_REQUIRED", "Data extraction isn't included in this workspace's plan.");
  }

  if (flag.planFeature) {
    if (!userId) {
      throw createError("UNAUTHENTICATED", "Authentication required for this feature");
    }
    // The plan of the workspace they act in grants it, as Team does for an organization's members (#652),
    // or their own workspace's plan, as before: features come from the acting workspace's plan alone once
    // the organizations whose features were switched on by hand have moved to plans.
    const own = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
    const granted = (workspaceId !== undefined && (await hasPlanFeature(ctx, workspaceId, flag.planFeature))) || (own !== null && (await hasPlanFeature(ctx, own._id, flag.planFeature)));
    if (!granted) {
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
