import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";

export type OrganizationRole = "org:admin" | "org:member";
export type OrganizationAction = "read" | "manage";
export type EvidenceLibraryAdminRole = "owner" | "editor";

export type OrganizationClaims = {
  organizationId: string;
  role: OrganizationRole;
  canManage: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canPerformOrganizationAction(
  role: OrganizationRole,
  action: OrganizationAction,
): boolean {
  return action === "read" || role === "org:admin";
}

export function mapOrganizationRoleToAdminRole(
  role: OrganizationRole,
): EvidenceLibraryAdminRole {
  return role === "org:admin" ? "owner" : "editor";
}

export function parseOrganizationClaims(identity: unknown): OrganizationClaims | null {
  if (!isRecord(identity) || !isRecord(identity.o)) return null;

  const organizationId = identity.o.id;
  const role = identity.o.rol;
  if (typeof organizationId !== "string" || organizationId.length === 0) return null;
  if (role !== "org:admin" && role !== "org:member") return null;

  return {
    organizationId,
    role,
    canManage: canPerformOrganizationAction(role, "manage"),
  };
}

type OrganizationAccessCtx = Pick<QueryCtx | MutationCtx, "auth" | "db">;

function denyOrganizationAccess(): never {
  throw createError("FORBIDDEN", "Evidence Library access denied");
}

/**
 * Evidence Libraries are available only to organisations the platform team
 * switched on in the Clerk dashboard, through organisation public metadata
 * `{ "evidenceLibraries": true }`. The Clerk webhook copies that onto the
 * organisation row as `evidenceLibrariesEnabled`.
 *
 * The switch gates the `"manage"` action only. That is deliberate:
 *
 * - Creating, configuring, activating, moving, and tearing down a library all
 *   ask for `"manage"`, so switching an organisation off closes the owner
 *   pages immediately.
 * - Reading asks for `"read"`, so libraries that already exist keep working.
 *   The public Evidence Library runtime never calls this helper at all, and
 *   the admin handoff does not call it either: a member of an active
 *   library's organisation can still open its `/admin` area.
 *
 * Anything but `true` is off, including a row written before the switch
 * existed.
 */
function denyEvidenceLibrariesSwitchedOff(): never {
  throw createError(
    "FORBIDDEN",
    "Evidence Libraries are not switched on for this organisation.",
  );
}

export type OrganizationAccess = {
  clerkUserId: string;
  membership: Doc<"organizationMemberships">;
  organization: Doc<"organizations">;
  role: OrganizationRole;
};

/**
 * Who the caller is inside their active organisation, or `null` when they are
 * not a settled member of it. It answers instead of throwing so read-only
 * callers such as `getEvidenceLibrariesAccess` can render a page, and so both
 * the gate and the pages judge access by exactly the same rules: an active
 * organisation, one active membership, and a stored role that still matches
 * the role in the token.
 */
export async function readOrganizationAccess(
  ctx: OrganizationAccessCtx,
): Promise<OrganizationAccess | null> {
  const identity = await ctx.auth.getUserIdentity();
  const claims = parseOrganizationClaims(identity);
  if (!identity || !claims || typeof identity.subject !== "string") {
    return null;
  }

  const organization = await ctx.db
    .query("organizations")
    .withIndex("by_clerkOrganizationId", (query) =>
      query.eq("clerkOrganizationId", claims.organizationId),
    )
    .unique();
  if (!organization || organization.state !== "active") {
    return null;
  }

  const memberships = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_clerkUserId_and_state", (query) =>
      query
        .eq("organizationId", organization._id)
        .eq("clerkUserId", identity.subject)
        .eq("state", "active"),
    )
    .take(2);
  const membership = memberships.length === 1 ? memberships[0] : null;
  if (!membership || membership.role !== claims.role) {
    return null;
  }

  return {
    clerkUserId: identity.subject,
    membership,
    organization,
    role: claims.role,
  };
}

/**
 * Whether the caller's active organisation may use the Evidence Library owner
 * pages. Both the gate and the pages call this, so they can never disagree.
 */
export function hasEvidenceLibrariesSwitchedOn(
  access: OrganizationAccess | null,
): boolean {
  return access?.organization.evidenceLibrariesEnabled === true;
}

export async function requireOrganizationAccess(
  ctx: OrganizationAccessCtx,
  action: OrganizationAction,
) {
  const access = await readOrganizationAccess(ctx);
  if (!access || !canPerformOrganizationAction(access.role, action)) {
    return denyOrganizationAccess();
  }

  if (action === "manage" && !hasEvidenceLibrariesSwitchedOn(access)) {
    return denyEvidenceLibrariesSwitchedOff();
  }

  return access;
}

export async function requireEvidenceLibraryAccess(
  ctx: OrganizationAccessCtx,
  libraryId: Id<"evidenceLibraries">,
  action: OrganizationAction,
) {
  const access = await requireOrganizationAccess(ctx, action);
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library || library.organizationId !== access.organization._id) {
    return denyOrganizationAccess();
  }
  return { ...access, library };
}
