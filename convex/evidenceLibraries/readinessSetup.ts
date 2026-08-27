import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import {
  applyEvidenceLibraryAddressMove,
  evidenceLibraryAddressCandidateValidator,
  requireFreeEvidenceLibraryAddress,
} from "./addressRecovery";
import {
  EVIDENCE_LIBRARY_SETUP_ACTION_DELAY_MS,
  EVIDENCE_LIBRARY_SETUP_LEASE_MS,
  recordEvidenceLibrarySetupStep,
  requireCurrentEvidenceLibrarySetupAttempt,
} from "./setupOperation";

const READINESS_POLL_DELAY_MS = 5_000;
const MAX_READINESS_POLLS = 24;
// Three moves is enough for a real collision. More than that means something
// else is wrong, and the owner should see the failure instead.
const MAX_ADDRESS_MOVES = 3;

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
  }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "health_check",
    });
    const { application, deployment } = requireReadinessReceipts(setup);
    return {
      applicationId: application.applicationId,
      deploymentId: deployment.deploymentId,
      runtimeCommit: application.runtimeCommit,
      runtimeConfigSha256: application.runtimeConfigSha256,
      coolifyConfigHash: deployment.coolifyConfigHash,
      revisionKey: setup.revision.revisionKey,
      targetBaseUrl: setup.runtimeBinding.targetBaseUrl,
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

/**
 * Another site answers this library's address. Take the next free address,
 * write it everywhere the setup reads it, and run the Coolify steps again so
 * the application picks up the new domain.
 */
export const moveSetupAddress = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    // The address the shared check found free: free in our database, not
    // served by Coolify, and answering nothing on the host itself.
    candidate: evidenceLibraryAddressCandidateValidator,
  },
  returns: v.union(
    v.object({
      status: v.literal("moving"),
      movedFrom: v.string(),
      movedTo: v.string(),
    }),
    v.object({ status: v.literal("exhausted") }),
  ),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "health_check",
    });
    const previous = setup.setupOperation.addressMove;
    if ((previous?.count ?? 0) >= MAX_ADDRESS_MOVES) {
      return { status: "exhausted" as const };
    }
    const movedFrom = setup.runtimeBinding.targetBaseUrl;
    const movedTo = await requireFreeEvidenceLibraryAddress(ctx, {
      library: setup.library,
      candidate: args.candidate,
    });
    await applyEvidenceLibraryAddressMove(ctx, {
      bindingId: setup.runtimeBinding._id,
      draftId: setup.draft._id,
      revisionId: setup.revision._id,
      nextAddress: movedTo,
    });
    const now = Date.now();
    await ctx.db.patch(setup.setupOperation._id, {
      addressMove: {
        from: previous?.from ?? movedFrom,
        to: movedTo,
        movedAt: now,
        count: (previous?.count ?? 0) + 1,
      },
      stage: "application",
      setupDeploymentId: undefined,
      setupDeploymentOutcome: undefined,
      setupDeploymentNotBefore: undefined,
      setupDeploymentPollCount: 0,
      setupReadinessPollCount: 0,
      setupLeaseExpiresAt: now + EVIDENCE_LIBRARY_SETUP_LEASE_MS,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      EVIDENCE_LIBRARY_SETUP_ACTION_DELAY_MS,
      internal.evidenceLibraries.applicationSetupActions.runApplicationSetup,
      {
        libraryId: args.libraryId,
        operationId: args.operationId,
        attemptToken: args.attemptToken,
        attemptCount: args.attemptCount,
      },
    );
    return { status: "moving" as const, movedFrom, movedTo };
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
