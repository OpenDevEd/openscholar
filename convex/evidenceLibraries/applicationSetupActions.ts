"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { ConfigurationAssemblyError } from "../../lib/evidence-libraries/configuration/assembly";
import { encrypt, getKeyPrefix } from "../lib/crypto";
import { createError } from "../lib/errors";
import { generateOpaqueToken } from "../lib/opaqueToken";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import {
  CoolifyClientError,
  reconcileCoolifyApplication,
} from "./coolifyClient";
import {
  assembleEvidenceLibraryRuntimePayload,
  EVIDENCE_LIBRARY_SEARCH_HOST,
  EVIDENCE_LIBRARY_SEARCH_INDEX,
} from "./runtimeConfiguration";
import {
  optionalPlatformBrandAssets,
  optionalPlatformEmbeddingKey,
  optionalPlatformMailService,
  optionalRuntimeEnvironment,
  requirePositiveRuntimeInteger,
  requireRuntimeEnvironment,
  requireRuntimeHttpsOrigin,
} from "./runtimeActionConfig";

const invalidData = (message: string) => createError("INVALID_DATA", message);

type ApplicationSetupActionResult =
  | { status: "failed" }
  | {
      bindingId: Id<"evidenceLibraryRuntimeBindings">;
      nextStep: "deployment";
      status: "running";
    };

export const runApplicationSetup = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("failed") }),
    v.object({
      bindingId: v.id("evidenceLibraryRuntimeBindings"),
      nextStep: v.literal("deployment"),
      status: v.literal("running"),
    }),
  ),
  handler: async (ctx, args): Promise<ApplicationSetupActionResult> => {
    try {
      const encryptionKey = requireRuntimeEnvironment(
        "ENCRYPTION_KEY",
        invalidData,
      );
      const searchKey = generateOpaqueToken("elsearch_");
      const authenticationSecret = generateOpaqueToken("elauth_");
      const machineCredential = generateOpaqueToken("els_");
      const prepared = await ctx.runMutation(
        internal.evidenceLibraries.applicationSetup.prepareApplicationSetup,
        {
          ...args,
          candidateEncryptedSearchKey: encrypt(searchKey, encryptionKey),
          candidateEncryptedAuthenticationSecret: encrypt(
            authenticationSecret,
            encryptionKey,
          ),
          candidateEncryptedMachineCredential: encrypt(
            machineCredential,
            encryptionKey,
          ),
          candidateMachineCredentialDigest:
            await digestOpaqueToken(machineCredential),
          candidateMachineCredentialHint: getKeyPrefix(machineCredential),
          candidateRuntimeCommit: requireRuntimeEnvironment(
            "EL_RUNTIME_COMMIT_SHA",
            invalidData,
          ),
          candidateRuntimeImage: requireRuntimeEnvironment(
            "EL_RUNTIME_IMAGE",
            invalidData,
          ),
        },
      );
      const appOrigin = requireRuntimeHttpsOrigin(
        "EL_OPENSCHOLAR_URL",
        invalidData,
      );
      const storageUrl = requireRuntimeHttpsOrigin(
        "EL_STORAGE_URL",
        invalidData,
      );
      const storageMaxPdfBytes = requirePositiveRuntimeInteger(
        "EL_STORAGE_MAX_PDF_BYTES",
        invalidData,
      );
      const configuration = assembleEvidenceLibraryRuntimePayload({
        encryptionKey,
        libraryId: args.libraryId,
        revision: {
          key: prepared.revisionKey,
          createdAt: prepared.revisionCreatedAt,
        },
        origins: {
          app: appOrigin,
          convexSite: requireRuntimeHttpsOrigin(
            "EL_CONVEX_SITE_URL",
            invalidData,
          ),
        },
        sections: Object.fromEntries(
          prepared.sections.map((row) => [row.sectionKey, row.payload]),
        ),
        credentials: {
          encryptedMachine: prepared.encryptedMachineCredential,
          encryptedAuthentication: prepared.encryptedAuthenticationSecret,
          encryptedDatabaseUrl: prepared.encryptedDatabaseUrl,
        },
        search: {
          host: EVIDENCE_LIBRARY_SEARCH_HOST,
          encryptedKey: prepared.encryptedSearchKey,
          index: EVIDENCE_LIBRARY_SEARCH_INDEX,
        },
        storage: {
          url: storageUrl,
          encryptedServiceRoleKey: prepared.encryptedStorageServiceRoleKey,
          privateBucket: prepared.storagePrivateBucket,
          publicBucket: prepared.storagePublicBucket,
          maxPdfBytes: storageMaxPdfBytes,
        },
        zoteroTranslationUrl: optionalRuntimeEnvironment(
          "EL_ZOTERO_TRANSLATION_URL",
        ),
        mail: optionalPlatformMailService(invalidData),
        brand: optionalPlatformBrandAssets(invalidData),
        embeddingApiKey: optionalPlatformEmbeddingKey(),
        zoteroGroups: prepared.zoteroGroups,
        aiProviderKey: prepared.aiProviderApiKey,
      });
      const application = await reconcileCoolifyApplication({
        coolifyUrl: requireRuntimeEnvironment("EL_COOLIFY_URL", invalidData),
        token: requireRuntimeEnvironment("EL_COOLIFY_TOKEN", invalidData),
        serverUuid: requireRuntimeEnvironment(
          "EL_COOLIFY_SERVER_UUID",
          invalidData,
        ),
        projectUuid: requireRuntimeEnvironment(
          "EL_COOLIFY_PROJECT_UUID",
          invalidData,
        ),
        environmentName: requireRuntimeEnvironment(
          "EL_COOLIFY_ENVIRONMENT",
          invalidData,
        ),
        githubAppUuid: requireRuntimeEnvironment(
          "EL_COOLIFY_GITHUB_APP_UUID",
          invalidData,
        ),
        libraryId: args.libraryId,
        targetBaseUrl: prepared.targetBaseUrl,
        runtimeCommit: prepared.runtimeCommit,
        runtimeImage: prepared.runtimeImage,
        runtimeConfigJson: configuration.runtimeConfigJson,
        searchKey: configuration.runtimeConfig.services.search.key,
      });
      return await ctx.runMutation(
        internal.evidenceLibraries.applicationSetup.completeApplicationSetup,
        {
          ...args,
          outcome: application.outcome,
          applicationId: application.applicationId,
          runtimeCommit: prepared.runtimeCommit,
          runtimeImage: prepared.runtimeImage,
          runtimeConfigSha256: configuration.runtimeConfigSha256,
          coolifyConfigHash: application.coolifyConfigHash,
          searchHost: EVIDENCE_LIBRARY_SEARCH_HOST,
          searchIndex: EVIDENCE_LIBRARY_SEARCH_INDEX,
          storageUrl,
          storagePrivateBucket: prepared.storagePrivateBucket,
          storagePublicBucket: prepared.storagePublicBucket,
          storageMaxPdfBytes,
          aiProviderKey: prepared.aiProviderKey,
          zoteroTranslationUrl: optionalRuntimeEnvironment(
            "EL_ZOTERO_TRANSLATION_URL",
          ),
          databaseCredentialId: prepared.databaseCredentialId,
          searchCredentialId: prepared.searchCredentialId,
          storageCredentialId: prepared.storageCredentialId,
        },
      );
    } catch (error) {
      const safeError =
        error instanceof CoolifyClientError
          ? { code: error.code, message: error.message }
          : error instanceof ConfigurationAssemblyError
            ? {
                code: "APPLICATION_CONFIG_INVALID",
                message:
                  "Evidence Library configuration could not be assembled",
                issues: error.issues.map(({ pointer, message }) => ({
                  pointer,
                  message,
                })),
              }
            : {
                code: "APPLICATION_SETUP_FAILED",
                message:
                  "Application setup failed before Coolify was configured",
              };
      await ctx.runMutation(
        internal.evidenceLibraries.setupOperation.failSetupOperation,
        {
          ...args,
          expectedStage: "application",
          error: safeError,
        },
      );
      return { status: "failed" as const };
    }
  },
});
