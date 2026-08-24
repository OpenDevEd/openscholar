"use node";

import { createHash } from "node:crypto";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import {
  assembleEvidenceLibraryConfiguration,
  ConfigurationAssemblyError,
} from "../../lib/evidence-libraries/configuration/assembly";
import { decrypt, encrypt, getKeyPrefix } from "../lib/crypto";
import { createError } from "../lib/errors";
import { generateOpaqueToken } from "../lib/opaqueToken";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import {
  CoolifyClientError,
  reconcileCoolifyApplication,
} from "./coolifyClient";

const SEARCH_HOST = "http://meilisearch:7700";
const SEARCH_INDEX = "evidence_library";

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw createError("INVALID_DATA", `${name} is not configured`);
  return value;
}

function optionalEnvironmentValue(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function requirePositiveIntegerEnvironment(name: string): number {
  const value = Number(requireEnvironmentValue(name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw createError("INVALID_DATA", `${name} must be a positive integer`);
  }
  return value;
}

function requireHttpsOrigin(name: string): string {
  const value = requireEnvironmentValue(name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw createError("INVALID_DATA", `${name} must be a valid HTTPS origin`);
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw createError("INVALID_DATA", `${name} must be a valid HTTPS origin`);
  }
  return url.origin;
}

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
      const encryptionKey = requireEnvironmentValue("ENCRYPTION_KEY");
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
          candidateRuntimeCommit: requireEnvironmentValue(
            "EL_RUNTIME_COMMIT_SHA",
          ),
        },
      );
      const appOrigin = requireHttpsOrigin("EL_OPENSCHOLAR_URL");
      const storageUrl = requireHttpsOrigin("EL_STORAGE_URL");
      const storageMaxPdfBytes = requirePositiveIntegerEnvironment(
        "EL_STORAGE_MAX_PDF_BYTES",
      );
      const resolvedSearchKey = decrypt(
        prepared.encryptedSearchKey,
        encryptionKey,
      );
      const configuration = assembleEvidenceLibraryConfiguration({
        sections: prepared.sections,
        managed: {
          revision: prepared.revisionKey,
          updatedAt: new Date(prepared.revisionCreatedAt).toISOString(),
          libraryId: args.libraryId,
          convexSiteUrl: requireHttpsOrigin("EL_CONVEX_SITE_URL"),
          loginPageUrl: new URL(
            `/evidence-libraries/${encodeURIComponent(args.libraryId)}/admin`,
            appOrigin,
          ).toString(),
          machineCredential: decrypt(
            prepared.encryptedMachineCredential,
            encryptionKey,
          ),
          authenticationSecret: decrypt(
            prepared.encryptedAuthenticationSecret,
            encryptionKey,
          ),
          databaseUrl: decrypt(prepared.encryptedDatabaseUrl, encryptionKey),
          searchHost: SEARCH_HOST,
          searchKey: resolvedSearchKey,
          searchIndex: SEARCH_INDEX,
          storageUrl,
          storageServiceRoleKey: decrypt(
            prepared.encryptedStorageServiceRoleKey,
            encryptionKey,
          ),
          storagePrivateBucket: prepared.storagePrivateBucket,
          storagePublicBucket: prepared.storagePublicBucket,
          storageMaxPdfBytes,
          zoteroTranslationUrl: optionalEnvironmentValue(
            "EL_ZOTERO_TRANSLATION_URL",
          ),
        },
      });
      const runtimeConfigJson = JSON.stringify(configuration);
      const runtimeConfigSha256 = createHash("sha256")
        .update(runtimeConfigJson)
        .digest("hex");
      const application = await reconcileCoolifyApplication({
        coolifyUrl: requireHttpsOrigin("EL_COOLIFY_URL"),
        token: requireEnvironmentValue("EL_COOLIFY_TOKEN"),
        serverUuid: requireEnvironmentValue("EL_COOLIFY_SERVER_UUID"),
        projectUuid: requireEnvironmentValue("EL_COOLIFY_PROJECT_UUID"),
        environmentName: requireEnvironmentValue("EL_COOLIFY_ENVIRONMENT"),
        githubAppUuid: requireEnvironmentValue("EL_COOLIFY_GITHUB_APP_UUID"),
        libraryId: args.libraryId,
        targetBaseUrl: prepared.targetBaseUrl,
        runtimeCommit: prepared.runtimeCommit,
        runtimeConfigJson,
        searchKey: resolvedSearchKey,
      });
      return await ctx.runMutation(
        internal.evidenceLibraries.applicationSetup.completeApplicationSetup,
        {
          ...args,
          outcome: application.outcome,
          applicationId: application.applicationId,
          runtimeCommit: prepared.runtimeCommit,
          runtimeConfigSha256,
          coolifyConfigHash: application.coolifyConfigHash,
          searchHost: SEARCH_HOST,
          searchIndex: SEARCH_INDEX,
          storageUrl,
          storagePrivateBucket: prepared.storagePrivateBucket,
          storagePublicBucket: prepared.storagePublicBucket,
          storageMaxPdfBytes,
          zoteroTranslationUrl: optionalEnvironmentValue(
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
