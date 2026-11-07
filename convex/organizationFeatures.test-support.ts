import type { MutationCtx } from "./_generated/server";
import { grantPlanFeaturesForTest } from "./billing/billing.test-support";
import { EVIDENCE_LIBRARIES_FEATURE } from "../lib/billing/plans";
import { getCurrentUser } from "./lib/auth";
import { createsIn, readMemberOrganizations } from "./organizationFeatures";
import { ensureWorkspace } from "./workspaces/create";

/** An organization with these members, on a plan that includes Evidence Libraries when asked. */
export async function seedOrganizationFeatures(
  ctx: MutationCtx,
  clerkUserIds: string[],
  features: { evidenceLibraries?: boolean },
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
  });
  // What the organization's plan includes (#652).
  if (features.evidenceLibraries) await grantPlanFeaturesForTest(ctx, organizationId, [EVIDENCE_LIBRARIES_FEATURE]);
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

/**
 * The first of the signed-in person's organizations they may create a community in, its workspace
 * made if the test hasn't, as the organization's webhook makes it in a deployment.
 */
export async function creatableWorkspaceIn(ctx: MutationCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("No signed-in test user");
  for (const { organization } of await readMemberOrganizations(ctx, user)) {
    const workspaceId = await ensureWorkspace(ctx, { kind: "organization", organizationId: organization._id });
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (workspace && (await createsIn(ctx, user, workspace))) return workspaceId;
  }
  throw new Error("No workspace this test user can create a community in");
}

export const creatableWorkspace = (as: { run: <T>(fn: (ctx: MutationCtx) => Promise<T>) => Promise<T> }) => as.run(creatableWorkspaceIn);
