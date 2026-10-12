import { MAX_LIBRARY_GRANTS_PER_PERSON, MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL } from "../lib/queryBounds";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { hasPlanFeature } from "../billing/accounts";
import { EVIDENCE_LIBRARIES_FEATURE } from "../../lib/billing/plans";
import { addressesOf } from "../lib/people";

/**
 * What someone does with a library. Viewing it, and its settings read-only, is for everyone who reads
 * it and the other members of its organization (#653). Managing it takes the plan of the workspace
 * that owns it. Removing it is its owners' whatever the plan says: a workspace whose plan stopped
 * including Evidence Libraries must still be able to clear them, or it could never be deleted (#652).
 */
export type OrganizationAction = "view" | "read" | "manage" | "remove";
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

/**
 * A library's people with a role of their own are rows of the tables every shared item's guests
 * are in (#653, ../sharing/validators.ts), under the library's two roles. Its owners have no row:
 * they are its organization's admins, or the person whose own workspace it's in.
 */
export const libraryGrant = (ctx: Pick<QueryCtx, "db">, libraryId: Id<"evidenceLibraries">, userId: Id<"users">) =>
  ctx.db.query("itemAccess").withIndex("by_item_and_user", q => q.eq("item", libraryId).eq("userId", userId)).unique();

/** The role a library's row gives: a creator's, or else an editor's. */
export const grantedRole = (row: Pick<Doc<"itemAccess">, "role">) => (row.role === "creator" ? "creator" as const : "editor" as const);

/** The library a row of those tables is of, or null for a row of anything else. */
export const libraryOf = async (ctx: Pick<QueryCtx, "db">, row: Pick<Doc<"itemInvitations">, "kind" | "item">) => {
  const libraryId = row.kind === "library" ? ctx.db.normalizeId("evidenceLibraries", row.item) : null;
  return libraryId ? await ctx.db.get("evidenceLibraries", libraryId) : null;
};

/** Pending invitations open the library list, but do not grant a library role. */
export async function readPendingLibraryInvitations(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  user: Doc<"users">,
) {
  if (user.state !== "active") return [];
  // Those to any address of theirs. An address has at most MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL invitations waiting, to anything.
  // shortcut: the newest MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL of them all; page them if a person ever has more waiting.
  const invitations = (await Promise.all(addressesOf(user).map(email => ctx.db.query("itemInvitations")
    .withIndex("by_email_and_state", q => q.eq("email", email).eq("state", "pending")).order("desc").take(MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL))))
    .flat().sort((a, b) => b._creationTime - a._creationTime).slice(0, MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL);
  const rows = await Promise.all(invitations.map(async invitation => {
    const library = await libraryOf(ctx, invitation);
    if (!library || library.state === "disabled") return null;
    const owner = await libraryOwner(ctx, library);
    if (!owner || !ownerActive(owner)) return null;
    return { invitationId: invitation._id, libraryId: library._id, name: library.name, role: grantedRole(invitation), organization: { id: owner.organization?._id ?? null, ...(await ownerName(ctx, owner)) } };
  }));
  return rows.filter(row => row !== null);
}

export async function hasDirectLibraryAccess(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  user: Doc<"users">,
) {
  if (user.state !== "active") return false;
  // A person has at most MAX_LIBRARY_GRANTS_PER_PERSON grants (./members.ts).
  for (const assignment of await ctx.db.query("itemAccess")
    .withIndex("by_user_and_kind_and_grantedAt", q => q.eq("userId", user._id).eq("kind", "library")).take(MAX_LIBRARY_GRANTS_PER_PERSON)) {
    const library = await libraryOf(ctx, assignment);
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

/** "viewer" for a member of a library's organization who has no role in it (#653), or null. Its caller has checked the account is active. */
async function viewerOf(ctx: Pick<QueryCtx | MutationCtx, "db">, library: Doc<"evidenceLibraries">, clerkUserId: string) {
  if (library.state === "disabled") return null;
  const owner = await libraryOwner(ctx, library);
  if (!owner?.organization || !ownerActive(owner)) return null;
  return (await readActiveOrganizationMembership(ctx, owner.organization._id, clerkUserId)) ? "viewer" as const : null;
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
  const assignment = user ? await libraryGrant(ctx, library._id, user._id) : null;
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
  rows: { user: Doc<"users"> | null; membership: Pick<Doc<"organizationMemberships">, "role"> | null; assignment: Pick<Doc<"itemAccess">, "role"> | null },
): EvidenceLibraryAdminRole | null {
  if (rows.user?.state === "deleted") return null;
  if (!owner || !ownerActive(owner)) return null;
  if (owner.organization ? rows.membership?.role === "org:admin" : owner.workspace.kind === "personal" && rows.user?._id === owner.workspace.userId) return "owner";
  if (library.state === "disabled") return null;
  return rows.assignment ? grantedRole(rows.assignment) : null;
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
  // Viewing reaches settings no role reached before (#653): a suspended account views nothing, whatever it was given.
  const account = action === "view" ? await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", identity.subject)).unique() : null;
  if (account && account.state !== "active") return null;
  const role = (await readLibraryRole(ctx, library, identity.subject)) ?? (action === "view" ? await viewerOf(ctx, library, identity.subject) : null);
  if (!role || ((action === "manage" || action === "remove") && role !== "owner")) return null;
  const owner = await libraryOwner(ctx, library);
  if (!owner) return null;
  // Managing takes the feature, which the plan of the workspace that owns the library grants (#652).
  if (action === "manage" && !(await hasPlanFeature(ctx, owner.workspace._id, EVIDENCE_LIBRARIES_FEATURE))) return null;
  return { clerkUserId: identity.subject, owner, organization: owner.organization, role, library };
}

export async function requireEvidenceLibraryAccess(ctx: OrganizationAccessCtx, libraryId: Id<"evidenceLibraries">, action: OrganizationAction) {
  if (!await ctx.auth.getUserIdentity()) throw createError("UNAUTHENTICATED", "Sign in to access this library");
  const access = await readEvidenceLibraryAccess(ctx, libraryId, action);
  if (!access) return denyOrganizationAccess();
  return access;
}
