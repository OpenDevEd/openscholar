"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { encrypt } from "../lib/crypto";
import { createError } from "../lib/errors";
import {
  assertEvidenceLibraryDevProvisioningEnabled,
  requireNonBlankProvisioningValue,
} from "./provisioning";

type SeedResult = {
  bindingId: Id<"evidenceLibraryRuntimeBindings">;
  databaseCredentialId: Id<"evidenceLibraryCredentials">;
  searchCredentialId: Id<"evidenceLibraryCredentials">;
  storageCredentialId: Id<"evidenceLibraryCredentials">;
};

export const seedDevelopmentBinding = action({
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
    databaseUrl: v.string(),
    searchKey: v.string(),
    storageServiceRoleKey: v.string(),
  },
  returns: v.object({
    bindingId: v.id("evidenceLibraryRuntimeBindings"),
    databaseCredentialId: v.id("evidenceLibraryCredentials"),
    searchCredentialId: v.id("evidenceLibraryCredentials"),
    storageCredentialId: v.id("evidenceLibraryCredentials"),
  }),
  handler: async (ctx, args): Promise<SeedResult> => {
    assertEvidenceLibraryDevProvisioningEnabled();
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw createError(
        "API_KEY_ENCRYPTION_KEY_MISSING",
        "Credential encryption key is not configured",
      );
    }
    requireNonBlankProvisioningValue("databaseUrl", args.databaseUrl);
    requireNonBlankProvisioningValue("searchKey", args.searchKey);
    requireNonBlankProvisioningValue(
      "storageServiceRoleKey",
      args.storageServiceRoleKey,
    );
    return await ctx.runMutation(
      internal.evidenceLibraries.provisioning.seedRuntimeBinding,
      {
        libraryId: args.libraryId,
        targetRuntimeId: args.targetRuntimeId,
        targetBaseUrl: args.targetBaseUrl,
        searchHost: args.searchHost,
        searchIndex: args.searchIndex,
        storageUrl: args.storageUrl,
        storageDocumentsBucket: args.storageDocumentsBucket,
        storageImagesBucket: args.storageImagesBucket,
        storageMaxPdfBytes: args.storageMaxPdfBytes,
        zoteroTranslationUrl: args.zoteroTranslationUrl,
        encryptedDatabaseUrl: encrypt(args.databaseUrl, encryptionKey),
        encryptedSearchKey: encrypt(args.searchKey, encryptionKey),
        encryptedStorageServiceRoleKey: encrypt(
          args.storageServiceRoleKey,
          encryptionKey,
        ),
      },
    );
  },
});
