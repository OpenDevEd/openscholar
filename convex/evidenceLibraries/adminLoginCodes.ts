import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { writeAuditLogRecord } from "../lib/audit";
import {
  mapOrganizationRoleToAdminRole,
  requireEvidenceLibraryAccess,
} from "./access";
import { evidenceLibraryAdminRoleValidator } from "./validators";

export async function storeIssuedAdminLoginCode(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    codeDigest: string;
    issuedAt: number;
    expiresAt: number;
  },
) {
  const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "read");
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
  return { codeId, expiresAt: args.expiresAt, role };
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
  }),
  handler: storeIssuedAdminLoginCode,
});
