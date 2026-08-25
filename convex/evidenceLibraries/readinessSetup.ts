import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { readRevisionDefaultLocale } from "./revisionConfiguration";
import {
  EVIDENCE_LIBRARY_SETUP_LEASE_MS,
  recordEvidenceLibrarySetupStep,
  requireCurrentEvidenceLibrarySetupAttempt,
} from "./setupOperation";

const READINESS_POLL_DELAY_MS = 5_000;
const MAX_READINESS_POLLS = 24;

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

export const scheduleReadinessPoll = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.union(
    v.object({ pollCount: v.number(), status: v.literal("running") }),
    v.object({ status: v.literal("exhausted") }),
  ),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "health_check",
    });
    const pollCount = (setup.setupOperation.setupReadinessPollCount ?? 0) + 1;
    if (pollCount > MAX_READINESS_POLLS) {
      return { status: "exhausted" as const };
    }
    const now = Date.now();
    await ctx.db.patch(setup.setupOperation._id, {
      setupReadinessPollCount: pollCount,
      setupLeaseExpiresAt: now + EVIDENCE_LIBRARY_SETUP_LEASE_MS,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      READINESS_POLL_DELAY_MS,
      internal.evidenceLibraries.readinessSetupActions.runReadinessSetup,
      args,
    );
    return { pollCount, status: "running" as const };
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
