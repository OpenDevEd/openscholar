import { MAX_LIBRARY_GRANTS_PER_PERSON, MAX_PENDING_INVITATIONS_PER_EMAIL } from "../lib/queryBounds";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";

export type OrganizationAction = "read" | "manage";
export type EvidenceLibraryAdminRole = "owner" | "editor" | "creator";
type OrganizationAccessCtx = Pick<QueryCtx | MutationCtx, "auth" | "db">;

function denyOrganizationAccess(): never {
  throw createError("FORBIDDEN", "Evidence Library access denied");
}

/**
 * Who a library belongs to (#650): its workspace, and the organization behind it when that's
 * an organization's. Null for a library its workspace's backfill hasn't reached, which no one
 * opens until it has.
 */
export async function libraryOwner(ctx: Pick<QueryCtx, "db">, library: Doc<"evidenceLibraries">) {
  const workspace = library.workspaceId ? await ctx.db.get("workspaces", library.workspaceId) : null;
  if (!workspace) return null;
  return {
    workspace,
    organization: workspace.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null,
    person: workspace.kind === "personal" ? await ctx.db.get("users", workspace.userId) : null,
  };
}
export type LibraryOwner = NonNullable<Awaited<ReturnType<typeof libraryOwner>>>;

/** The workspace a library is in, which every one has once its backfill has run. */
export function requireLibraryWorkspace(library: Doc<"evidenceLibraries">) {
  if (!library.workspaceId) throw createError("CONFLICT", "This library isn't in a workspace yet. Try again in a moment.");
  return library.workspaceId;
}

/** The name a library's owner goes by: its organization's, or the person's whose own workspace it's in. */
export async function ownerName(ctx: Pick<QueryCtx, "db">, owner: LibraryOwner) {
  if (owner.organization) return { name: owner.organization.name, imageUrl: owner.organization.imageUrl ?? null };
  const person = owner.person;
  return { name: [person?.firstName, person?.lastName].filter(Boolean).join(" ") || (person?.email ?? ""), imageUrl: person?.avatarUrl ?? null };
}

/** Whether the library's owner is still there: an active organization, or the active account whose own workspace it's in. */
export const ownerActive = (owner: LibraryOwner | null) => owner !== null && (owner.workspace.kind === "personal" ? owner.person?.state === "active" : owner.organization?.state === "active");

/** Pending invitations open the library list, but do not grant a library role. */
export async function readPendingLibraryInvitations(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  user: Doc<"users">,
) {
  if (user.state !== "active") return [];
  const invitations = await ctx.db.query("evidenceLibraryInvitations")
    .withIndex("by_email_and_state", q => q.eq("email", user.email.toLowerCase()).eq("state", "pending")).take(MAX_PENDING_INVITATIONS_PER_EMAIL);
  const rows = await Promise.all(invitations.map(async invitation => {
    const library = await ctx.db.get("evidenceLibraries", invitation.libraryId);
    if (!library || library.state === "disabled") return null;
    const owner = await libraryOwner(ctx, library);
    if (!owner || !ownerActive(owner)) return null;
    return { invitationId: invitation._id, libraryId: library._id, name: library.name, role: invitation.role, organization: { id: owner.organization?._id ?? null, ...(await ownerName(ctx, owner)) } };
  }));
  return rows.filter(row => row !== null);
}

export async function hasDirectLibraryAccess(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  user: Doc<"users">,
) {
  if (user.state !== "active") return false;
  // A person has at most MAX_LIBRARY_GRANTS_PER_PERSON grants (./members.ts).
  for (const assignment of await ctx.db.query("evidenceLibraryMembers")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", user.clerkId)).take(MAX_LIBRARY_GRANTS_PER_PERSON)) {
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
  const owner = await libraryOwner(ctx, library);
  if (!owner || !ownerActive(owner)) return null;
  const membership = owner.organization ? await readActiveOrganizationMembership(ctx, owner.organization._id, clerkUserId) : null;
  const assignment = await ctx.db.query("evidenceLibraryMembers")
    .withIndex("by_libraryId_and_clerkUserId", q => q.eq("libraryId", library._id).eq("clerkUserId", clerkUserId))
    .unique();
  return libraryRoleFrom(library, owner, { user, membership, assignment });
}

/**
 * A person's role from rows already read: their user, active organization membership and
 * library grant. readLibraryRole reads them for one person; the team page reads them for
 * everyone at once (#357). A library's owners are its organization's admins, or the person
 * whose own workspace it's in (#650).
 */
export function libraryRoleFrom(
  library: Doc<"evidenceLibraries">,
  owner: LibraryOwner | null,
  rows: { user: Doc<"users"> | null; membership: Pick<Doc<"organizationMemberships">, "role"> | null; assignment: Pick<Doc<"evidenceLibraryMembers">, "role"> | null },
): EvidenceLibraryAdminRole | null {
  if (rows.user?.state === "deleted") return null;
  if (!owner || !ownerActive(owner)) return null;
  if (owner.organization ? rows.membership?.role === "org:admin" : owner.workspace.kind === "personal" && rows.user?._id === owner.workspace.userId) return "owner";
  if (library.state === "disabled") return null;
  return rows.assignment?.role ?? null;
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
  const owner = await libraryOwner(ctx, library);
  if (!owner) return null;
  // Managing takes the feature, which only an organization's switch turns on until plans do (#652).
  if (action === "manage" && owner.organization?.evidenceLibrariesEnabled !== true) return null;
  return { clerkUserId: identity.subject, owner, organization: owner.organization, role, library };
}

export async function requireEvidenceLibraryAccess(ctx: OrganizationAccessCtx, libraryId: Id<"evidenceLibraries">, action: OrganizationAction) {
  if (!await ctx.auth.getUserIdentity()) throw createError("UNAUTHENTICATED", "Sign in to access this library");
  const access = await readEvidenceLibraryAccess(ctx, libraryId, action);
  if (!access) return denyOrganizationAccess();
  return access;
}
