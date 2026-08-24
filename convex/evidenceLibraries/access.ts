import type { Id } from "../_generated/dataModel";
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

export async function requireOrganizationAccess(
  ctx: OrganizationAccessCtx,
  action: OrganizationAction,
) {
  const identity = await ctx.auth.getUserIdentity();
  const claims = parseOrganizationClaims(identity);
  if (!identity || !claims || typeof identity.subject !== "string") {
    return denyOrganizationAccess();
  }

  const organization = await ctx.db
    .query("organizations")
    .withIndex("by_clerkOrganizationId", (query) =>
      query.eq("clerkOrganizationId", claims.organizationId),
    )
    .unique();
  if (!organization || organization.state !== "active") {
    return denyOrganizationAccess();
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
  if (
    !membership ||
    membership.role !== claims.role ||
    !canPerformOrganizationAction(claims.role, action)
  ) {
    return denyOrganizationAccess();
  }

  return {
    clerkUserId: identity.subject,
    membership,
    organization,
    role: claims.role,
  };
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
