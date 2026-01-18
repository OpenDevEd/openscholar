import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

/**
 * Resolve owner ID and type from user and optional organization ID
 */
export function resolveOwner(
  user: Doc<"users">,
  organizationId?: Id<"organizations">
): { ownerId: string; ownerType: "user" | "organization" } {
  return {
    ownerId: organizationId ?? user._id,
    ownerType: organizationId ? "organization" : "user",
  };
}

/**
 * Get credits record for a given owner
 */
export async function getCreditsForOwner(
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
  ownerType: "user" | "organization"
): Promise<Doc<"credits"> | null> {
  return await ctx.db
    .query("credits")
    .withIndex("by_owner", (q) =>
      q.eq("ownerId", ownerId).eq("ownerType", ownerType)
    )
    .unique();
}

/**
 * Get subscription record for a given owner
 */
export async function getSubscriptionForOwner(
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
  ownerType: "user" | "organization"
): Promise<Doc<"subscriptions"> | null> {
  return await ctx.db
    .query("subscriptions")
    .withIndex("by_owner", (q) =>
      q.eq("ownerId", ownerId).eq("ownerType", ownerType)
    )
    .unique();
}
