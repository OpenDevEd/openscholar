import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { mapOrganizationRoleToAdminRole } from "./access";
import { storeIssuedAdminLoginCode } from "./adminLoginCodes";
import { readEvidenceLibraryAdminLaunchTarget } from "./setupRecords";

/**
 * Who may open a library's admin area.
 *
 * Access follows the library's own organisation, not the organisation that
 * happens to be active in the caller's token: a person who belongs to the
 * library's organisation lands in the admin area without switching anything
 * first. The plan-12 switch does not close this path, so an active library
 * stays usable for its members even when the owner pages are switched off.
 *
 * The three answers below are all normal. Only a caller who is not signed in
 * makes this throw.
 */
export type AdminHandoffOutcome =
  | { status: "allowed"; targetBaseUrl: string }
  | { status: "no_access"; organisationName: string | null }
  | { status: "not_ready"; isOwner: boolean };

export const adminHandoffOutcomeValidator = v.union(
  v.object({ status: v.literal("allowed"), targetBaseUrl: v.string() }),
  v.object({
    status: v.literal("no_access"),
    organisationName: v.union(v.string(), v.null()),
  }),
  v.object({ status: v.literal("not_ready"), isOwner: v.boolean() }),
);

export async function issueAdminHandoffCode(
  ctx: MutationCtx,
  args: {
    libraryId: string;
    codeDigest: string;
    issuedAt: number;
    expiresAt: number;
  },
): Promise<AdminHandoffOutcome> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || typeof identity.subject !== "string") {
    throw createError("UNAUTHENTICATED", "Sign in to open the admin area");
  }
  const clerkUserId = identity.subject;

  const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
  const library = libraryId
    ? await ctx.db.get("evidenceLibraries", libraryId)
    : null;
  if (!libraryId || !library) {
    return { status: "no_access", organisationName: null };
  }

  const organization = await ctx.db.get(
    "organizations",
    library.organizationId,
  );
  if (!organization || organization.state !== "active") {
    return { status: "no_access", organisationName: organization?.name ?? null };
  }

  const memberships = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_clerkUserId_and_state", (query) =>
      query
        .eq("organizationId", organization._id)
        .eq("clerkUserId", clerkUserId)
        .eq("state", "active"),
    )
    .take(2);
  const membership = memberships.length === 1 ? memberships[0] : null;
  if (!membership) {
    return { status: "no_access", organisationName: organization.name };
  }
  const role = mapOrganizationRoleToAdminRole(membership.role);

  const targetBaseUrl = await readEvidenceLibraryAdminLaunchTarget(
    ctx,
    library,
  );
  if (!targetBaseUrl) {
    return { status: "not_ready", isOwner: role === "owner" };
  }

  await storeIssuedAdminLoginCode(ctx, {
    library,
    organizationId: organization._id,
    clerkUserId,
    role,
    codeDigest: args.codeDigest,
    issuedAt: args.issuedAt,
    expiresAt: args.expiresAt,
  });
  return { status: "allowed", targetBaseUrl };
}

export const issueHandoffCode = internalMutation({
  args: {
    libraryId: v.string(),
    codeDigest: v.string(),
    issuedAt: v.number(),
    expiresAt: v.number(),
  },
  returns: adminHandoffOutcomeValidator,
  handler: issueAdminHandoffCode,
});
