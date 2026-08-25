"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import {
  CoolifyClientError,
  createCoolifyClient,
  type CoolifyDeployment,
} from "./coolifyClient";

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new CoolifyClientError(
      "INVALID_COOLIFY_CONFIG",
      `${name} is not configured`,
    );
  }
  return value;
}

function requireExpectedDeployment(
  deployment: CoolifyDeployment,
  expected: { runtimeCommit: string; coolifyConfigHash: string },
) {
  if (deployment.runtimeCommit !== expected.runtimeCommit) {
    throw new CoolifyClientError(
      "COOLIFY_DEPLOYMENT_CONFLICT",
      "Coolify deployed another Evidence Library release",
    );
  }
  if (
    deployment.coolifyConfigHash !== null &&
    deployment.coolifyConfigHash !== expected.coolifyConfigHash
  ) {
    throw new CoolifyClientError(
      "COOLIFY_DEPLOYMENT_CONFLICT",
      "Coolify deployed another Evidence Library configuration",
    );
  }
}

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
      const client = createCoolifyClient({
        origin: requireEnvironmentValue("EL_COOLIFY_URL"),
        token: requireEnvironmentValue("EL_COOLIFY_TOKEN"),
      });

      let deploymentId = prepared.deploymentId;
      let deployment: CoolifyDeployment;
      if (!deploymentId) {
        const selected = await client.startOrAdoptDeployment({
          applicationUuid: prepared.applicationId,
          runtimeCommit: prepared.runtimeCommit,
          coolifyConfigHash: prepared.coolifyConfigHash,
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

      requireExpectedDeployment(deployment, prepared);
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
      if (deployment.coolifyConfigHash !== prepared.coolifyConfigHash) {
        throw new CoolifyClientError(
          "COOLIFY_DEPLOYMENT_CONFLICT",
          "Coolify did not report the deployed configuration",
        );
      }
      return await ctx.runMutation(
        internal.evidenceLibraries.deploymentSetup.completeDeploymentSetup,
        { ...args, deploymentId },
      );
    } catch (error) {
      const safeError =
        error instanceof CoolifyClientError
          ? { code: error.code, message: error.message }
          : {
              code: "DEPLOYMENT_SETUP_FAILED",
              message: "Evidence Library deployment could not be checked",
            };
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
