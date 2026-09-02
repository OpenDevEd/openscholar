"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import {
  CoolifyClientError,
  createCoolifyClient,
  requireMatchingCoolifyDeployment,
  type CoolifyDeployment,
} from "./coolifyClient";
import {
  requireRuntimeEnvironment,
  requireRuntimeHttpsOrigin,
} from "./runtimeActionConfig";
import {
  changeLibraryRuntimeRoute,
  ReadinessClientError,
  requireLibraryRuntimeRouteReady,
} from "./readinessClient";

const invalidCoolifyConfig = (message: string) =>
  new CoolifyClientError("INVALID_COOLIFY_CONFIG", message);

type DeploymentSetupActionResult =
  | { status: "failed" }
  | { pollCount: number; status: "running" }
  | { nextStep: "health_check"; status: "running" };

export const runDeploymentSetup = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("failed") }),
    v.object({ pollCount: v.number(), status: v.literal("running") }),
    v.object({
      nextStep: v.literal("health_check"),
      status: v.literal("running"),
    }),
  ),
  handler: async (ctx, args): Promise<DeploymentSetupActionResult> => {
    try {
      const prepared = await ctx.runMutation(
        internal.evidenceLibraries.deploymentSetup.prepareDeploymentSetup,
        args,
      );
      const maintenanceRoute = {
        applicationUuid: prepared.applicationId,
        customOrigins: [],
        platformOrigins: [prepared.targetBaseUrl],
        revisionKey: prepared.revisionKey,
        runtimeCommit: prepared.runtimeCommit,
        runtimeImage: prepared.runtimeImage,
        verifierUrl: requireRuntimeHttpsOrigin(
          "EL_RUNTIME_VERIFIER_URL",
          invalidCoolifyConfig,
        ),
        verifierToken: requireRuntimeEnvironment(
          "EL_RUNTIME_VERIFIER_TOKEN",
          invalidCoolifyConfig,
        ),
      };
      await changeLibraryRuntimeRoute("maintenance", maintenanceRoute);
      await requireLibraryRuntimeRouteReady(
        maintenanceRoute,
        prepared.targetBaseUrl,
      );
      const client = createCoolifyClient({
        origin: requireRuntimeEnvironment(
          "EL_COOLIFY_URL",
          invalidCoolifyConfig,
        ),
        token: requireRuntimeEnvironment(
          "EL_COOLIFY_TOKEN",
          invalidCoolifyConfig,
        ),
      });
      const application = await client.readBoundApplication({
        applicationUuid: prepared.applicationId,
        libraryId: args.libraryId,
        publicDomain: prepared.targetBaseUrl,
        // A library being set up has no custom domains yet.
        customDomains: [],
        runtimeCommit: prepared.runtimeCommit,
        runtimeImage: prepared.runtimeImage,
      });
      if (
        application.runtimeCommit !== prepared.runtimeCommit ||
        application.runtimeImage !== prepared.runtimeImage
      ) {
        throw new CoolifyClientError(
          "COOLIFY_DEPLOYMENT_CONFLICT",
          "The bound Coolify application changed before deployment",
        );
      }

      let deploymentId = prepared.deploymentId;
      let deployment: CoolifyDeployment;
      if (!deploymentId) {
        const selected = await client.startOrAdoptDeployment({
          applicationUuid: prepared.applicationId,
          runtimeCommit: prepared.runtimeCommit,
          coolifyConfigHash: application.coolifyConfigHash,
          notBefore: prepared.deploymentNotBefore,
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
          internal.evidenceLibraries.deploymentSetup.saveDeploymentSetupId,
          {
            ...args,
            deploymentId,
            outcome: selected.outcome === "adopted" ? "matched" : "created",
          },
        );
        deployment =
          selected.outcome === "adopted"
            ? selected.deployment
            : await client.readDeployment(deploymentId);
      } else {
        deployment = await client.readDeployment(deploymentId);
      }

      requireMatchingCoolifyDeployment(deployment, prepared);
      if (deployment.state === "active") {
        return await ctx.runMutation(
          internal.evidenceLibraries.deploymentSetup.scheduleDeploymentPoll,
          { ...args, deploymentId },
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
      return await ctx.runMutation(
        internal.evidenceLibraries.deploymentSetup.completeDeploymentSetup,
        {
          ...args,
          deploymentId,
          coolifyConfigHash: deployment.coolifyConfigHash,
        },
      );
    } catch (error) {
      const safeError =
        error instanceof CoolifyClientError ||
        error instanceof ReadinessClientError
          ? { code: error.code, message: error.message }
          : {
              code: "DEPLOYMENT_SETUP_FAILED",
              message: "Evidence Library deployment could not be checked",
            };
      if (safeError.code === "DEPLOYMENT_SETUP_FAILED") {
        console.error("[evidence-library] deployment setup failed", {
          libraryId: args.libraryId,
          operationId: args.operationId,
          error,
        });
      }
      await ctx.runMutation(
        internal.evidenceLibraries.setupOperation.failSetupOperation,
        {
          ...args,
          expectedStage: "deployment",
          error: safeError,
        },
      );
      return { status: "failed" as const };
    }
  },
});
