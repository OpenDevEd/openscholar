import { v } from "convex/values";
import { query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";
import { createError } from "./lib/errors";
import { hasDirectLibraryAccess } from "./evidenceLibraries/access";

export const organizationFeatureFields = {
  evidenceLibraries: v.boolean(),
  authors: v.boolean(),
  extraction: v.boolean(),
};
export type OrganizationFeature = keyof typeof organizationFeatureFields;
type FeatureAccess = Record<OrganizationFeature, boolean>;

/** The same active memberships drive feature access and organization pickers. */
export async function readMemberOrganizations(ctx: QueryCtx | MutationCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) return [];
  const memberships = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_clerkUserId_and_state", (q) =>
      q.eq("clerkUserId", user.clerkId).eq("state", "active"),
    )
    .collect();
  const rows = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      organization: await ctx.db.get(
        "organizations",
        membership.organizationId,
      ),
    })),
  );
  return rows.flatMap(({ membership, organization }) =>
    organization?.state === "active" ? [{ membership, organization }] : [],
  );
}

export async function readOrganizationFeatures(
  ctx: QueryCtx | MutationCtx,
): Promise<FeatureAccess> {
  const access: FeatureAccess = {
    evidenceLibraries: false,
    authors: false,
    extraction: false,
  };
  for (const { organization } of await readMemberOrganizations(ctx)) {
    access.evidenceLibraries ||= organization.evidenceLibrariesEnabled === true;
    access.authors ||= organization.authorsEnabled === true;
    access.extraction ||= organization.extractionEnabled === true;
  }
  if (!access.evidenceLibraries) {
    const user = await getCurrentUser(ctx);
    access.evidenceLibraries = user !== null && await hasDirectLibraryAccess(ctx, user);
  }
  return access;
}

export async function readLibraryOrganizations(ctx: QueryCtx | MutationCtx) {
  return (await readMemberOrganizations(ctx)).filter(
    ({ membership, organization }) =>
      membership.role === "org:admin" &&
      organization.evidenceLibrariesEnabled === true,
  );
}

export async function requireLibraryOrganization(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
) {
  if (!(await ctx.auth.getUserIdentity()))
    throw createError("UNAUTHENTICATED", "Sign in to create a library.");
  const entry = (await readLibraryOrganizations(ctx)).find(
    (row) => row.organization._id === organizationId,
  );
  if (!entry)
    throw createError(
      "FORBIDDEN",
      "Choose an organization you own with Evidence Libraries enabled.",
    );
  return { ...entry, clerkUserId: entry.membership.clerkUserId };
}

export async function requireOrganizationFeature(
  ctx: QueryCtx | MutationCtx,
  feature: OrganizationFeature,
) {
  if (!(await ctx.auth.getUserIdentity()))
    throw createError("UNAUTHENTICATED", "Authentication required");
  if (!(await readOrganizationFeatures(ctx))[feature]) {
    throw createError(
      "FORBIDDEN",
      "None of your organizations has this feature enabled.",
    );
  }
}

export const get = query({
  args: {},
  returns: v.object(organizationFeatureFields),
  handler: readOrganizationFeatures,
});

export const libraryOrganizations = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("organizations"),
      name: v.string(),
      imageUrl: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) =>
    (await readLibraryOrganizations(ctx))
      .map(({ organization }) => ({
        id: organization._id,
        name: organization.name,
        imageUrl: organization.imageUrl,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
});
