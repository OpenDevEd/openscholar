import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { validateOwnerSections } from "../../lib/evidence-libraries/configuration/owner-rules";
import { isPlatformMailConfigured } from "./platformMail";
import {
  LIBRARY_SERVICE_CREDENTIAL_KEY,
  writeEvidenceLibraryCredentialRecord,
  writeLibraryServiceCredentialRecord,
} from "./credentials";
import {
  requireNonBlankProvisioningValue,
  validateTargetBaseUrl,
} from "./provisioning";
import {
  EVIDENCE_LIBRARY_SETUP_ACTION_DELAY_MS,
  recordEvidenceLibrarySetupStep,
  requireCurrentEvidenceLibrarySetupAttempt,
} from "./setupOperation";
import {
  evidenceLibraryReconcileOutcomeValidator,
  sectionRowValidator,
} from "./validators";
import {
  AUTHENTICATION_SECRET_PATH,
  DATABASE_URL_PATH,
  SEARCH_KEY_PATH,
  STORAGE_SERVICE_KEY_PATH,
} from "./runtimeCredentials";
import { readLibraryZoteroGroupCredentials } from "../zotero/libraryGroups";
import {
  readAiProviderKeySource,
  requireUnchangedAiProviderKey,
} from "./aiProviderKey";
import { zoteroGroupScopesValidator } from "../zotero/libraryGroupValidators";
import { aiProviderKeySourceValidator } from "./validators";

function requireRuntimeCommit(value: string): string {
  const commit = requireNonBlankProvisioningValue("runtimeCommit", value);
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw createError(
      "VALIDATION_ERROR",
      "runtimeCommit must be a lowercase 40-character commit",
    );
  }
  return commit;
}

export const prepareApplicationSetup = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    candidateEncryptedSearchKey: v.string(),
    candidateEncryptedAuthenticationSecret: v.string(),
    candidateEncryptedMachineCredential: v.string(),
    candidateMachineCredentialDigest: v.string(),
    candidateMachineCredentialHint: v.string(),
    candidateRuntimeCommit: v.string(),
  },
  returns: v.object({
    searchCredentialId: v.id("evidenceLibraryCredentials"),
    encryptedSearchKey: v.string(),
    authenticationCredentialId: v.id("evidenceLibraryCredentials"),
    encryptedAuthenticationSecret: v.string(),
    machineCredentialId: v.id("evidenceLibraryCredentials"),
    encryptedMachineCredential: v.string(),
    databaseCredentialId: v.id("evidenceLibraryCredentials"),
    encryptedDatabaseUrl: v.string(),
    storageCredentialId: v.id("evidenceLibraryCredentials"),
    encryptedStorageServiceRoleKey: v.string(),
    storagePrivateBucket: v.string(),
    storagePublicBucket: v.string(),
    runtimeCommit: v.string(),
    revisionKey: v.string(),
    revisionCreatedAt: v.number(),
    targetBaseUrl: v.string(),
    sections: v.array(sectionRowValidator),
    zoteroGroups: v.array(
      v.object({
        groupId: v.string(),
        encryptedApiKey: v.string(),
        scopes: zoteroGroupScopesValidator,
      }),
    ),
    aiProviderKey: aiProviderKeySourceValidator,
  }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "application",
    });
    const [
      existingSearch,
      existingAuthentication,
      existingMachine,
      databaseCredential,
      storageCredential,
      sectionRows,
    ] = await Promise.all([
      ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (query) =>
          query
            .eq("libraryId", args.libraryId)
            .eq("credentialKey", SEARCH_KEY_PATH),
        )
        .unique(),
      ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (query) =>
          query
            .eq("libraryId", args.libraryId)
            .eq("credentialKey", AUTHENTICATION_SECRET_PATH),
        )
        .unique(),
      ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (query) =>
          query
            .eq("libraryId", args.libraryId)
            .eq("credentialKey", LIBRARY_SERVICE_CREDENTIAL_KEY),
        )
        .unique(),
      ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (query) =>
          query
            .eq("libraryId", args.libraryId)
            .eq("credentialKey", DATABASE_URL_PATH),
        )
        .unique(),
      ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (query) =>
          query
            .eq("libraryId", args.libraryId)
            .eq("credentialKey", STORAGE_SERVICE_KEY_PATH),
        )
        .unique(),
      ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_revisionId_and_sectionKey", (query) =>
          query.eq("revisionId", setup.revision._id),
        )
        .collect(),
    ]);

    if (!databaseCredential || !storageCredential) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library database and storage credentials are incomplete",
      );
    }
    const storageReceipt = setup.setupOperation.setupReceipts?.storage;
    if (!storageReceipt) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library storage receipt is missing",
      );
    }
    const sections = sectionRows.map((section) => ({
      sectionKey: section.sectionKey,
      payload: section.payload,
    }));
    const validatedSections = validateOwnerSections(sections, {
      expectedBaseUrl: setup.runtimeBinding.targetBaseUrl,
      requireComplete: true,
      platformMailConfigured: isPlatformMailConfigured(),
    });
    if (!validatedSections.valid) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library revision configuration is incomplete",
      );
    }
    const runtimeCommit =
      setup.setupOperation.setupRuntimeCommit ??
      requireRuntimeCommit(args.candidateRuntimeCommit);
    if (!setup.setupOperation.setupRuntimeCommit) {
      await ctx.db.patch(setup.setupOperation._id, {
        setupRuntimeCommit: runtimeCommit,
        updatedAt: Date.now(),
      });
    }

    const encryptedSearchKey =
      existingSearch?.encryptedValue ??
      requireNonBlankProvisioningValue(
        "candidateEncryptedSearchKey",
        args.candidateEncryptedSearchKey,
      );
    const searchCredentialId =
      existingSearch?._id ??
      (await writeEvidenceLibraryCredentialRecord(ctx, {
        libraryId: args.libraryId,
        concretePath: SEARCH_KEY_PATH,
        encryptedValue: encryptedSearchKey,
        clerkUserId: setup.setupOperation.requestedByClerkUserId,
        validationState: "valid",
      }));

    const encryptedAuthenticationSecret =
      existingAuthentication?.encryptedValue ??
      requireNonBlankProvisioningValue(
        "candidateEncryptedAuthenticationSecret",
        args.candidateEncryptedAuthenticationSecret,
      );
    const authenticationCredentialId =
      existingAuthentication?._id ??
      (await writeEvidenceLibraryCredentialRecord(ctx, {
        libraryId: args.libraryId,
        concretePath: AUTHENTICATION_SECRET_PATH,
        encryptedValue: encryptedAuthenticationSecret,
        clerkUserId: setup.setupOperation.requestedByClerkUserId,
        validationState: "valid",
      }));

    if (existingMachine && !existingMachine.credentialDigest) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library machine credential is incomplete",
      );
    }
    const encryptedMachineCredential =
      existingMachine?.encryptedValue ??
      requireNonBlankProvisioningValue(
        "candidateEncryptedMachineCredential",
        args.candidateEncryptedMachineCredential,
      );
    const machineCredentialId =
      existingMachine?._id ??
      (await writeLibraryServiceCredentialRecord(ctx, {
        libraryId: args.libraryId,
        encryptedValue: encryptedMachineCredential,
        credentialDigest: requireNonBlankProvisioningValue(
          "candidateMachineCredentialDigest",
          args.candidateMachineCredentialDigest,
        ),
        maskedHint: requireNonBlankProvisioningValue(
          "candidateMachineCredentialHint",
          args.candidateMachineCredentialHint,
        ),
        clerkUserId: setup.setupOperation.requestedByClerkUserId,
        validationState: "valid",
      }));

    const aiProviderKey = await readAiProviderKeySource(ctx, args.libraryId);
    return {
      searchCredentialId,
      encryptedSearchKey,
      authenticationCredentialId,
      encryptedAuthenticationSecret,
      machineCredentialId,
      encryptedMachineCredential,
      databaseCredentialId: databaseCredential._id,
      encryptedDatabaseUrl: databaseCredential.encryptedValue,
      storageCredentialId: storageCredential._id,
      encryptedStorageServiceRoleKey: storageCredential.encryptedValue,
      storagePrivateBucket: storageReceipt.privateBucket,
      storagePublicBucket: storageReceipt.publicBucket,
      runtimeCommit,
      revisionKey: setup.revision.revisionKey,
      revisionCreatedAt: setup.revision.createdAt,
      targetBaseUrl: setup.runtimeBinding.targetBaseUrl,
      sections,
      zoteroGroups: await readLibraryZoteroGroupCredentials(
        ctx,
        args.libraryId,
      ),
      aiProviderKey,
    };
  },
});

export const completeApplicationSetup = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    outcome: evidenceLibraryReconcileOutcomeValidator,
    applicationId: v.string(),
    runtimeCommit: v.string(),
    runtimeConfigSha256: v.string(),
    coolifyConfigHash: v.string(),
    searchHost: v.string(),
    searchIndex: v.string(),
    storageUrl: v.string(),
    storagePrivateBucket: v.string(),
    storagePublicBucket: v.string(),
    storageMaxPdfBytes: v.number(),
    zoteroTranslationUrl: v.optional(v.string()),
    databaseCredentialId: v.id("evidenceLibraryCredentials"),
    searchCredentialId: v.id("evidenceLibraryCredentials"),
    storageCredentialId: v.id("evidenceLibraryCredentials"),
    aiProviderKey: aiProviderKeySourceValidator,
  },
  returns: v.object({
    bindingId: v.id("evidenceLibraryRuntimeBindings"),
    nextStep: v.literal("deployment"),
    status: v.literal("running"),
  }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "application",
    });
    if (setup.setupOperation.setupRuntimeCommit !== args.runtimeCommit) {
      throw createError(
        "CONFLICT",
        "Evidence Library release commit changed during setup",
      );
    }
    const storageReceipt = setup.setupOperation.setupReceipts?.storage;
    if (
      !storageReceipt ||
      storageReceipt.privateBucket !== args.storagePrivateBucket ||
      storageReceipt.publicBucket !== args.storagePublicBucket
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library storage buckets changed during setup",
      );
    }
    const applicationId = requireNonBlankProvisioningValue(
      "applicationId",
      args.applicationId,
    );
    const searchHost = requireNonBlankProvisioningValue(
      "searchHost",
      args.searchHost,
    );
    const searchIndex = requireNonBlankProvisioningValue(
      "searchIndex",
      args.searchIndex,
    );
    const storageUrl = validateTargetBaseUrl(args.storageUrl);
    if (
      !Number.isSafeInteger(args.storageMaxPdfBytes) ||
      args.storageMaxPdfBytes <= 0
    ) {
      throw createError(
        "VALIDATION_ERROR",
        "storageMaxPdfBytes must be a positive safe integer",
      );
    }
    const zoteroTranslationUrl =
      args.zoteroTranslationUrl === undefined
        ? undefined
        : validateTargetBaseUrl(args.zoteroTranslationUrl);
    const [databaseCredential, searchCredential, storageCredential, occupied] =
      await Promise.all([
        ctx.db.get(args.databaseCredentialId),
        ctx.db.get(args.searchCredentialId),
        ctx.db.get(args.storageCredentialId),
        ctx.db
          .query("evidenceLibraryRuntimeBindings")
          .withIndex("by_targetRuntimeId", (query) =>
            query.eq("targetRuntimeId", applicationId),
          )
          .first(),
      ]);
    for (const [name, credential, key] of [
      ["database", databaseCredential, DATABASE_URL_PATH],
      ["search", searchCredential, SEARCH_KEY_PATH],
      ["storage", storageCredential, STORAGE_SERVICE_KEY_PATH],
    ] as const) {
      if (
        !credential ||
        credential.libraryId !== args.libraryId ||
        credential.credentialKey !== key ||
        credential.validationState !== "valid"
      ) {
        throw createError(
          "INVALID_DATA",
          `Evidence Library ${name} credential is incomplete`,
        );
      }
    }
    // A key replaced or removed while the library was being set up must not
    // reach it, the same rule a later publish follows.
    await requireUnchangedAiProviderKey(ctx, args.libraryId, args.aiProviderKey);
    if (occupied && occupied._id !== setup.runtimeBinding._id) {
      throw createError(
        "CONFLICT",
        "Evidence Library Coolify application is already assigned",
      );
    }
    if (
      "targetRuntimeId" in setup.runtimeBinding &&
      setup.runtimeBinding.targetRuntimeId !== applicationId
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library setup resolved a different Coolify application",
      );
    }
    const now = Date.now();
    await ctx.db.replace(setup.runtimeBinding._id, {
      libraryId: args.libraryId,
      targetBaseUrl: setup.runtimeBinding.targetBaseUrl,
      targetRuntimeId: applicationId,
      runtimeCommit: args.runtimeCommit,
      searchHost,
      searchIndex,
      storageUrl,
      storagePrivateBucket: args.storagePrivateBucket,
      storagePublicBucket: args.storagePublicBucket,
      storageMaxPdfBytes: args.storageMaxPdfBytes,
      ...(zoteroTranslationUrl === undefined ? {} : { zoteroTranslationUrl }),
      databaseCredentialId: args.databaseCredentialId,
      searchCredentialId: args.searchCredentialId,
      storageCredentialId: args.storageCredentialId,
      state: "pending",
      createdAt: setup.runtimeBinding.createdAt,
      updatedAt: now,
    });
    const transition = await recordEvidenceLibrarySetupStep(ctx, {
      libraryId: args.libraryId,
      operationId: args.operationId,
      attemptToken: args.attemptToken,
      attemptCount: args.attemptCount,
      result: {
        step: "application",
        outcome: args.outcome,
        applicationId,
        runtimeCommit: args.runtimeCommit,
        runtimeConfigSha256: args.runtimeConfigSha256,
        coolifyConfigHash: args.coolifyConfigHash,
      },
    });
    await ctx.scheduler.runAfter(
      EVIDENCE_LIBRARY_SETUP_ACTION_DELAY_MS,
      internal.evidenceLibraries.deploymentSetupActions.runDeploymentSetup,
      {
        libraryId: args.libraryId,
        operationId: args.operationId,
        attemptToken: args.attemptToken,
        attemptCount: args.attemptCount,
      },
    );
    return {
      bindingId: setup.runtimeBinding._id,
      nextStep: transition.nextStep as "deployment",
      status: transition.status as "running",
    };
  },
});
