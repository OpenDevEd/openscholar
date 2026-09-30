import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";

export type OrganizationAction = "read" | "manage";
export type EvidenceLibraryAdminRole = "owner" | "editor" | "creator";
type OrganizationAccessCtx = Pick<QueryCtx | MutationCtx, "auth" | "db">;

function denyOrganizationAccess(): never {
  throw createError("FORBIDDEN", "Evidence Library access denied");
}

/** Pending invitations open the library list, but do not grant a library role. */
export async function readPendingLibraryInvitations(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  user: Doc<"users">,
) {
  if (user.state !== "active") return [];
  const invitations = await ctx.db.query("evidenceLibraryInvitations")
    .withIndex("by_email_and_state", q => q.eq("email", user.email.toLowerCase()).eq("state", "pending")).collect();
  const rows = await Promise.all(invitations.map(async invitation => {
    const library = await ctx.db.get("evidenceLibraries", invitation.libraryId);
    if (!library || library.state === "disabled") return null;
    const organization = await ctx.db.get("organizations", library.organizationId);
    if (organization?.state !== "active") return null;
    return { invitationId: invitation._id, libraryId: library._id, name: library.name, role: invitation.role, organization: { name: organization.name, imageUrl: organization.imageUrl ?? null } };
  }));
  return rows.filter(row => row !== null);
}

export async function hasDirectLibraryAccess(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  user: Doc<"users">,
) {
  if (user.state !== "active") return false;
  for await (const assignment of ctx.db.query("evidenceLibraryMembers")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", user.clerkId))) {
    const library = await ctx.db.get("evidenceLibraries", assignment.libraryId);
    if (library && await readLibraryRole(ctx, library, user.clerkId)) return true;
  }
  return (await readPendingLibraryInvitations(ctx, user)).length > 0;
}

/** The person's active membership of the organization, or null once they left it. */
export async function readActiveOrganizationMembership(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  organizationId: Id<"organizations">,
  clerkUserId: string,
) {
  return await ctx.db.query("organizationMemberships")
    .withIndex("by_organizationId_and_clerkUserId_and_state", q => q
      .eq("organizationId", organizationId).eq("clerkUserId", clerkUserId).eq("state", "active"))
    .unique();
}

/** Current library access does not depend on the active Clerk organization. */
export async function readLibraryRole(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  library: Doc<"evidenceLibraries">,
  clerkUserId: string,
): Promise<EvidenceLibraryAdminRole | null> {
  const user = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", clerkUserId)).unique();
  if (user?.state === "deleted") return null;
  const organization = await ctx.db.get("organizations", library.organizationId);
  if (!organization || organization.state !== "active") return null;
  const membership = await readActiveOrganizationMembership(ctx, library.organizationId, clerkUserId);
  if (membership?.role === "org:admin") return "owner";
  if (library.state === "disabled") return null;
  const assignment = await ctx.db.query("evidenceLibraryMembers")
    .withIndex("by_libraryId_and_clerkUserId", q => q.eq("libraryId", library._id).eq("clerkUserId", clerkUserId))
    .unique();
  if (!assignment) return null;
  return assignment.role;
}

export async function readEvidenceLibraryAccess(
  ctx: OrganizationAccessCtx,
  libraryId: Id<"evidenceLibraries">,
  action: OrganizationAction,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library) return null;
  const role = await readLibraryRole(ctx, library, identity.subject);
  if (!role || (action === "manage" && role !== "owner")) return null;
  const organization = await ctx.db.get("organizations", library.organizationId);
  if (!organization) return null;
  if (action === "manage" && organization.evidenceLibrariesEnabled !== true) return null;
  return { clerkUserId: identity.subject, organization, role, library };
}

export async function requireEvidenceLibraryAccess(ctx: OrganizationAccessCtx, libraryId: Id<"evidenceLibraries">, action: OrganizationAction) {
  if (!await ctx.auth.getUserIdentity()) throw createError("UNAUTHENTICATED", "Sign in to access this library");
  const access = await readEvidenceLibraryAccess(ctx, libraryId, action);
  if (!access) return denyOrganizationAccess();
  return access;
}
