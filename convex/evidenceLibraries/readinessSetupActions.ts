"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { CoolifyClientError, createCoolifyClient } from "./coolifyClient";
import {
  ReadinessClientError,
  requireLibraryRuntimeReady,
} from "./readinessClient";

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      `${name} is not configured`,
    );
  }
  return value;
}

type ReadinessSetupActionResult =
  | { status: "failed" }
  | { status: "succeeded" };

export const runReadinessSetup = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("failed") }),
    v.object({ status: v.literal("succeeded") }),
  ),
  handler: async (ctx, args): Promise<ReadinessSetupActionResult> => {
    try {
      const prepared = await ctx.runMutation(
        internal.evidenceLibraries.readinessSetup.prepareReadinessSetup,
        args,
      );
      const coolify = createCoolifyClient({
        origin: requireEnvironmentValue("EL_COOLIFY_URL"),
        token: requireEnvironmentValue("EL_COOLIFY_TOKEN"),
      });
      await coolify.requireFinishedDeployment({
        applicationUuid: prepared.applicationId,
        deploymentUuid: prepared.deploymentId,
        runtimeCommit: prepared.runtimeCommit,
        coolifyConfigHash: prepared.coolifyConfigHash,
      });
      await requireLibraryRuntimeReady({
        applicationUuid: prepared.applicationId,
        runtimeCommit: prepared.runtimeCommit,
        revisionKey: prepared.revisionKey,
        targetBaseUrl: prepared.targetBaseUrl,
        defaultLocale: prepared.defaultLocale,
        verifierUrl: requireEnvironmentValue("EL_RUNTIME_VERIFIER_URL"),
        verifierToken: requireEnvironmentValue("EL_RUNTIME_VERIFIER_TOKEN"),
      });
      return await ctx.runMutation(
        internal.evidenceLibraries.readinessSetup.completeReadinessSetup,
        args,
      );
    } catch (error) {
      const safeError =
        error instanceof CoolifyClientError ||
        error instanceof ReadinessClientError
          ? { code: error.code, message: error.message }
          : {
              code: "READINESS_CHECK_FAILED",
              message: "Evidence Library readiness could not be confirmed",
            };
      await ctx.runMutation(
        internal.evidenceLibraries.setupOperation.failSetupOperation,
        {
          ...args,
          expectedStage: "health_check",
          error: safeError,
        },
      );
      return { status: "failed" as const };
    }
  },
});
