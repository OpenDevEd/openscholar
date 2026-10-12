import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { hasPlanFeature } from "../billing/accounts";
import { createError } from "../lib/errors";

/**
 * Asserts that a feature flag is on for the user.
 *
 * Throws FEATURE_DISABLED if the flag is off everywhere.
 * Throws FEATURE_PLAN_REQUIRED if the flag names a plan feature and the plan of
 * the workspace they act in doesn't grant it: `workspaceId`, or their own when
 * none is given. A plan is one workspace's: a person's own grants nothing in an
 * organization, nor an organization's in its members' own workspaces.
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

  if (flag.planFeature) {
    if (!userId) {
      throw createError("UNAUTHENTICATED", "Authentication required for this feature");
    }
    const acting = workspaceId ?? (await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique())?._id;
    if (!acting || !(await hasPlanFeature(ctx, acting, flag.planFeature))) {
      throw createError(
        "FEATURE_PLAN_REQUIRED",
        `${flag.description || flagKey} isn't included in this workspace's plan. Upgrade to continue.`,
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
