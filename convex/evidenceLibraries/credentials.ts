import { internalMutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  WRITE_ONLY_POINTER_PATTERNS,
} from "../../lib/evidence-libraries/configuration/section-registry";
import { jsonPointerPatternMatches } from "../../lib/evidence-libraries/configuration/json-pointer";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";

export function resolveCredentialPath(concretePath: string, instanceKey?: string) {
  const pathPattern = WRITE_ONLY_POINTER_PATTERNS.find((pattern) =>
    jsonPointerPatternMatches(pattern, concretePath),
  );
  if (!pathPattern) {
    throw createError("VALIDATION_ERROR", "Invalid Evidence Library credential path");
  }
  return {
    credentialKey: instanceKey ? `${pathPattern}:${instanceKey}` : pathPattern,
    pathPattern,
  };
}

export const LIBRARY_SERVICE_CREDENTIAL_KEY = "library-service";

export async function storeEvidenceLibraryCredential(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    concretePath: string;
    instanceKey?: string;
    encryptedValue: string;
    maskedHint?: string;
  },
) {
  const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const resolved = resolveCredentialPath(args.concretePath, args.instanceKey);
  const existing = await ctx.db
    .query("evidenceLibraryCredentials")
    .withIndex("by_libraryId_and_credentialKey", (query) =>
      query
        .eq("libraryId", args.libraryId)
        .eq("credentialKey", resolved.credentialKey),
    )
    .unique();
  const now = Date.now();
  const fields = {
    libraryId: args.libraryId,
    credentialKey: resolved.credentialKey,
    pathPattern: resolved.pathPattern,
    instanceKey: args.instanceKey,
    encryptedValue: args.encryptedValue,
    maskedHint: args.maskedHint,
    validationState: "untested" as const,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch("evidenceLibraryCredentials", existing._id, fields);
    return existing._id;
  }
  return await ctx.db.insert("evidenceLibraryCredentials", {
    ...fields,
    createdByClerkUserId: access.clerkUserId,
    createdAt: now,
  });
}

export async function storeLibraryServiceCredential(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    encryptedValue: string;
    credentialDigest: string;
    maskedHint: string;
  },
) {
  const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const existing = await ctx.db
    .query("evidenceLibraryCredentials")
    .withIndex("by_libraryId_and_credentialKey", (query) =>
      query
        .eq("libraryId", args.libraryId)
        .eq("credentialKey", LIBRARY_SERVICE_CREDENTIAL_KEY),
    )
    .unique();
  const now = Date.now();
  const fields = {
    libraryId: args.libraryId,
    credentialKey: LIBRARY_SERVICE_CREDENTIAL_KEY,
    encryptedValue: args.encryptedValue,
    credentialDigest: args.credentialDigest,
    maskedHint: args.maskedHint,
    validationState: "untested" as const,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.replace("evidenceLibraryCredentials", existing._id, {
      ...fields,
      createdByClerkUserId: existing.createdByClerkUserId,
      createdAt: existing.createdAt,
    });
    return existing._id;
  }
  return await ctx.db.insert("evidenceLibraryCredentials", {
    ...fields,
    createdByClerkUserId: access.clerkUserId,
    createdAt: now,
  });
}

export async function readCredentialMetadata(
  ctx: QueryCtx,
  args: { libraryId: Id<"evidenceLibraries"> },
) {
  await requireEvidenceLibraryAccess(ctx, args.libraryId, "read");
  const credentials = await ctx.db
    .query("evidenceLibraryCredentials")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .collect();
  return credentials.map((credential) => ({
    _id: credential._id,
    credentialKey: credential.credentialKey,
    instanceKey: credential.instanceKey,
    pathPattern: credential.pathPattern,
    maskedHint: credential.maskedHint,
    validationState: credential.validationState,
    lastValidatedAt: credential.lastValidatedAt,
    updatedAt: credential.updatedAt,
  }));
}

export const storeEncryptedCredential = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    concretePath: v.string(),
    instanceKey: v.optional(v.string()),
    encryptedValue: v.string(),
    maskedHint: v.optional(v.string()),
  },
  returns: v.id("evidenceLibraryCredentials"),
  handler: storeEvidenceLibraryCredential,
});

export const storeEncryptedServiceCredential = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    encryptedValue: v.string(),
    credentialDigest: v.string(),
    maskedHint: v.string(),
  },
  returns: v.id("evidenceLibraryCredentials"),
  handler: storeLibraryServiceCredential,
});

export const listCredentialMetadata = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.array(
    v.object({
      _id: v.id("evidenceLibraryCredentials"),
      credentialKey: v.string(),
      instanceKey: v.optional(v.string()),
      pathPattern: v.optional(v.string()),
      maskedHint: v.optional(v.string()),
      validationState: v.union(
        v.literal("untested"),
        v.literal("valid"),
        v.literal("invalid"),
      ),
      lastValidatedAt: v.optional(v.number()),
      updatedAt: v.number(),
    }),
  ),
  handler: readCredentialMetadata,
});
