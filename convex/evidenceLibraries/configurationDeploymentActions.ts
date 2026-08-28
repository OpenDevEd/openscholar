"use node";

import { createHash } from "node:crypto";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { ConfigurationAssemblyError } from "../../lib/evidence-libraries/configuration/assembly";
import { decrypt, encrypt } from "../lib/crypto";
import {
  CoolifyClientError,
  createCoolifyClient,
  requireMatchingCoolifyDeployment,
  type CoolifyConfigurationUpdateResult,
  type CoolifyDeployment,
} from "./coolifyClient";
import {
  isRetryableReadinessError,
  ReadinessClientError,
  requireLibraryRuntimeReady,
} from "./readinessClient";
import {
  optionalPlatformBrandAssets,
  optionalPlatformMailService,
  requireRuntimeEnvironment,
  requireRuntimeHttpsOrigin,
} from "./runtimeActionConfig";
import {
  assembleEvidenceLibraryRuntimePayload,
  buildEvidenceLibraryLoginPageUrl,
} from "./runtimeConfiguration";

const invalidConfiguration = (message: string) =>
  new CoolifyClientError("INVALID_CONFIGURATION_DEPLOYMENT_CONFIG", message);

type ConfigurationDeploymentActionResult =
  | { status: "failed" }
  | { pollCount: number; status: "running" }
  | { status: "succeeded" };

type ConfigurationDeploymentTarget = NonNullable<
  Doc<"evidenceLibraryConfigOperations">["configurationDeploymentTarget"]
>;

export const runConfigurationDeployment = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("failed") }),
    v.object({ pollCount: v.number(), status: v.literal("running") }),
    v.object({ status: v.literal("succeeded") }),
  ),
  handler: async (ctx, args): Promise<ConfigurationDeploymentActionResult> => {
    try {
      const encryptionKey = requireRuntimeEnvironment(
        "ENCRYPTION_KEY",
        invalidConfiguration,
      );
      const coolify = createCoolifyClient({
        origin: requireRuntimeEnvironment(
          "EL_COOLIFY_URL",
          invalidConfiguration,
        ),
        token: requireRuntimeEnvironment(
          "EL_COOLIFY_TOKEN",
          invalidConfiguration,
        ),
      });
      let prepared = await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .prepareConfigurationDeployment,
        args,
      );

      let target: ConfigurationDeploymentTarget;
      const savedDeployment =
        prepared.state === "saved" ? prepared.deployment : undefined;
      const runtimeUpdate = prepared.runtimeUpdate;
      if (prepared.state === "saved") {
        target = prepared.target;
      } else {
        // A move changes Coolify's domain first. Only when the application
        // answers on the new address do the records take it, so a failure
        // here leaves the library on the address it has.
        if (prepared.addressMove && !prepared.addressMove.applied) {
          await coolify.setApplicationDomain({
            applicationUuid: prepared.applicationId,
            libraryId: args.libraryId,
            currentPublicDomain: prepared.addressMove.from,
            nextPublicDomain: prepared.addressMove.to,
          });
          await ctx.runMutation(
            internal.evidenceLibraries.configurationDeployment
              .applyConfigurationAddressMove,
            args,
          );
          // Read the deployment again: the sections and the binding now
          // carry the new address.
          prepared = await ctx.runMutation(
            internal.evidenceLibraries.configurationDeployment
              .prepareConfigurationDeployment,
            args,
          );
          if (prepared.state !== "new") {
            throw new CoolifyClientError(
              "CONFIGURATION_TARGET_INVALID",
              "The Evidence Library move changed the deployment target",
            );
          }
        }
        const application = await coolify.readBoundApplication({
          applicationUuid: prepared.applicationId,
          libraryId: args.libraryId,
          publicDomain: prepared.targetBaseUrl,
        });
        if (
          runtimeUpdate &&
          application.runtimeCommit !== runtimeUpdate.from &&
          application.runtimeCommit !== runtimeUpdate.to
        ) {
          throw new CoolifyClientError(
            "COOLIFY_APPLICATION_CONFLICT",
            "The bound Coolify application runs unexpected software",
          );
        }
        const payload = assembleEvidenceLibraryRuntimePayload({
          encryptionKey,
          libraryId: args.libraryId,
          revision: prepared.revision,
          origins: {
            app: requireRuntimeHttpsOrigin(
              "EL_OPENSCHOLAR_URL",
              invalidConfiguration,
            ),
            convexSite: requireRuntimeHttpsOrigin(
              "EL_CONVEX_SITE_URL",
              invalidConfiguration,
            ),
          },
          sections: Object.fromEntries(
            prepared.sections.map((row) => [row.sectionKey, row.payload]),
          ),
          credentials: prepared.credentials,
          search: prepared.search,
          storage: prepared.storage,
          zoteroTranslationUrl: prepared.zoteroTranslationUrl,
          mail: optionalPlatformMailService(invalidConfiguration),
          brand: optionalPlatformBrandAssets(invalidConfiguration),
          zoteroGroups: prepared.zoteroGroups,
        });
        target = await ctx.runMutation(
          internal.evidenceLibraries.configurationDeployment
            .saveConfigurationDeploymentTarget,
          {
            ...args,
            source: prepared.source,
            target: {
              applicationId: prepared.applicationId,
              targetBaseUrl: prepared.targetBaseUrl,
              revisionKey: prepared.revision.key,
              defaultLocale: prepared.defaultLocale,
              runtimeCommit: runtimeUpdate?.to ?? application.runtimeCommit,
              encryptedRuntimeConfig: encrypt(
                payload.runtimeConfigJson,
                encryptionKey,
              ),
              runtimeConfigSha256: payload.runtimeConfigSha256,
            },
          },
        );
      }

      const runtimeConfigJson = decrypt(
        target.encryptedRuntimeConfig,
        encryptionKey,
      );
      const runtimeConfigSha256 = createHash("sha256")
        .update(runtimeConfigJson)
        .digest("hex");
      if (runtimeConfigSha256 !== target.runtimeConfigSha256) {
        throw new CoolifyClientError(
          "CONFIGURATION_TARGET_INVALID",
          "The saved Evidence Library configuration target is invalid",
        );
      }

      let application: CoolifyConfigurationUpdateResult;
      if (savedDeployment) {
        const current = await coolify.requireBoundApplicationConfiguration({
          applicationUuid: target.applicationId,
          libraryId: args.libraryId,
          publicDomain: target.targetBaseUrl,
          runtimeCommit: target.runtimeCommit,
          libraryConfigJson: runtimeConfigJson,
        });
        application = {
          applicationUuid: target.applicationId,
          runtimeCommit: target.runtimeCommit,
          runtimeConfigSha256: target.runtimeConfigSha256,
          coolifyConfigHash: current.coolifyConfigHash,
        };
      } else {
        // A runtime update points the app at the new commit first, so the
        // configuration write and the deployment both see that commit.
        if (runtimeUpdate) {
          await coolify.setApplicationCommit({
            applicationUuid: target.applicationId,
            libraryId: args.libraryId,
            publicDomain: target.targetBaseUrl,
            runtimeCommit: target.runtimeCommit,
          });
        }
        application = await coolify.updateApplicationConfiguration({
          applicationUuid: target.applicationId,
          libraryId: args.libraryId,
          publicDomain: target.targetBaseUrl,
          libraryConfigJson: runtimeConfigJson,
          expectedRuntimeCommit: target.runtimeCommit,
        });
        if (
          application.runtimeCommit !== target.runtimeCommit ||
          application.runtimeConfigSha256 !== target.runtimeConfigSha256
        ) {
          throw new CoolifyClientError(
            "COOLIFY_DEPLOYMENT_CONFLICT",
            "Coolify did not save the requested Evidence Library configuration",
          );
        }
      }

      let deployment: CoolifyDeployment;
      let deploymentId = savedDeployment?.deploymentId;
      if (deploymentId) {
        deployment = await coolify.readDeployment(deploymentId);
        requireMatchingCoolifyDeployment(deployment, application);
        if (deployment.state === "failed" || deployment.state === "cancelled") {
          if (args.attemptCount < 2) {
            throw new CoolifyClientError(
              "COOLIFY_DEPLOYMENT_FAILED",
              "Coolify could not deploy the Evidence Library",
            );
          }
          const replacedDeploymentId = deploymentId;
          const selected = await coolify.startOrAdoptDeployment({
            applicationUuid: target.applicationId,
            runtimeCommit: target.runtimeCommit,
            coolifyConfigHash: application.coolifyConfigHash,
            notBefore: target.savedAt,
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
              ...args,
              deploymentId,
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
          applicationUuid: target.applicationId,
          runtimeCommit: target.runtimeCommit,
          coolifyConfigHash: application.coolifyConfigHash,
          notBefore: target.savedAt,
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
            ...args,
            deploymentId,
            coolifyConfigHash: application.coolifyConfigHash,
          },
        );
        deployment =
          selected.outcome === "adopted"
            ? selected.deployment
            : await coolify.readDeployment(deploymentId);
      }

      requireMatchingCoolifyDeployment(deployment, application);
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
      if (!deployment.coolifyConfigHash) {
        throw new CoolifyClientError(
          "COOLIFY_DEPLOYMENT_CONFLICT",
          "Coolify did not report the finished deployment configuration",
        );
      }
      await coolify.requireBoundApplicationConfiguration({
        applicationUuid: target.applicationId,
        libraryId: args.libraryId,
        publicDomain: target.targetBaseUrl,
        runtimeCommit: target.runtimeCommit,
        libraryConfigJson: runtimeConfigJson,
      });
      await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .saveConfigurationDeploymentReceipt,
        {
          ...args,
          deploymentId,
          coolifyConfigHash: deployment.coolifyConfigHash,
        },
      );

      const readiness = await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .prepareConfigurationActivation,
        args,
      );
      await coolify.requireFinishedDeployment({
        deploymentUuid: readiness.deploymentId,
        runtimeCommit: readiness.runtimeCommit,
        coolifyConfigHash: readiness.coolifyConfigHash,
      });
      await requireLibraryRuntimeReady({
        applicationUuid: readiness.applicationId,
        runtimeCommit: readiness.runtimeCommit,
        revisionKey: readiness.revisionKey,
        targetBaseUrl: readiness.targetBaseUrl,
        loginPageUrl: buildEvidenceLibraryLoginPageUrl({
          libraryId: args.libraryId,
          appOrigin: requireRuntimeHttpsOrigin(
            "EL_OPENSCHOLAR_URL",
            invalidConfiguration,
          ),
        }),
        verifierUrl: requireRuntimeHttpsOrigin(
          "EL_RUNTIME_VERIFIER_URL",
          invalidConfiguration,
        ),
        verifierToken: requireRuntimeEnvironment(
          "EL_RUNTIME_VERIFIER_TOKEN",
          invalidConfiguration,
        ),
      });
      return await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .completeConfigurationDeployment,
        { ...args, checkedAt: Date.now() },
      );
    } catch (error) {
      if (isRetryableReadinessError(error)) {
        const retry = await ctx.runMutation(
          internal.evidenceLibraries.configurationDeployment
            .scheduleConfigurationReadinessPoll,
          args,
        );
        if (retry.status === "running") return retry;
      }
      const safeError =
        error instanceof CoolifyClientError ||
        error instanceof ReadinessClientError
          ? { code: error.code, message: error.message }
          : error instanceof ConfigurationAssemblyError
            ? {
                code: "CONFIGURATION_ASSEMBLY_FAILED",
                message:
                  "Evidence Library configuration could not be assembled",
                issues: error.issues.map(({ pointer, message }) => ({
                  pointer,
                  message,
                })),
              }
            : {
                code: "CONFIGURATION_DEPLOYMENT_FAILED",
                message: "Evidence Library configuration could not be deployed",
              };
      await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .failConfigurationDeployment,
        { ...args, error: safeError },
      );
      return { status: "failed" as const };
    }
  },
});
