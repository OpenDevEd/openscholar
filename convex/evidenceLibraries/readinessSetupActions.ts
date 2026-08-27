"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { CoolifyClientError, createCoolifyClient } from "./coolifyClient";
import {
  isAddressNotOursError,
  isRetryableReadinessError,
  ReadinessClientError,
  requireLibraryRuntimeReady,
} from "./readinessClient";
import { requireRuntimeEnvironment } from "./runtimeActionConfig";

const invalidReadinessConfig = (message: string) =>
  new ReadinessClientError("READINESS_CONFIG_INVALID", message);

type ReadinessSetupActionResult =
  | { status: "failed" }
  | { movedTo: string; status: "moving" }
  | { pollCount: number; status: "running" }
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
    v.object({ movedTo: v.string(), status: v.literal("moving") }),
    v.object({ pollCount: v.number(), status: v.literal("running") }),
    v.object({ status: v.literal("succeeded") }),
  ),
  handler: async (ctx, args): Promise<ReadinessSetupActionResult> => {
    try {
      const prepared = await ctx.runMutation(
        internal.evidenceLibraries.readinessSetup.prepareReadinessSetup,
        args,
      );
      const coolify = createCoolifyClient({
        origin: requireRuntimeEnvironment(
          "EL_COOLIFY_URL",
          invalidReadinessConfig,
        ),
        token: requireRuntimeEnvironment(
          "EL_COOLIFY_TOKEN",
          invalidReadinessConfig,
        ),
      });
      await coolify.requireFinishedDeployment({
        deploymentUuid: prepared.deploymentId,
        runtimeCommit: prepared.runtimeCommit,
        coolifyConfigHash: prepared.coolifyConfigHash,
      });
      await requireLibraryRuntimeReady({
        applicationUuid: prepared.applicationId,
        runtimeCommit: prepared.runtimeCommit,
        revisionKey: prepared.revisionKey,
        targetBaseUrl: prepared.targetBaseUrl,
        verifierUrl: requireRuntimeEnvironment(
          "EL_RUNTIME_VERIFIER_URL",
          invalidReadinessConfig,
        ),
        verifierToken: requireRuntimeEnvironment(
          "EL_RUNTIME_VERIFIER_TOKEN",
          invalidReadinessConfig,
        ),
      });
      return await ctx.runMutation(
        internal.evidenceLibraries.readinessSetup.completeReadinessSetup,
        args,
      );
    } catch (error) {
      if (isRetryableReadinessError(error)) {
        const retry = await ctx.runMutation(
          internal.evidenceLibraries.readinessSetup.scheduleReadinessPoll,
          args,
        );
        if (retry.status === "running") return retry;
      }
      if (isAddressNotOursError(error)) {
        // Waiting cannot free an address another site holds. Move once and
        // let the Coolify steps run again; a failed move falls through.
        const moved = await ctx
          .runMutation(
            internal.evidenceLibraries.readinessSetup.moveSetupAddress,
            args,
          )
          .catch(() => null);
        if (moved?.status === "moving") {
          return { movedTo: moved.movedTo, status: "moving" as const };
        }
      }
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
