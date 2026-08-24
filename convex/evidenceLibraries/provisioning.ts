import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { assertNonProd } from "../lib/assertNonProd";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import { storeEvidenceLibraryCredential } from "./credentials";

export function validateTargetBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw createError(
      "VALIDATION_ERROR",
      "Target base URL must be a valid URL",
    );
  }
  if (url.pathname !== "/" || url.search || url.hash || url.origin === "null") {
    throw createError(
      "VALIDATION_ERROR",
      "Target base URL must be origin-only",
    );
  }
  return url.origin;
}

export function assertEvidenceLibraryDevProvisioningEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  assertNonProd(env);
  if (env.EL_DEV_PROVISIONING_ENABLED !== "true") {
    throw new Error("evidence-library-dev-provisioning-not-enabled");
  }
}

export function requireNonBlankProvisioningValue(
  field: string,
  value: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw createError("VALIDATION_ERROR", `${field} must not be blank`);
  }
  return normalized;
}

type SeedRuntimeBindingArgs = {
  libraryId: Id<"evidenceLibraries">;
  targetRuntimeId: string;
  targetBaseUrl: string;
  searchHost: string;
  searchIndex: string;
  storageUrl: string;
  storagePrivateBucket: string;
  storagePublicBucket: string;
  storageMaxPdfBytes: number;
  zoteroTranslationUrl?: string;
  encryptedDatabaseUrl: string;
  encryptedSearchKey: string;
  encryptedStorageServiceRoleKey: string;
};

export async function createPendingRuntimeBinding(
  ctx: MutationCtx,
  args: { libraryId: Id<"evidenceLibraries">; publicAddress: string },
) {
  await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const targetBaseUrl = validateTargetBaseUrl(args.publicAddress);
  const [existing, occupied] = await Promise.all([
    ctx.db
      .query("evidenceLibraryRuntimeBindings")
      .withIndex("by_libraryId", (query) =>
        query.eq("libraryId", args.libraryId),
      )
      .unique(),
    ctx.db
      .query("evidenceLibraryRuntimeBindings")
      .withIndex("by_targetBaseUrl", (query) =>
        query.eq("targetBaseUrl", targetBaseUrl),
      )
      .unique(),
  ]);
  if (existing) {
    throw createError(
      "CONFLICT",
      "Evidence Library runtime binding already exists",
    );
  }
  if (occupied) {
    throw createError(
      "CONFLICT",
      "Evidence Library public address is already used",
    );
  }

  const now = Date.now();
  const bindingId = await ctx.db.insert("evidenceLibraryRuntimeBindings", {
    libraryId: args.libraryId,
    targetBaseUrl,
    state: "pending",
    createdAt: now,
    updatedAt: now,
  });
  return { bindingId, targetBaseUrl };
}

export async function seedDevelopmentRuntimeBinding(
  ctx: MutationCtx,
  args: SeedRuntimeBindingArgs,
) {
  assertEvidenceLibraryDevProvisioningEnabled();
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  const targetRuntimeId = requireNonBlankProvisioningValue(
    "targetRuntimeId",
    args.targetRuntimeId,
  );
  const targetBaseUrl = validateTargetBaseUrl(args.targetBaseUrl);
  const searchHost = requireNonBlankProvisioningValue(
    "searchHost",
    args.searchHost,
  );
  const searchIndex = requireNonBlankProvisioningValue(
    "searchIndex",
    args.searchIndex,
  );
  const storageUrl = requireNonBlankProvisioningValue(
    "storageUrl",
    args.storageUrl,
  );
  const storagePrivateBucket = requireNonBlankProvisioningValue(
    "storagePrivateBucket",
    args.storagePrivateBucket,
  );
  const storagePublicBucket = requireNonBlankProvisioningValue(
    "storagePublicBucket",
    args.storagePublicBucket,
  );
  requireNonBlankProvisioningValue(
    "encryptedDatabaseUrl",
    args.encryptedDatabaseUrl,
  );
  requireNonBlankProvisioningValue(
    "encryptedSearchKey",
    args.encryptedSearchKey,
  );
  requireNonBlankProvisioningValue(
    "encryptedStorageServiceRoleKey",
    args.encryptedStorageServiceRoleKey,
  );
  const zoteroTranslationUrl =
    args.zoteroTranslationUrl === undefined
      ? undefined
      : requireNonBlankProvisioningValue(
          "zoteroTranslationUrl",
          args.zoteroTranslationUrl,
        );
  if (
    !Number.isSafeInteger(args.storageMaxPdfBytes) ||
    args.storageMaxPdfBytes <= 0
  ) {
    throw createError(
      "VALIDATION_ERROR",
      "storageMaxPdfBytes must be a positive safe integer",
    );
  }
  const existing = await ctx.db
    .query("evidenceLibraryRuntimeBindings")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (!existing || access.library.runtimeBindingId !== existing._id) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library runtime binding is missing",
    );
  }
  if (existing.targetBaseUrl !== targetBaseUrl) {
    throw createError(
      "CONFLICT",
      "Evidence Library public address does not match its runtime binding",
    );
  }
  if (existing.state !== "pending" || "targetRuntimeId" in existing) {
    throw createError(
      "CONFLICT",
      "Evidence Library runtime binding is already seeded",
    );
  }
  const targetBinding = await ctx.db
    .query("evidenceLibraryRuntimeBindings")
    .withIndex("by_targetRuntimeId", (query) =>
      query.eq("targetRuntimeId", targetRuntimeId),
    )
    .first();
  if (targetBinding && targetBinding._id !== existing._id) {
    throw createError(
      "CONFLICT",
      "Evidence Library target runtime already reserved",
    );
  }
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
  await ctx.db.patch("evidenceLibraryRuntimeBindings", existing._id, {
    targetRuntimeId,
    searchHost,
    searchIndex,
    storageUrl,
    storagePrivateBucket,
    storagePublicBucket,
    storageMaxPdfBytes: args.storageMaxPdfBytes,
    zoteroTranslationUrl,
    databaseCredentialId,
    searchCredentialId,
    storageCredentialId,
    updatedAt: now,
  });
  return {
    bindingId: existing._id,
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
    storagePrivateBucket: v.string(),
    storagePublicBucket: v.string(),
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
