import { paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";
import { createError } from "./lib/errors";
import { MAX_ORGANIZATIONS_PER_PERSON } from "./lib/queryBounds";
import { hasDirectLibraryAccess } from "./evidenceLibraries/access";

export const organizationFeatureFields = {
  evidenceLibraries: v.boolean(),
  authors: v.boolean(),
  extraction: v.boolean(),
};
export type OrganizationFeature = keyof typeof organizationFeatureFields;
type FeatureAccess = Record<OrganizationFeature, boolean>;

/** The same active memberships drive feature access and organization pickers. */
export async function readMemberOrganizations(ctx: QueryCtx | MutationCtx, person?: Doc<"users"> | null) {
  const user = person ?? (await getCurrentUser(ctx));
  if (!user) return [];
  const memberships = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_clerkUserId_and_state", (q) =>
      q.eq("clerkUserId", user.clerkId).eq("state", "active"),
    )
    .take(MAX_ORGANIZATIONS_PER_PERSON + 1);
  // Clerk's webhooks write memberships, so no write here can refuse one more.
  if (memberships.length > MAX_ORGANIZATIONS_PER_PERSON) {
    throw createError("VALIDATION_ERROR", `This account belongs to more than ${MAX_ORGANIZATIONS_PER_PERSON} organizations, more than OpenScholar reads. Leave some to continue.`);
  }
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
  person?: Doc<"users"> | null,
): Promise<FeatureAccess> {
  const access: FeatureAccess = {
    evidenceLibraries: false,
    authors: false,
    extraction: false,
  };
  for (const { organization } of await readMemberOrganizations(ctx, person)) {
    access.evidenceLibraries ||= organization.evidenceLibrariesEnabled === true;
    access.authors ||= organization.authorsEnabled === true;
    access.extraction ||= organization.extractionEnabled === true;
  }
  if (!access.evidenceLibraries) {
    const user = person ?? (await getCurrentUser(ctx));
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

/** Refuses unless one of the person's organizations has the feature: `userId`'s when the assistant acts for them, else the signed-in person's. */
export async function requireOrganizationFeature(
  ctx: QueryCtx | MutationCtx,
  feature: OrganizationFeature,
  userId?: Id<"users">,
) {
  const person = userId ? await ctx.db.get("users", userId) : null;
  if (!person && !(await ctx.auth.getUserIdentity()))
    throw createError("UNAUTHENTICATED", "Authentication required");
  if (!(await readOrganizationFeatures(ctx, person))[feature]) {
    throw createError(
      "FORBIDDEN",
      "None of your organizations has this feature enabled.",
    );
  }
}

export const get = query({
  args: {},
  returns: v.object(organizationFeatureFields),
  handler: (ctx) => readOrganizationFeatures(ctx),
});

const libraryOrganizationValidator = v.object({
  id: v.id("organizations"),
  name: v.string(),
  imageUrl: v.optional(v.string()),
});

/** The organizations the person may create a library in, by name. */
const libraryOrganizationsOf = async (ctx: QueryCtx) =>
  (await readLibraryOrganizations(ctx))
    .map(({ organization }) => ({
      id: organization._id,
      name: organization.name,
      imageUrl: organization.imageUrl,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

/**
 * The organizations the person may create a library in, as one page: a person's organizations
 * are read up to MAX_ORGANIZATIONS_PER_PERSON, and an account in more is refused.
 */
export const listLibraryOrganizations = query({
  args: {},
  returns: paginationResultValidator(libraryOrganizationValidator),
  handler: async (ctx) => ({ page: await libraryOrganizationsOf(ctx), isDone: true, continueCursor: "" }),
});

/** Kept for one release, while the deployed site still calls it; `listLibraryOrganizations` replaces it. */
export const libraryOrganizations = query({
  args: {},
  returns: v.array(libraryOrganizationValidator),
  handler: libraryOrganizationsOf,
});
