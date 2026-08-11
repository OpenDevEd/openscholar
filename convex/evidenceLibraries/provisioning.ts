import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { assertNonProd } from "../lib/assertNonProd";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import { storeEvidenceLibraryCredential } from "./credentials";

export function validateTargetBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash || url.origin === "null") {
    throw createError("VALIDATION_ERROR", "Target base URL must be origin-only");
  }
  return url.origin;
}

export function assertEvidenceLibraryDevProvisioningEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  assertNonProd(env);
  if (env.EVIDENCE_LIBRARY_DEV_PROVISIONING_ENABLED !== "true") {
    throw new Error("evidence-library-dev-provisioning-not-enabled");
  }
}

type SeedRuntimeBindingArgs = {
  libraryId: Id<"evidenceLibraries">;
  targetRuntimeId: string;
  targetBaseUrl: string;
  searchHost: string;
  searchIndex: string;
  storageUrl: string;
  storageDocumentsBucket: string;
  storageImagesBucket: string;
  storageMaxPdfBytes: number;
  zoteroTranslationUrl?: string;
  encryptedDatabaseUrl: string;
  encryptedSearchKey: string;
  encryptedStorageServiceRoleKey: string;
};

export async function seedDevelopmentRuntimeBinding(
  ctx: MutationCtx,
  args: SeedRuntimeBindingArgs,
) {
  assertEvidenceLibraryDevProvisioningEnabled();
  await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const existing = await ctx.db
    .query("evidenceLibraryRuntimeBindings")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (existing) {
    throw createError("CONFLICT", "Evidence Library runtime binding already exists");
  }
  const targetBaseUrl = validateTargetBaseUrl(args.targetBaseUrl);
  const databaseCredentialId = await storeEvidenceLibraryCredential(ctx, {
    libraryId: args.libraryId,
    concretePath: "/services/database/url",
    encryptedValue: args.encryptedDatabaseUrl,
  });
  const searchCredentialId = await storeEvidenceLibraryCredential(ctx, {
    libraryId: args.libraryId,
    concretePath: "/services/search/key",
    encryptedValue: args.encryptedSearchKey,
  });
  const storageCredentialId = await storeEvidenceLibraryCredential(ctx, {
    libraryId: args.libraryId,
    concretePath: "/services/storage/serviceRoleKey",
    encryptedValue: args.encryptedStorageServiceRoleKey,
  });
  const now = Date.now();
  const bindingId = await ctx.db.insert("evidenceLibraryRuntimeBindings", {
    libraryId: args.libraryId,
    targetRuntimeId: args.targetRuntimeId,
    targetBaseUrl,
    state: "pending",
    searchHost: args.searchHost,
    searchIndex: args.searchIndex,
    storageUrl: args.storageUrl,
    storageDocumentsBucket: args.storageDocumentsBucket,
    storageImagesBucket: args.storageImagesBucket,
    storageMaxPdfBytes: args.storageMaxPdfBytes,
    zoteroTranslationUrl: args.zoteroTranslationUrl,
    databaseCredentialId,
    searchCredentialId,
    storageCredentialId,
    createdAt: now,
    updatedAt: now,
  });
  return {
    bindingId,
    databaseCredentialId,
    searchCredentialId,
    storageCredentialId,
  };
}

export const seedRuntimeBinding = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    targetRuntimeId: v.string(),
    targetBaseUrl: v.string(),
    searchHost: v.string(),
    searchIndex: v.string(),
    storageUrl: v.string(),
    storageDocumentsBucket: v.string(),
    storageImagesBucket: v.string(),
    storageMaxPdfBytes: v.number(),
    zoteroTranslationUrl: v.optional(v.string()),
    encryptedDatabaseUrl: v.string(),
    encryptedSearchKey: v.string(),
    encryptedStorageServiceRoleKey: v.string(),
  },
  returns: v.object({
    bindingId: v.id("evidenceLibraryRuntimeBindings"),
    databaseCredentialId: v.id("evidenceLibraryCredentials"),
    searchCredentialId: v.id("evidenceLibraryCredentials"),
    storageCredentialId: v.id("evidenceLibraryCredentials"),
  }),
  handler: seedDevelopmentRuntimeBinding,
});
