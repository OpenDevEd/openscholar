/**
 * Sharing a community with an organization (#1091): every active member of it, its admins included, has
 * the role it was given, and loses it on leaving the organization or once its owners take it away. An
 * owner shares it straight away with an organization they're an admin of; any other's admin is invited by
 * email (./invitations.ts) and picks which of their organizations gets it on accepting.
 */
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query, type MutationCtx } from "../lib/functions";
import { createError } from "../lib/errors";
import { getCurrentUser } from "../lib/auth";
import { paginationResultValidator } from "convex/server";
import { refuseApps } from "../lib/auth";
import { MAX_ORGANIZATION_GRANTS_PER_LIBRARY } from "../lib/queryBounds";
import { readMemberOrganizations } from "../organizationFeatures";
import { libraryOwner, organizationGrantsOf, readActiveOrganizationMembership, requireEvidenceLibraryAccess } from "./access";

const roleValidator = v.union(v.literal("editor"), v.literal("creator"));
const grantArgs = { libraryId: v.id("evidenceLibraries"), organizationId: v.id("organizations"), role: roleValidator };
const removeArgs = { libraryId: v.id("evidenceLibraries"), organizationId: v.id("organizations") };

const grantOf = (ctx: Pick<MutationCtx, "db">, libraryId: Id<"evidenceLibraries">, organizationId: Id<"organizations">) =>
  ctx.db.query("libraryOrganizationGrants").withIndex("by_library_and_organization", (q) => q.eq("libraryId", libraryId).eq("organizationId", organizationId)).unique();

/**
 * Gives an organization its role in a community, or a better one than it has: `by` is an admin of it, who
 * shares it from the community or accepts an invitation for it. Its own organization owns it already.
 */
export async function giveOrganization(ctx: MutationCtx, library: Doc<"evidenceLibraries">, organizationId: Id<"organizations">, role: "editor" | "creator", by: Doc<"users">) {
  const organization = await ctx.db.get("organizations", organizationId);
  if (organization?.state !== "active" || (await readActiveOrganizationMembership(ctx, organizationId, by.clerkId))?.role !== "org:admin") {
    throw createError("FORBIDDEN", "Only an organization's admins can take a community for it.");
  }
  if ((await libraryOwner(ctx, library))?.organization?._id === organizationId) throw createError("CONFLICT", `${organization.name} owns this community already.`);
  const existing = await grantOf(ctx, library._id, organizationId);
  if (existing) {
    if (existing.role !== "editor" && role === "editor") await ctx.db.patch("libraryOrganizationGrants", existing._id, { role });
    return;
  }
  if ((await organizationGrantsOf(ctx, library._id)).length >= MAX_ORGANIZATION_GRANTS_PER_LIBRARY) {
    throw createError("VALIDATION_ERROR", `A community can be shared with up to ${MAX_ORGANIZATION_GRANTS_PER_LIBRARY} organizations. Remove one to add another.`);
  }
  await ctx.db.insert("libraryOrganizationGrants", { libraryId: library._id, organizationId, role, grantedBy: by._id, grantedAt: Date.now() });
}

/** Shares a community with an organization its owner is an admin of. */
export const grant = mutation({
  args: grantArgs,
  returns: v.null(),
  handler: async (ctx, { libraryId, organizationId, role }) => {
    await refuseApps(ctx);
    const access = await requireEvidenceLibraryAccess(ctx, libraryId, "manage");
    const user = await getCurrentUser(ctx);
    if (!user) throw createError("UNAUTHENTICATED", "Sign in to share this community");
    if (await grantOf(ctx, libraryId, organizationId)) throw createError("CONFLICT", "This organization has access already.");
    await giveOrganization(ctx, access.library, organizationId, role, user);
    return null;
  },
});

/** Changes the role a community gives an organization it's shared with. */
export const changeRole = mutation({
  args: grantArgs,
  returns: v.null(),
  handler: async (ctx, { libraryId, organizationId, role }) => {
    await refuseApps(ctx);
    await requireEvidenceLibraryAccess(ctx, libraryId, "manage");
    const existing = await grantOf(ctx, libraryId, organizationId);
    if (!existing) throw createError("NOT_FOUND", "This organization has no access.");
    await ctx.db.patch("libraryOrganizationGrants", existing._id, { role });
    return null;
  },
});

/** Stops sharing a community with an organization: its members keep only what they were given themselves. */
export const remove = mutation({
  args: removeArgs,
  returns: v.null(),
  handler: async (ctx, { libraryId, organizationId }) => {
    await refuseApps(ctx);
    await requireEvidenceLibraryAccess(ctx, libraryId, "manage");
    const existing = await grantOf(ctx, libraryId, organizationId);
    if (existing) await ctx.db.delete("libraryOrganizationGrants", existing._id);
    return null;
  },
});

/** The organizations the signed-in owner can share the community with straight away: those they're an admin of that don't own it or have it. */
export const grantable = query({
  args: { libraryId: v.id("evidenceLibraries") },
  // One page: a person is in at most MAX_ORGANIZATIONS_PER_PERSON organizations, which reading them enforces.
  returns: paginationResultValidator(v.object({ organizationId: v.id("organizations"), workspaceId: v.union(v.id("workspaces"), v.null()), name: v.string(), imageUrl: v.union(v.string(), v.null()), colour: v.union(v.string(), v.null()) })),
  handler: async (ctx, { libraryId }) => {
    const access = await requireEvidenceLibraryAccess(ctx, libraryId, "manage");
    const granted = new Set((await organizationGrantsOf(ctx, libraryId)).map((row) => row.organizationId));
    const theirs = (await readMemberOrganizations(ctx)).filter(({ membership, organization }) => membership.role === "org:admin" && organization._id !== access.organization?._id && !granted.has(organization._id));
    const page = await Promise.all(theirs.map(async ({ organization }) => ({
      organizationId: organization._id,
      workspaceId: (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organization._id)).unique())?._id ?? null,
      name: organization.name, imageUrl: organization.imageUrl ?? null, colour: organization.colour ?? null,
    })));
    return { page: page.sort((a, b) => a.name.localeCompare(b.name)), isDone: true, continueCursor: "" };
  },
});
