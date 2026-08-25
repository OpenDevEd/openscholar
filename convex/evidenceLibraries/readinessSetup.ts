import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { readRevisionDefaultLocale } from "./revisionConfiguration";
import {
  recordEvidenceLibrarySetupStep,
  requireCurrentEvidenceLibrarySetupAttempt,
} from "./setupOperation";

function requireReadinessReceipts(
  setup: Awaited<ReturnType<typeof requireCurrentEvidenceLibrarySetupAttempt>>,
) {
  const application = setup.setupOperation.setupReceipts?.application;
  const deployment = setup.setupOperation.setupReceipts?.deployment;
  if (!application || !deployment) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library deployment receipts are incomplete",
    );
  }
  return { application, deployment };
}

export const prepareReadinessSetup = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.object({
    applicationId: v.string(),
    deploymentId: v.string(),
    runtimeCommit: v.string(),
    runtimeConfigSha256: v.string(),
    coolifyConfigHash: v.string(),
    revisionKey: v.string(),
    targetBaseUrl: v.string(),
    defaultLocale: v.string(),
  }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "health_check",
    });
    const { application, deployment } = requireReadinessReceipts(setup);
    const defaultLocale = await readRevisionDefaultLocale(
      ctx,
      setup.revision._id,
    );
    return {
      applicationId: application.applicationId,
      deploymentId: deployment.deploymentId,
      runtimeCommit: application.runtimeCommit,
      runtimeConfigSha256: application.runtimeConfigSha256,
      coolifyConfigHash: deployment.coolifyConfigHash,
      revisionKey: setup.revision.revisionKey,
      targetBaseUrl: setup.runtimeBinding.targetBaseUrl,
      defaultLocale,
    };
  },
});

export const completeReadinessSetup = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.object({ status: v.literal("succeeded") }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "health_check",
    });
    const { application, deployment } = requireReadinessReceipts(setup);
    const transition = await recordEvidenceLibrarySetupStep(ctx, {
      libraryId: args.libraryId,
      operationId: args.operationId,
      attemptToken: args.attemptToken,
      attemptCount: args.attemptCount,
      result: {
        step: "health_check",
        outcome: "matched",
        applicationId: application.applicationId,
        deploymentId: deployment.deploymentId,
        revisionKey: setup.revision.revisionKey,
      },
    });
    return { status: transition.status as "succeeded" };
  },
});
