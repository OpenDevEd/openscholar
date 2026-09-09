import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { writeAuditLogRecord } from "../lib/audit";
import {
  readLibraryRole,
  type EvidenceLibraryAdminRole,
} from "./access";
import { findMatchingLibraryServiceCredential } from "./credentials";
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
      role: EvidenceLibraryAdminRole;
      consumedAt: number;
    };

/**
 * Writes one single-use admin login code and its audit row. The caller has
 * already decided who the person is and what they may do, so this only
 * records the decision.
 */
export async function storeIssuedAdminLoginCode(
  ctx: MutationCtx,
  args: {
    library: Doc<"evidenceLibraries">;
    organizationId: Id<"organizations">;
    clerkUserId: string;
    role: EvidenceLibraryAdminRole;
    codeDigest: string;
    issuedAt: number;
    expiresAt: number;
  },
) {
  const codeId = await ctx.db.insert("evidenceLibraryAdminLoginCodes", {
    libraryId: args.library._id,
    organizationId: args.organizationId,
    clerkUserId: args.clerkUserId,
    role: args.role,
    codeDigest: args.codeDigest,
    issuedAt: args.issuedAt,
    expiresAt: args.expiresAt,
  });
  await writeAuditLogRecord(ctx, {
    action: "evidence_library.admin_login_code.issued",
    userId: args.clerkUserId,
    metadata: {
      codeId,
      libraryId: args.library._id,
      organizationId: args.organizationId,
      role: args.role,
    },
  });
  return { codeId, expiresAt: args.expiresAt, role: args.role };
}

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

  const role = await readLibraryRole(ctx, library, code.clerkUserId);
  if (!role || role !== code.role) return { kind: "invalid_code" };

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
