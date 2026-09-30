import { internal } from "../_generated/api";
import { internalMutation } from "../lib/functions";
import { v } from "convex/values";
import { requireNonBlankProvisioningValue } from "./provisioning";
import {
  EVIDENCE_LIBRARY_SETUP_ACTION_DELAY_MS,
  recordEvidenceLibrarySetupStep,
  requireCurrentEvidenceLibrarySetupAttempt,
} from "./setupOperation";
import { writeEvidenceLibraryCredentialRecord } from "./credentials";
import { evidenceLibraryReconcileOutcomeValidator } from "./validators";

export const completeStorageSetup = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    encryptedServiceRoleKey: v.string(),
    outcome: evidenceLibraryReconcileOutcomeValidator,
    privateBucket: v.string(),
    publicBucket: v.string(),
  },
  returns: v.object({
    credentialId: v.id("evidenceLibraryCredentials"),
    nextStep: v.literal("application"),
    status: v.literal("running"),
  }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "storage",
    });
    const credentialId = await writeEvidenceLibraryCredentialRecord(ctx, {
      libraryId: args.libraryId,
      concretePath: "/services/storage/serviceRoleKey",
      encryptedValue: requireNonBlankProvisioningValue(
        "encryptedServiceRoleKey",
        args.encryptedServiceRoleKey,
      ),
      clerkUserId: setup.setupOperation.requestedByClerkUserId,
      validationState: "valid",
    });
    const transition = await recordEvidenceLibrarySetupStep(ctx, {
      libraryId: args.libraryId,
      operationId: args.operationId,
      attemptToken: args.attemptToken,
      attemptCount: args.attemptCount,
      result: {
        step: "storage",
        outcome: args.outcome,
        privateBucket: args.privateBucket,
        publicBucket: args.publicBucket,
      },
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
    return {
      credentialId,
      nextStep: transition.nextStep as "application",
      status: transition.status as "running",
    };
  },
});
