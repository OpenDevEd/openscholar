import { paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { opensLibraries } from "./billing/accounts";
import { getCurrentUser } from "./lib/auth";
import { createError } from "./lib/errors";
import { MAX_ORGANIZATIONS_PER_PERSON } from "./lib/queryBounds";
import { hasDirectLibraryAccess } from "./evidenceLibraries/access";
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
    throw createError("VALIDATION_ERROR", `This account belongs to more than ${MAX_ORGANIZATIONS_PER_PERSON} organizations, more than Openscholar reads. Leave some to continue.`);
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

/** Whether an organization's workspace opens Evidence Libraries. */
async function planGrants(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">) {
  const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique();
  return workspace !== null && (await opensLibraries(ctx, workspace._id));
}

/**
 * Whether the workspace a person acts in opens Evidence Libraries for them: it has them
 * (`opensLibraries`), or, in their own workspace, a library of another's was shared with them. A plan is its
 * workspace's alone: one of their organizations' opens nothing in another, nor in their own.
 */
export async function opensEvidenceLibraries(ctx: QueryCtx | MutationCtx, { userId, workspaceId }: InWorkspace) {
  if (await opensLibraries(ctx, workspaceId)) return true;
  if ((await ctx.db.get("workspaces", workspaceId))?.kind !== "personal") return false;
  const user = await ctx.db.get("users", userId);
  return user !== null && (await hasDirectLibraryAccess(ctx, user));
}

/** The organizations the person may create a library in: those they're an admin of that have Evidence Libraries. */
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
    throw createError("UNAUTHENTICATED", "Sign in to create a community.");
  const entry = (await readLibraryOrganizations(ctx)).find(
    (row) => row.organization._id === organizationId,
  );
  if (!entry)
    throw createError(
      "FORBIDDEN",
      "Choose an organization you're an admin of that has Evidence Communities.",
    );
  return { ...entry, clerkUserId: entry.membership.clerkUserId };
}

/**
 * What the workspace the page is in opens for the person: Evidence Libraries (see
 * `opensEvidenceLibraries`), and the managing of author profiles, which takes them in the workspace itself.
 */
export const opens = workspaceQuery({
  args: {},
  returns: v.object({ evidenceLibraries: v.boolean(), authors: v.boolean() }),
  signedOut: { evidenceLibraries: false, authors: false },
  handler: async (ctx, actor) => {
    const authors = await opensLibraries(ctx, actor.workspaceId);
    return { authors, evidenceLibraries: authors || (await opensEvidenceLibraries(ctx, actor)) };
  },
});

/**
 * What a page loaded before 2026-10-10 is told: it asks without a workspace and reads three
 * answers. A tab left open keeps what it showed, in place of failing when this deployed: Evidence
 * Libraries and authors where any of the person's organizations has them, extraction always.
 * `get` goes once those tabs are gone.
 */
async function openedBefore(ctx: QueryCtx, user: Doc<"users">) {
  for (const { organization } of await readMemberOrganizations(ctx, user)) if (await planGrants(ctx, organization._id)) return true;
  return await hasDirectLibraryAccess(ctx, user);
}

export const get = query({
  args: {},
  returns: v.object({ evidenceLibraries: v.boolean(), authors: v.boolean(), extraction: v.boolean() }),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const libraries = user !== null && (await openedBefore(ctx, user));
    return { evidenceLibraries: libraries, authors: libraries, extraction: true };
  },
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
