import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { writeAuditLogRecord } from "../lib/audit";
import { createError } from "../lib/errors";
import {
  mapOrganizationRoleToAdminRole,
  requireEvidenceLibraryAccess,
} from "./access";
import { findMatchingLibraryServiceCredential } from "./credentials";
import { readEvidenceLibraryAdminLaunchTarget } from "./setupRecords";
import { evidenceLibraryAdminRoleValidator } from "./validators";

export type AdminLoginRedemptionResult =
  | { kind: "invalid_request" }
  | { kind: "invalid_credential" }
  | { kind: "invalid_code" }
  | {
      kind: "success";
      libraryId: Id<"evidenceLibraries">;
      clerkUserId: string;
      clerkOrganizationId: string;
      role: "owner" | "editor";
      consumedAt: number;
    };

export async function storeIssuedAdminLoginCode(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    codeDigest: string;
    issuedAt: number;
    expiresAt: number;
  },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "read",
  );
  const targetBaseUrl = await readEvidenceLibraryAdminLaunchTarget(
    ctx,
    access.library,
  );
  if (!targetBaseUrl) {
    throw createError("CONFLICT", "Evidence Library is not ready");
  }
  const role = mapOrganizationRoleToAdminRole(access.role);
  const codeId = await ctx.db.insert("evidenceLibraryAdminLoginCodes", {
    libraryId: args.libraryId,
    organizationId: access.organization._id,
    clerkUserId: access.clerkUserId,
    role,
    codeDigest: args.codeDigest,
    issuedAt: args.issuedAt,
    expiresAt: args.expiresAt,
  });
  await writeAuditLogRecord(ctx, {
    action: "evidence_library.admin_login_code.issued",
    userId: access.clerkUserId,
    metadata: {
      codeId,
      libraryId: args.libraryId,
      organizationId: access.organization._id,
      role,
    },
  });
  return { codeId, expiresAt: args.expiresAt, role, targetBaseUrl };
}

export const storeIssuedCode = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    codeDigest: v.string(),
    issuedAt: v.number(),
    expiresAt: v.number(),
  },
  returns: v.object({
    codeId: v.id("evidenceLibraryAdminLoginCodes"),
    expiresAt: v.number(),
    role: evidenceLibraryAdminRoleValidator,
    targetBaseUrl: v.string(),
  }),
  handler: storeIssuedAdminLoginCode,
});

export async function redeemAdminLoginCode(
  ctx: MutationCtx,
  args: {
    libraryId: string;
    credentialDigest: string;
    codeDigest: string;
  },
): Promise<AdminLoginRedemptionResult> {
  const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
  if (!libraryId) return { kind: "invalid_request" };

  const credential = await findMatchingLibraryServiceCredential(ctx, {
    libraryId,
    credentialDigest: args.credentialDigest,
  });
  if (!credential) return { kind: "invalid_credential" };

  const codes = await ctx.db
    .query("evidenceLibraryAdminLoginCodes")
    .withIndex("by_libraryId_and_codeDigest", (query) =>
      query.eq("libraryId", libraryId).eq("codeDigest", args.codeDigest),
    )
    .take(2);
  const code = codes.length === 1 ? codes[0] : null;
  const consumedAt = Date.now();
  if (!code || code.consumedAt !== undefined || code.expiresAt <= consumedAt) {
    return { kind: "invalid_code" };
  }

  const [library, organization] = await Promise.all([
    ctx.db.get("evidenceLibraries", libraryId),
    ctx.db.get("organizations", code.organizationId),
  ]);
  if (
    !library ||
    !organization ||
    organization.state !== "active" ||
    library.organizationId !== code.organizationId
  ) {
    return { kind: "invalid_code" };
  }

  const memberships = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_clerkUserId_and_state", (query) =>
      query
        .eq("organizationId", code.organizationId)
        .eq("clerkUserId", code.clerkUserId)
        .eq("state", "active"),
    )
    .take(2);
  const membership = memberships.length === 1 ? memberships[0] : null;
  if (
    !membership ||
    mapOrganizationRoleToAdminRole(membership.role) !== code.role
  ) {
    return { kind: "invalid_code" };
  }

  await ctx.db.patch("evidenceLibraryAdminLoginCodes", code._id, {
    consumedAt,
  });
  await writeAuditLogRecord(ctx, {
    action: "evidence_library.admin_login_code.redeemed",
    userId: code.clerkUserId,
    metadata: {
      codeId: code._id,
      credentialId: credential.credentialId,
      libraryId,
      organizationId: code.organizationId,
      role: code.role,
    },
  });
  return {
    kind: "success",
    libraryId,
    clerkUserId: code.clerkUserId,
    clerkOrganizationId: organization.clerkOrganizationId,
    role: code.role,
    consumedAt,
  };
}

export const redeemCode = internalMutation({
  args: {
    libraryId: v.string(),
    credentialDigest: v.string(),
    codeDigest: v.string(),
  },
  returns: v.union(
    v.object({ kind: v.literal("invalid_request") }),
    v.object({ kind: v.literal("invalid_credential") }),
    v.object({ kind: v.literal("invalid_code") }),
    v.object({
      kind: v.literal("success"),
      libraryId: v.id("evidenceLibraries"),
      clerkUserId: v.string(),
      clerkOrganizationId: v.string(),
      role: evidenceLibraryAdminRoleValidator,
      consumedAt: v.number(),
    }),
  ),
  handler: redeemAdminLoginCode,
});
