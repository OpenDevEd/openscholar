import { paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { hasPlanFeature } from "./billing/accounts";
import { getCurrentUser } from "./lib/auth";
import { createError } from "./lib/errors";
import { MAX_ORGANIZATIONS_PER_PERSON } from "./lib/queryBounds";
import { hasDirectLibraryAccess } from "./evidenceLibraries/access";
import { EVIDENCE_LIBRARIES_FEATURE } from "../lib/billing/plans";
import { workspaceQuery } from "./lib/userActions";
import type { InWorkspace } from "./workspaces/actor";

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

/** Whether the plan of an organization's workspace includes Evidence Libraries. */
async function planGrants(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">) {
  const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique();
  return workspace !== null && (await hasPlanFeature(ctx, workspace._id, EVIDENCE_LIBRARIES_FEATURE));
}

/**
 * Whether the workspace a person acts in opens Evidence Libraries for them: its plan includes
 * them, or, in their own workspace, a library of another's was shared with them. A plan is its
 * workspace's alone: one of their organizations' opens nothing in another, nor in their own.
 */
export async function opensEvidenceLibraries(ctx: QueryCtx | MutationCtx, { userId, workspaceId }: InWorkspace) {
  if (await hasPlanFeature(ctx, workspaceId, EVIDENCE_LIBRARIES_FEATURE)) return true;
  if ((await ctx.db.get("workspaces", workspaceId))?.kind !== "personal") return false;
  const user = await ctx.db.get("users", userId);
  return user !== null && (await hasDirectLibraryAccess(ctx, user));
}

/** The organizations the person may create a library in: those they're an admin of whose plan includes Evidence Libraries. */
export async function readLibraryOrganizations(ctx: QueryCtx | MutationCtx) {
  const admin = (await readMemberOrganizations(ctx)).filter(({ membership }) => membership.role === "org:admin");
  const granted = await Promise.all(admin.map(({ organization }) => planGrants(ctx, organization._id)));
  return admin.filter((_, i) => granted[i]);
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
      "Choose an organization you're an admin of whose plan includes Evidence Libraries.",
    );
  return { ...entry, clerkUserId: entry.membership.clerkUserId };
}

/** What the workspace the page is in opens for the person. */
export const get = workspaceQuery({
  args: {},
  returns: v.object({ evidenceLibraries: v.boolean() }),
  signedOut: { evidenceLibraries: false },
  handler: async (ctx, actor) => ({ evidenceLibraries: await opensEvidenceLibraries(ctx, actor) }),
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
