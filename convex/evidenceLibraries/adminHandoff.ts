import { v } from "convex/values";
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import {
  mapOrganizationRoleToAdminRole,
  type EvidenceLibraryAdminRole,
} from "./access";
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

type AdminHandoffDecision =
  | {
      status: "allowed";
      library: Doc<"evidenceLibraries">;
      organization: Doc<"organizations">;
      clerkUserId: string;
      role: EvidenceLibraryAdminRole;
      targetBaseUrl: string;
    }
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

/** The one place that decides. Both the code and the page read it. */
async function readAdminHandoffDecision(
  ctx: Pick<QueryCtx | MutationCtx, "auth" | "db">,
  rawLibraryId: string,
): Promise<AdminHandoffDecision> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || typeof identity.subject !== "string") {
    throw createError("UNAUTHENTICATED", "Sign in to open the admin area");
  }
  const clerkUserId = identity.subject;

  const libraryId = ctx.db.normalizeId("evidenceLibraries", rawLibraryId);
  const library = libraryId
    ? await ctx.db.get("evidenceLibraries", libraryId)
    : null;
  if (!library) return { status: "no_access", organisationName: null };

  const organization = await ctx.db.get("organizations", library.organizationId);
  if (!organization || organization.state !== "active") {
    return {
      status: "no_access",
      organisationName: organization?.name ?? null,
    };
  }

  const memberships = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_clerkUserId_and_state", (byMember) =>
      byMember
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

  const targetBaseUrl = await readEvidenceLibraryAdminLaunchTarget(ctx, library);
  if (!targetBaseUrl) {
    return { status: "not_ready", isOwner: role === "owner" };
  }
  return {
    status: "allowed",
    library,
    organization,
    clerkUserId,
    role,
    targetBaseUrl,
  };
}

export async function issueAdminHandoffCode(
  ctx: MutationCtx,
  args: {
    libraryId: string;
    codeDigest: string;
    issuedAt: number;
    expiresAt: number;
  },
): Promise<AdminHandoffOutcome> {
  const decision = await readAdminHandoffDecision(ctx, args.libraryId);
  if (decision.status !== "allowed") return decision;

  await storeIssuedAdminLoginCode(ctx, {
    library: decision.library,
    organizationId: decision.organization._id,
    clerkUserId: decision.clerkUserId,
    role: decision.role,
    codeDigest: args.codeDigest,
    issuedAt: args.issuedAt,
    expiresAt: args.expiresAt,
  });
  return { status: "allowed", targetBaseUrl: decision.targetBaseUrl };
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

/**
 * The same decision without minting anything, for the page that explains a
 * refusal. It never hands out a code, so opening that page cannot spend one.
 */
export const readAdminHandoffState = query({
  args: { libraryId: v.string() },
  returns: v.union(
    v.object({ status: v.literal("allowed") }),
    v.object({
      status: v.literal("no_access"),
      organisationName: v.union(v.string(), v.null()),
    }),
    v.object({ status: v.literal("not_ready"), isOwner: v.boolean() }),
  ),
  handler: async (ctx, args) => {
    const decision = await readAdminHandoffDecision(ctx, args.libraryId);
    if (decision.status === "allowed") return { status: "allowed" as const };
    return decision;
  },
});
