import type { MutationCtx } from "./_generated/server";
import type { OrganizationFeature } from "./organizationFeatures";

export async function seedOrganizationFeatures(
  ctx: MutationCtx,
  clerkUserIds: string[],
  features: Partial<Record<OrganizationFeature, boolean>>,
) {
  const key = crypto.randomUUID();
  const timestamps = {
    createdAt: 1,
    updatedAt: 1,
    clerkCreatedAt: 1,
    clerkUpdatedAt: 1,
  };
  const organizationId = await ctx.db.insert("organizations", {
    clerkOrganizationId: key,
    slug: key,
    name: "Feature test",
    state: "active",
    ...timestamps,
    evidenceLibrariesEnabled: features.evidenceLibraries === true,
    authorsEnabled: features.authors === true,
    extractionEnabled: features.extraction === true,
  });
  for (const clerkUserId of clerkUserIds)
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      clerkUserId,
      clerkMembershipId: `${key}-${clerkUserId}`,
      role: "org:member",
      state: "active",
      ...timestamps,
    });
  return organizationId;
}

export async function seedFeatureUser(ctx: MutationCtx, clerkId: string) {
  const existing = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", clerkId)).unique();
  return existing?._id ?? await ctx.db.insert("users", {
    clerkId, email: clerkId + "@example.org", state: "active", createdAt: 1, updatedAt: 1,
  });
}
