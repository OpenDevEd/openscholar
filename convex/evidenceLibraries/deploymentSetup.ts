import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { requireNonBlankProvisioningValue } from "./provisioning";
import {
  EVIDENCE_LIBRARY_SETUP_ACTION_DELAY_MS,
  EVIDENCE_LIBRARY_SETUP_LEASE_MS,
  recordEvidenceLibrarySetupStep,
  requireCurrentEvidenceLibrarySetupAttempt,
} from "./setupOperation";
import { evidenceLibraryDeploymentOutcomeValidator } from "./validators";

const DEPLOYMENT_POLL_DELAY_MS = 5_000;
const MAX_DEPLOYMENT_POLLS = 120;

function requireApplicationReceipt(
  setup: Awaited<ReturnType<typeof requireCurrentEvidenceLibrarySetupAttempt>>,
) {
  const receipt = setup.setupOperation.setupReceipts?.application;
  if (!receipt) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library application receipt is missing",
    );
  }
  return receipt;
}

export const prepareDeploymentSetup = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.object({
    applicationId: v.string(),
    targetBaseUrl: v.string(),
    runtimeCommit: v.string(),
    runtimeConfigSha256: v.string(),
    coolifyConfigHash: v.string(),
    applicationCheckedAt: v.number(),
    deploymentId: v.optional(v.string()),
    deploymentOutcome: v.optional(evidenceLibraryDeploymentOutcomeValidator),
    pollCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "deployment",
    });
    const application = requireApplicationReceipt(setup);
    return {
      applicationId: application.applicationId,
      targetBaseUrl: setup.runtimeBinding.targetBaseUrl,
      runtimeCommit: application.runtimeCommit,
      runtimeConfigSha256: application.runtimeConfigSha256,
      coolifyConfigHash: application.coolifyConfigHash,
      applicationCheckedAt: application.checkedAt,
      ...(setup.setupOperation.setupDeploymentId === undefined
        ? {}
        : { deploymentId: setup.setupOperation.setupDeploymentId }),
      ...(setup.setupOperation.setupDeploymentOutcome === undefined
        ? {}
        : { deploymentOutcome: setup.setupOperation.setupDeploymentOutcome }),
      pollCount: setup.setupOperation.setupDeploymentPollCount ?? 0,
    };
  },
});

export const saveDeploymentSetupId = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    deploymentId: v.string(),
    outcome: evidenceLibraryDeploymentOutcomeValidator,
  },
  returns: v.object({ deploymentId: v.string(), pollCount: v.number() }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "deployment",
    });
    const deploymentId = requireNonBlankProvisioningValue(
      "deploymentId",
      args.deploymentId,
    );
    if (
      setup.setupOperation.setupDeploymentId !== undefined &&
      setup.setupOperation.setupDeploymentId !== deploymentId
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library setup already saved another deployment",
      );
    }
    await ctx.db.patch(setup.setupOperation._id, {
      setupDeploymentId: deploymentId,
      setupDeploymentOutcome: args.outcome,
      setupDeploymentPollCount: 0,
      updatedAt: Date.now(),
    });
    return { deploymentId, pollCount: 0 };
  },
});

export const scheduleDeploymentPoll = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    deploymentId: v.string(),
  },
  returns: v.object({ pollCount: v.number(), status: v.literal("running") }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "deployment",
    });
    if (setup.setupOperation.setupDeploymentId !== args.deploymentId) {
      throw createError(
        "CONFLICT",
        "Evidence Library setup is polling another deployment",
      );
    }
    const pollCount = (setup.setupOperation.setupDeploymentPollCount ?? 0) + 1;
    if (pollCount > MAX_DEPLOYMENT_POLLS) {
      throw createError(
        "CONFLICT",
        "Evidence Library deployment did not finish in time",
      );
    }
    const now = Date.now();
    await ctx.db.patch(setup.setupOperation._id, {
      setupDeploymentPollCount: pollCount,
      setupLeaseExpiresAt: now + EVIDENCE_LIBRARY_SETUP_LEASE_MS,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      DEPLOYMENT_POLL_DELAY_MS,
      internal.evidenceLibraries.deploymentSetupActions.runDeploymentSetup,
      {
        libraryId: args.libraryId,
        operationId: args.operationId,
        attemptToken: args.attemptToken,
        attemptCount: args.attemptCount,
      },
    );
    return { pollCount, status: "running" as const };
  },
});

export const completeDeploymentSetup = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    deploymentId: v.string(),
    coolifyConfigHash: v.string(),
  },
  returns: v.object({
    nextStep: v.literal("health_check"),
    status: v.literal("running"),
  }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "deployment",
    });
    const application = requireApplicationReceipt(setup);
    if (
      setup.setupOperation.setupDeploymentId !== args.deploymentId ||
      !setup.setupOperation.setupDeploymentOutcome
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library deployment receipt changed during setup",
      );
    }
    const transition = await recordEvidenceLibrarySetupStep(ctx, {
      libraryId: args.libraryId,
      operationId: args.operationId,
      attemptToken: args.attemptToken,
      attemptCount: args.attemptCount,
      result: {
        step: "deployment",
        outcome: setup.setupOperation.setupDeploymentOutcome,
        applicationId: application.applicationId,
        deploymentId: args.deploymentId,
        runtimeCommit: application.runtimeCommit,
        runtimeConfigSha256: application.runtimeConfigSha256,
        coolifyConfigHash: requireNonBlankProvisioningValue(
          "coolifyConfigHash",
          args.coolifyConfigHash,
        ),
      },
    });
    await ctx.scheduler.runAfter(
      EVIDENCE_LIBRARY_SETUP_ACTION_DELAY_MS,
      internal.evidenceLibraries.readinessSetupActions.runReadinessSetup,
      {
        libraryId: args.libraryId,
        operationId: args.operationId,
        attemptToken: args.attemptToken,
        attemptCount: args.attemptCount,
      },
    );
    return {
      nextStep: transition.nextStep as "health_check",
      status: transition.status as "running",
    };
  },
});
