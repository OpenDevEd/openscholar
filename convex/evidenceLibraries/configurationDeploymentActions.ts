"use node";

import { createHash } from "node:crypto";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import {
  featuresAiEnabled,
  selectedAiModelIds,
} from "../../lib/evidence-libraries/configuration/ai";
import {
  ConfigurationAssemblyError,
  type AssembledEvidenceLibraryConfiguration,
} from "../../lib/evidence-libraries/configuration/assembly";
import { decrypt, encrypt } from "../lib/crypto";
import {
  CoolifyClientError,
  createCoolifyClient,
  requireMatchingCoolifyDeployment,
  type CoolifyConfigurationUpdateResult,
  type CoolifyDeployment,
} from "./coolifyClient";
import { openPinnedDomainClient } from "./domainEgressNode";
import {
  activateLibraryRuntimeConfiguration,
  changeLibraryRuntimeRoute,
  handOffLibraryRuntime,
  isRetryableReadinessError,
  ReadinessClientError,
  requireLibraryRuntimePublicReady,
  requireLibraryRuntimeRouteReady,
  requireLibraryRuntimeServicesReady,
  restoreLibraryRuntimeConfiguration,
  type LibraryRuntimeRouteInput,
} from "./readinessClient";
import {
  optionalPlatformBrandAssets,
  optionalPlatformEmbeddingKey,
  optionalPlatformMailService,
  PlatformEmbeddingKeyMissingError,
  requirePlatformEmbeddingKey,
  requireRuntimeEnvironment,
  requireRuntimeHttpsOrigin,
} from "./runtimeActionConfig";
import {
  assembleEvidenceLibraryRuntimePayload,
  buildEvidenceLibraryLoginPageUrl,
} from "./runtimeConfiguration";
import { isRuntimeImageReference } from "./runtimeImageRegistry";
import type { RuntimeImageReference } from "./runtimeImageRegistry";

const invalidConfiguration = (message: string) =>
  new CoolifyClientError("INVALID_CONFIGURATION_DEPLOYMENT_CONFIG", message);

function requireTargetRuntimeImage(
  value: string | undefined,
): RuntimeImageReference {
  if (!isRuntimeImageReference(value)) {
    throw invalidConfiguration(
      "The saved Evidence Library runtime image is missing or invalid",
    );
  }
  return value;
}

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
    let protectionRoute: LibraryRuntimeRouteInput | undefined;
    let restoreDirectConfiguration: (() => Promise<void>) | undefined;
    try {
      const encryptionKey = requireRuntimeEnvironment(
        "ENCRYPTION_KEY",
        invalidConfiguration,
      );
      let prepared = await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .prepareConfigurationDeployment,
        args,
      );
      const coolify = prepared.requiresDeployment
        ? createCoolifyClient({
            origin: requireRuntimeEnvironment(
              "EL_COOLIFY_URL",
              invalidConfiguration,
            ),
            token: requireRuntimeEnvironment(
              "EL_COOLIFY_TOKEN",
              invalidConfiguration,
            ),
          })
        : null;

      let target: ConfigurationDeploymentTarget;
      const savedDeployment =
        prepared.state === "saved" ? prepared.deployment : undefined;
      const runtimeUpdate = prepared.runtimeUpdate;
      if (prepared.state === "new") {
        // Refuse an incomplete AI deployment before the continuity route or
        // the application is changed.
        requirePlatformEmbeddingKey(
          prepared.sections.some(
            (row) =>
              row.sectionKey === "features" && featuresAiEnabled(row.payload),
          ),
        );
      }
      const verifierUrl = requireRuntimeHttpsOrigin(
        "EL_RUNTIME_VERIFIER_URL",
        invalidConfiguration,
      );
      const verifierToken = requireRuntimeEnvironment(
        "EL_RUNTIME_VERIFIER_TOKEN",
        invalidConfiguration,
      );
      const pendingTarget =
        prepared.state === "saved"
          ? prepared.target
          : {
              customDomains: prepared.customDomains,
              targetBaseUrl: prepared.targetBaseUrl,
            };
      const platformOrigins = [
        ...new Set([
          prepared.continuity.platformOrigin,
          pendingTarget.targetBaseUrl,
        ]),
      ];
      const platformOriginSet = new Set(platformOrigins);
      const customOrigins = [
        ...new Set([
          ...prepared.continuity.customOrigins,
          ...pendingTarget.customDomains,
        ]),
      ].filter((origin) => !platformOriginSet.has(origin));
      protectionRoute = {
        applicationUuid: prepared.continuity.applicationId,
        customOrigins,
        platformOrigins,
        revisionKey: prepared.continuity.revisionKey,
        runtimeCommit: prepared.continuity.runtimeCommit,
        runtimeImage: prepared.continuity.runtimeImage,
        verifierToken,
        verifierUrl,
      };
      if (prepared.requiresDeployment && !savedDeployment) {
        await changeLibraryRuntimeRoute("protection", protectionRoute);
        await requireLibraryRuntimeRouteReady(
          protectionRoute,
          prepared.continuity.platformOrigin,
        );
      }
      if (prepared.state === "saved") {
        target = prepared.target;
      } else {
        // A move changes Coolify's domain first. Only when the application
        // answers on the new address do the records take it, so a failure
        // here leaves the library on the address it has.
        if (prepared.addressMove && !prepared.addressMove.applied) {
          if (!coolify)
            throw invalidConfiguration("Deployment client is missing");
          await coolify.setApplicationDomain({
            applicationUuid: prepared.applicationId,
            libraryId: args.libraryId,
            currentPublicDomain: prepared.addressMove.from,
            nextPublicDomain: prepared.addressMove.to,
            customDomains: prepared.customDomains,
          });
        }
        if (prepared.requiresDeployment) {
          if (!coolify)
            throw invalidConfiguration("Deployment client is missing");
          const application = await coolify.readBoundApplication({
            applicationUuid: prepared.applicationId,
            libraryId: args.libraryId,
            publicDomain: prepared.targetBaseUrl,
            customDomains: prepared.customDomains,
            ...(runtimeUpdate
              ? {}
              : {
                  runtimeCommit: prepared.runtimeCommit,
                  runtimeImage: prepared.runtimeImage,
                }),
          });
          const runningRuntimeImage = application.runtimeImage;
          const runsUpdateSource =
            runtimeUpdate !== undefined &&
            application.runtimeCommit === runtimeUpdate.from &&
            runningRuntimeImage === runtimeUpdate.fromImage;
          const runsUpdateTarget =
            runtimeUpdate !== undefined &&
            application.runtimeCommit === runtimeUpdate.to &&
            runningRuntimeImage === runtimeUpdate.toImage;
          const runsFailedTarget =
            runtimeUpdate !== undefined &&
            !runsUpdateSource &&
            !runsUpdateTarget &&
            (await ctx.runQuery(
              internal.evidenceLibraries.configurationDeployment
                .isFailedRuntimeTarget,
              {
                libraryId: args.libraryId,
                runtimeCommit: application.runtimeCommit,
                runtimeImage: runningRuntimeImage,
              },
            ));
          if (
            runtimeUpdate &&
            !runsUpdateSource &&
            !runsUpdateTarget &&
            !runsFailedTarget
          ) {
            throw new CoolifyClientError(
              "COOLIFY_APPLICATION_CONFLICT",
              "The bound deployment runs unexpected software",
            );
          }
        }
        const sections = Object.fromEntries(
          prepared.sections.map((row) => [row.sectionKey, row.payload]),
        );
        const modelCatalog = await ctx.runQuery(
          internal.models.queries.resolveEvidenceLibrarySelection,
          { modelIds: selectedAiModelIds(sections.ai) },
        );
        const team = await ctx.runQuery(
          internal.evidenceLibraries.queries.readLibraryTeamForAssembly,
          { libraryId: args.libraryId },
        );
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
          sections,
          credentials: prepared.credentials,
          search: prepared.search,
          storage: prepared.storage,
          zoteroTranslationUrl: prepared.zoteroTranslationUrl,
          mail: optionalPlatformMailService(invalidConfiguration),
          brand: optionalPlatformBrandAssets(invalidConfiguration),
          embeddingApiKey: optionalPlatformEmbeddingKey(),
          zoteroGroups: prepared.zoteroGroups,
          aiProviderKey: prepared.aiProviderKey,
          publicationProviders: prepared.publicationPayload,
          allowedAiModels: modelCatalog.allowedModelIds,
          aiModelMetadata: modelCatalog.modelMetadata,
          aiModelCatalogReady: modelCatalog.catalogReady,
          team,
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
              customDomains: prepared.customDomains,
              revisionKey: prepared.revision.key,
              defaultLocale: prepared.defaultLocale,
              runtimeCommit: prepared.runtimeCommit,
              runtimeImage: prepared.runtimeImage,
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
      const runtimeImage = requireTargetRuntimeImage(target.runtimeImage);
      const targetRoute = {
        applicationUuid: target.applicationId,
        customOrigins,
        platformOrigins,
        revisionKey: target.revisionKey,
        runtimeCommit: target.runtimeCommit,
        runtimeImage,
        verifierToken,
        verifierUrl,
      };

      if (!prepared.requiresDeployment) {
        const runtimeConfiguration = JSON.parse(
          runtimeConfigJson,
        ) as AssembledEvidenceLibraryConfiguration & {
          identity: { baseUrl: string };
        };
        const configurationBaseUrl = new URL(
          runtimeConfiguration.identity.baseUrl,
        ).origin;
        const configurationFetchImpl =
          configurationBaseUrl === new URL(target.targetBaseUrl).origin
            ? undefined
            : await openPinnedDomainClient({
                host: new URL(configurationBaseUrl).hostname,
              });
        const configurationInput = {
          ...(configurationFetchImpl
            ? { fetchImpl: configurationFetchImpl }
            : {}),
          baseUrl: configurationBaseUrl,
          machineCredential:
            runtimeConfiguration.authentication.openScholar.machineCredential,
        };
        restoreDirectConfiguration = async () => {
          await restoreLibraryRuntimeConfiguration({
            ...configurationInput,
            revisionKey: prepared.continuity.revisionKey,
          });
        };
        await activateLibraryRuntimeConfiguration({
          ...configurationInput,
          revisionKey: target.revisionKey,
          runtimeConfigJson,
          runtimeConfigSha256: target.runtimeConfigSha256,
        });
        await ctx.runMutation(
          internal.evidenceLibraries.configurationDeployment
            .saveConfigurationActivationReceipt,
          args,
        );
        const readiness = await ctx.runMutation(
          internal.evidenceLibraries.configurationDeployment
            .prepareConfigurationActivation,
          args,
        );
        const targetFetchImpl =
          readiness.targetBaseUrl === readiness.platformBaseUrl
            ? undefined
            : await openPinnedDomainClient({
                host: new URL(readiness.targetBaseUrl).hostname,
              });
        const readinessInput = {
          ...(targetFetchImpl ? { targetFetchImpl } : {}),
          applicationUuid: readiness.applicationId,
          runtimeCommit: readiness.runtimeCommit,
          runtimeImage: readiness.runtimeImage,
          revisionKey: readiness.revisionKey,
          targetBaseUrl: readiness.targetBaseUrl,
          platformBaseUrl: readiness.platformBaseUrl,
          loginPageUrl: buildEvidenceLibraryLoginPageUrl({
            libraryId: args.libraryId,
            appOrigin: requireRuntimeHttpsOrigin(
              "EL_OPENSCHOLAR_URL",
              invalidConfiguration,
            ),
          }),
          verifierUrl,
          verifierToken,
        };
        restoreDirectConfiguration = async () => {
          await restoreLibraryRuntimeConfiguration({
            ...configurationInput,
            revisionKey: prepared.continuity.revisionKey,
          });
          const previousReadiness = {
            ...readinessInput,
            revisionKey: prepared.continuity.revisionKey,
          };
          await requireLibraryRuntimePublicReady(previousReadiness, "native");
        };
        await requireLibraryRuntimeServicesReady(readinessInput);
        await requireLibraryRuntimePublicReady(readinessInput, "native");
        const result = await ctx.runMutation(
          internal.evidenceLibraries.configurationDeployment
            .completeConfigurationDeployment,
          { ...args, checkedAt: Date.now() },
        );
        restoreDirectConfiguration = undefined;
        return result;
      }

      if (!coolify) throw invalidConfiguration("Deployment client is missing");

      let application: CoolifyConfigurationUpdateResult;
      if (savedDeployment) {
        const current = await coolify.requireBoundApplicationConfiguration({
          applicationUuid: target.applicationId,
          libraryId: args.libraryId,
          publicDomain: target.targetBaseUrl,
          customDomains: target.customDomains,
          runtimeCommit: target.runtimeCommit,
          runtimeImage,
          libraryConfigJson: runtimeConfigJson,
        });
        application = {
          applicationUuid: target.applicationId,
          runtimeCommit: target.runtimeCommit,
          runtimeImage,
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
            customDomains: target.customDomains,
            runtimeCommit: target.runtimeCommit,
            runtimeImage,
          });
        }
        application = await coolify.updateApplicationConfiguration({
          applicationUuid: target.applicationId,
          libraryId: args.libraryId,
          publicDomain: target.targetBaseUrl,
          customDomains: target.customDomains,
          libraryConfigJson: runtimeConfigJson,
          expectedRuntimeCommit: target.runtimeCommit,
          expectedRuntimeImage: runtimeImage,
        });
        if (
          application.runtimeCommit !== target.runtimeCommit ||
          application.runtimeImage !== runtimeImage ||
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
      const boundApplication =
        await coolify.requireBoundApplicationConfiguration({
          applicationUuid: target.applicationId,
          libraryId: args.libraryId,
          publicDomain: target.targetBaseUrl,
          customDomains: target.customDomains,
          runtimeCommit: target.runtimeCommit,
          runtimeImage,
          libraryConfigJson: runtimeConfigJson,
        });
      await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .saveConfigurationDeploymentReceipt,
        {
          ...args,
          deploymentId,
          coolifyConfigHash:
            deployment.coolifyConfigHash ?? boundApplication.coolifyConfigHash,
        },
      );

      const readiness = await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .prepareConfigurationActivation,
        args,
      );
      if (!readiness.deploymentId || !readiness.coolifyConfigHash) {
        throw invalidConfiguration(
          "Evidence Library deployment receipt is incomplete",
        );
      }
      await coolify.requireFinishedDeployment({
        deploymentUuid: readiness.deploymentId,
        runtimeCommit: readiness.runtimeCommit,
        coolifyConfigHash: readiness.coolifyConfigHash,
        allowMissingConfigurationHash: true,
      });
      // The address the runtime is read at may be a customer's domain, whose
      // records they can repoint at any moment. Every readiness request to
      // one goes through a client that can only reach the addresses that
      // passed the check; a platform address is ours and needs no pinning.
      const targetFetchImpl =
        readiness.targetBaseUrl === readiness.platformBaseUrl
          ? undefined
          : await openPinnedDomainClient({
              host: new URL(readiness.targetBaseUrl).hostname,
            });
      const readinessInput = {
        // Only the requests to the library's own address are pinned. The
        // verifier and the platform address are ours, so they use the
        // ordinary client.
        ...(targetFetchImpl ? { targetFetchImpl } : {}),
        applicationUuid: readiness.applicationId,
        runtimeCommit: readiness.runtimeCommit,
        runtimeImage: readiness.runtimeImage,
        revisionKey: readiness.revisionKey,
        targetBaseUrl: readiness.targetBaseUrl,
        platformBaseUrl: readiness.platformBaseUrl,
        loginPageUrl: buildEvidenceLibraryLoginPageUrl({
          libraryId: args.libraryId,
          appOrigin: requireRuntimeHttpsOrigin(
            "EL_OPENSCHOLAR_URL",
            invalidConfiguration,
          ),
        }),
        verifierUrl,
        verifierToken,
      };
      await handOffLibraryRuntime(targetRoute, readinessInput);
      return await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .completeConfigurationDeployment,
        { ...args, checkedAt: Date.now() },
      );
    } catch (error) {
      // Coolify goes quiet for a moment while it redeploys an app or reloads
      // its proxy for a new domain. The run is safe to repeat, so an outage
      // waits on the same bounded poll as readiness instead of failing.
      if (
        isRetryableReadinessError(error) ||
        (error instanceof CoolifyClientError &&
          error.code === "COOLIFY_UNAVAILABLE")
      ) {
        try {
          const retry = await ctx.runMutation(
            internal.evidenceLibraries.configurationDeployment
              .scheduleConfigurationReadinessPoll,
            args,
          );
          if (retry.status === "running") return retry;
        } catch (retryError) {
          console.error(
            "[evidence-library] failed to schedule configuration readiness retry",
            {
              libraryId: args.libraryId,
              operationId: args.operationId,
              retryError,
            },
          );
        }
      }
      if (restoreDirectConfiguration) {
        await restoreDirectConfiguration().catch((recoveryError: unknown) => {
          console.error(
            "[evidence-library] failed to restore the previous configuration",
            {
              libraryId: args.libraryId,
              operationId: args.operationId,
              recoveryError,
            },
          );
        });
      }
      if (protectionRoute) {
        await changeLibraryRuntimeRoute("protection", protectionRoute).catch(
          (recoveryError: unknown) => {
            console.error(
              "[evidence-library] failed to restore protected traffic",
              {
                libraryId: args.libraryId,
                operationId: args.operationId,
                recoveryError,
              },
            );
          },
        );
      }
      const safeError =
        error instanceof CoolifyClientError ||
        error instanceof ReadinessClientError ||
        error instanceof PlatformEmbeddingKeyMissingError
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
      if (safeError.code === "CONFIGURATION_DEPLOYMENT_FAILED") {
        console.error("[evidence-library] configuration deployment failed", {
          libraryId: args.libraryId,
          operationId: args.operationId,
          error,
        });
      }
      await ctx.runMutation(
        internal.evidenceLibraries.configurationDeployment
          .failConfigurationDeployment,
        { ...args, error: safeError },
      );
      return { status: "failed" as const };
    }
  },
});
