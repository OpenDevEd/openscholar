"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { ConfigurationAssemblyError } from "../../lib/evidence-libraries/configuration/assembly";
import {
  CoolifyClientError,
  createCoolifyClient,
  type CoolifyDeployment,
} from "./coolifyClient";
import {
  ReadinessClientError,
  requireLibraryRuntimeReady,
} from "./readinessClient";
import { assembleEvidenceLibraryRuntimePayload } from "./runtimeConfiguration";

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new CoolifyClientError(
      "INVALID_CONFIGURATION_DEPLOYMENT_CONFIG",
      `${name} is not configured`,
    );
  }
  return value;
}

function requireHttpsOrigin(name: string): string {
  const value = requireEnvironmentValue(name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CoolifyClientError(
      "INVALID_CONFIGURATION_DEPLOYMENT_CONFIG",
      `${name} must be a valid HTTPS origin`,
    );
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new CoolifyClientError(
      "INVALID_CONFIGURATION_DEPLOYMENT_CONFIG",
      `${name} must be a valid HTTPS origin`,
    );
  }
  return url.origin;
}

function requireMatchingDeployment(
  deployment: CoolifyDeployment,
  expected: {
    runtimeCommit: string;
    coolifyConfigHash: string;
  },
) {
  if (
    deployment.runtimeCommit !== expected.runtimeCommit ||
    (deployment.coolifyConfigHash !== null &&
      deployment.coolifyConfigHash !== expected.coolifyConfigHash)
  ) {
    throw new CoolifyClientError(
      "COOLIFY_DEPLOYMENT_CONFLICT",
      "Coolify deployed another Evidence Library configuration",
    );
  }
}

type ConfigurationDeploymentActionResult =
  | { status: "failed" }
  | { pollCount: number; status: "running" }
  | { status: "succeeded" };

export const runConfigurationDeployment = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptCount: v.number(),
    pollCount: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("failed") }),
    v.object({ pollCount: v.number(), status: v.literal("running") }),
    v.object({ status: v.literal("succeeded") }),
  ),
  handler: async (ctx, args): Promise<ConfigurationDeploymentActionResult> => {
    try {
      const prepared = await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .prepareConfigurationDeployment,
        args,
      );
      const configuration = assembleEvidenceLibraryRuntimePayload({
        encryptionKey: requireEnvironmentValue("ENCRYPTION_KEY"),
        libraryId: args.libraryId,
        revisionKey: prepared.revisionKey,
        revisionCreatedAt: prepared.revisionCreatedAt,
        appOrigin: requireHttpsOrigin("EL_OPENSCHOLAR_URL"),
        convexSiteUrl: requireHttpsOrigin("EL_CONVEX_SITE_URL"),
        sections: prepared.sections,
        encryptedMachineCredential: prepared.encryptedMachineCredential,
        encryptedAuthenticationSecret: prepared.encryptedAuthenticationSecret,
        encryptedDatabaseUrl: prepared.encryptedDatabaseUrl,
        searchHost: prepared.searchHost,
        encryptedSearchKey: prepared.encryptedSearchKey,
        searchIndex: prepared.searchIndex,
        storageUrl: prepared.storageUrl,
        encryptedStorageServiceRoleKey: prepared.encryptedStorageServiceRoleKey,
        storagePrivateBucket: prepared.storagePrivateBucket,
        storagePublicBucket: prepared.storagePublicBucket,
        storageMaxPdfBytes: prepared.storageMaxPdfBytes,
        zoteroTranslationUrl: prepared.zoteroTranslationUrl,
      });
      const coolify = createCoolifyClient({
        origin: requireHttpsOrigin("EL_COOLIFY_URL"),
        token: requireEnvironmentValue("EL_COOLIFY_TOKEN"),
      });
      const application = await coolify.updateApplicationConfiguration({
        applicationUuid: prepared.applicationId,
        libraryId: args.libraryId,
        publicDomain: prepared.targetBaseUrl,
        libraryConfigJson: configuration.runtimeConfigJson,
      });
      if (
        prepared.savedReceipt &&
        (prepared.savedReceipt.revisionKey !== prepared.revisionKey ||
          prepared.savedReceipt.runtimeConfigSha256 !==
            application.runtimeConfigSha256 ||
          prepared.savedReceipt.runtimeCommit !== application.runtimeCommit ||
          prepared.savedReceipt.coolifyConfigHash !==
            application.coolifyConfigHash)
      ) {
        throw new CoolifyClientError(
          "COOLIFY_DEPLOYMENT_CONFLICT",
          "The bound Coolify application changed after deployment started",
        );
      }

      let deployment: CoolifyDeployment;
      let deploymentId = prepared.savedReceipt?.deploymentId;
      if (deploymentId) {
        deployment = await coolify.readDeployment(deploymentId);
        requireMatchingDeployment(deployment, application);
        if (deployment.state === "failed" || deployment.state === "cancelled") {
          if (args.attemptCount < 2) {
            throw new CoolifyClientError(
              "COOLIFY_DEPLOYMENT_FAILED",
              "Coolify could not deploy the Evidence Library",
            );
          }
          const replacedDeploymentId = deploymentId;
          const selected = await coolify.startOrAdoptDeployment({
            applicationUuid: prepared.applicationId,
            runtimeCommit: application.runtimeCommit,
            coolifyConfigHash: application.coolifyConfigHash,
          });
          if (selected.outcome === "adoption-unavailable") {
            throw new CoolifyClientError(
              "COOLIFY_DEPLOYMENT_RECOVERY_UNSAFE",
              "Coolify cannot safely identify the matching deployment",
            );
          }
          deploymentId =
            selected.outcome === "adopted"
              ? selected.deployment.deploymentUuid
              : selected.deploymentUuid;
          await ctx.runMutation(
            internal.evidenceLibraries.configurationDeployment
              .saveConfigurationDeploymentReceipt,
            {
              libraryId: args.libraryId,
              operationId: args.operationId,
              attemptCount: args.attemptCount,
              deploymentId,
              runtimeCommit: application.runtimeCommit,
              runtimeConfigSha256: application.runtimeConfigSha256,
              coolifyConfigHash: application.coolifyConfigHash,
              replacesDeploymentId: replacedDeploymentId,
            },
          );
          deployment =
            selected.outcome === "adopted"
              ? selected.deployment
              : await coolify.readDeployment(deploymentId);
        }
      } else {
        const selected = await coolify.startOrAdoptDeployment({
          applicationUuid: prepared.applicationId,
          runtimeCommit: application.runtimeCommit,
          coolifyConfigHash: application.coolifyConfigHash,
        });
        if (selected.outcome === "adoption-unavailable") {
          throw new CoolifyClientError(
            "COOLIFY_DEPLOYMENT_RECOVERY_UNSAFE",
            "Coolify cannot safely identify the matching deployment",
          );
        }
        deploymentId =
          selected.outcome === "adopted"
            ? selected.deployment.deploymentUuid
            : selected.deploymentUuid;
        await ctx.runMutation(
          internal.evidenceLibraries.configurationDeployment
            .saveConfigurationDeploymentReceipt,
          {
            libraryId: args.libraryId,
            operationId: args.operationId,
            attemptCount: args.attemptCount,
            deploymentId,
            runtimeCommit: application.runtimeCommit,
            runtimeConfigSha256: application.runtimeConfigSha256,
            coolifyConfigHash: application.coolifyConfigHash,
          },
        );
        deployment =
          selected.outcome === "adopted"
            ? selected.deployment
            : await coolify.readDeployment(deploymentId);
      }

      requireMatchingDeployment(deployment, application);
      if (deployment.state === "active") {
        return await ctx.runMutation(
          internal.evidenceLibraries.configurationDeployment
            .scheduleConfigurationDeploymentPoll,
          args,
        );
      }
      if (deployment.state !== "finished") {
        throw new CoolifyClientError(
          "COOLIFY_DEPLOYMENT_FAILED",
          "Coolify could not deploy the Evidence Library",
        );
      }
      if (deployment.coolifyConfigHash !== application.coolifyConfigHash) {
        throw new CoolifyClientError(
          "COOLIFY_DEPLOYMENT_CONFLICT",
          "Coolify did not report the deployed configuration",
        );
      }

      const readiness = await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .prepareConfigurationActivation,
        {
          libraryId: args.libraryId,
          operationId: args.operationId,
          attemptCount: args.attemptCount,
        },
      );
      await coolify.requireFinishedDeployment({
        applicationUuid: readiness.applicationId,
        deploymentUuid: readiness.deploymentId,
        runtimeCommit: readiness.runtimeCommit,
        coolifyConfigHash: readiness.coolifyConfigHash,
      });
      await requireLibraryRuntimeReady({
        applicationUuid: readiness.applicationId,
        runtimeCommit: readiness.runtimeCommit,
        revisionKey: readiness.revisionKey,
        targetBaseUrl: readiness.targetBaseUrl,
        defaultLocale: readiness.defaultLocale,
        verifierUrl: requireHttpsOrigin("EL_RUNTIME_VERIFIER_URL"),
        verifierToken: requireEnvironmentValue("EL_RUNTIME_VERIFIER_TOKEN"),
      });
      return await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .completeConfigurationDeployment,
        {
          libraryId: args.libraryId,
          operationId: args.operationId,
          attemptCount: args.attemptCount,
          checkedAt: Date.now(),
        },
      );
    } catch (error) {
      const safeError =
        error instanceof CoolifyClientError ||
        error instanceof ReadinessClientError
          ? { code: error.code, message: error.message }
          : error instanceof ConfigurationAssemblyError
            ? {
                code: "CONFIGURATION_ASSEMBLY_FAILED",
                message:
                  "Evidence Library configuration could not be assembled",
              }
            : {
                code: "CONFIGURATION_DEPLOYMENT_FAILED",
                message: "Evidence Library configuration could not be deployed",
              };
      await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .failConfigurationDeployment,
        {
          libraryId: args.libraryId,
          operationId: args.operationId,
          attemptCount: args.attemptCount,
          error: safeError,
        },
      );
      return { status: "failed" as const };
    }
  },
});
