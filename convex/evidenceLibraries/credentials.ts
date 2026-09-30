import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../lib/functions";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  credentialKeyFor,
  writeOnlyPatternFor,
} from "../../lib/evidence-libraries/configuration/credential-paths";
import { writeAuditLogRecord } from "../lib/audit";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import { requireNoRunningOperation } from "./aiProviderKey";
import { AI_PROVIDER_KEY_PATTERN } from "../../lib/evidence-libraries/configuration/ai";
import { OPENALEX_API_KEY_PATTERN } from "../../lib/evidence-libraries/configuration/sources";

export function resolveCredentialPath(
  concretePath: string,
  instanceKey?: string,
) {
  const pathPattern = writeOnlyPatternFor(concretePath);
  if (!pathPattern) {
    throw createError(
      "VALIDATION_ERROR",
      "Invalid Evidence Library credential path",
    );
  }
  return {
    credentialKey: credentialKeyFor(pathPattern, instanceKey),
    pathPattern,
  };
}

export const LIBRARY_SERVICE_CREDENTIAL_KEY = "library-service";

type ServiceCredentialAuthCtx = Pick<QueryCtx | MutationCtx, "db">;

export async function findMatchingLibraryServiceCredential(
  ctx: ServiceCredentialAuthCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    credentialDigest: string;
  },
) {
  const credential = await ctx.db
    .query("evidenceLibraryCredentials")
    .withIndex("by_libraryId_and_credentialKey", (query) =>
      query
        .eq("libraryId", args.libraryId)
        .eq("credentialKey", LIBRARY_SERVICE_CREDENTIAL_KEY),
    )
    .unique();
  if (!credential || credential.credentialDigest !== args.credentialDigest) {
    return null;
  }
  return { credentialId: credential._id, libraryId: credential.libraryId };
}

export async function authenticateLibraryServiceCredential(
  ctx: ServiceCredentialAuthCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    credentialDigest: string;
  },
) {
  const credential = await findMatchingLibraryServiceCredential(ctx, args);
  if (!credential) {
    throw createError(
      "FORBIDDEN",
      "Evidence Library service authentication failed",
    );
  }
  return credential;
}

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
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  // A publish reads the AI key once and ships it minutes later, so the key
  // may not move while one is under way.
  const credentialPath = resolveCredentialPath(
    args.concretePath,
    args.instanceKey,
  ).pathPattern;
  if (
    credentialPath === AI_PROVIDER_KEY_PATTERN ||
    credentialPath === OPENALEX_API_KEY_PATTERN
  ) {
    await requireNoRunningOperation(ctx, args.libraryId);
  }
  return await writeEvidenceLibraryCredentialRecord(ctx, {
    ...args,
    clerkUserId: access.clerkUserId,
    validationState: "untested",
  });
}

export async function writeEvidenceLibraryCredentialRecord(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    concretePath: string;
    instanceKey?: string;
    encryptedValue: string;
    maskedHint?: string;
    clerkUserId: string;
    validationState: "untested" | "valid" | "invalid";
  },
) {
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
    validationState: args.validationState,
    updatedByClerkUserId: args.clerkUserId,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch("evidenceLibraryCredentials", existing._id, fields);
    return existing._id;
  }
  return await ctx.db.insert("evidenceLibraryCredentials", {
    ...fields,
    createdByClerkUserId: args.clerkUserId,
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
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  const credentialId = await writeLibraryServiceCredentialRecord(ctx, {
    ...args,
    clerkUserId: access.clerkUserId,
    validationState: "untested",
  });
  await writeAuditLogRecord(ctx, {
    action: "evidence_library.service_credential.rotated",
    userId: access.clerkUserId,
    metadata: { credentialId, libraryId: args.libraryId },
  });
  return credentialId;
}

export async function writeLibraryServiceCredentialRecord(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    encryptedValue: string;
    credentialDigest: string;
    maskedHint: string;
    clerkUserId: string;
    validationState: "untested" | "valid" | "invalid";
  },
) {
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
    validationState: args.validationState,
    updatedByClerkUserId: args.clerkUserId,
    updatedAt: now,
  };
  let credentialId: Id<"evidenceLibraryCredentials">;
  if (existing) {
    await ctx.db.replace("evidenceLibraryCredentials", existing._id, {
      ...fields,
      createdByClerkUserId: existing.createdByClerkUserId,
      createdAt: existing.createdAt,
    });
    credentialId = existing._id;
  } else {
    credentialId = await ctx.db.insert("evidenceLibraryCredentials", {
      ...fields,
      createdByClerkUserId: args.clerkUserId,
      createdAt: now,
    });
  }

  return credentialId;
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
