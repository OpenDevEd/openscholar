import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { requireNonBlankProvisioningValue } from "./provisioning";
import {
  recordEvidenceLibrarySetupStep,
  requireCurrentEvidenceLibrarySetupAttempt,
  EVIDENCE_LIBRARY_SETUP_ACTION_DELAY_MS,
} from "./setupOperation";
import { writeEvidenceLibraryCredentialRecord } from "./credentials";
import { evidenceLibraryReconcileOutcomeValidator } from "./validators";

export const prepareDatabaseSetup = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    candidateEncryptedPassword: v.string(),
  },
  returns: v.object({ encryptedPassword: v.string() }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "database",
    });
    const encryptedPassword =
      setup.setupOperation.setupEncryptedDatabasePassword ??
      requireNonBlankProvisioningValue(
        "candidateEncryptedPassword",
        args.candidateEncryptedPassword,
      );
    if (!setup.setupOperation.setupEncryptedDatabasePassword) {
      await ctx.db.patch(setup.setupOperation._id, {
        setupEncryptedDatabasePassword: encryptedPassword,
        updatedAt: Date.now(),
      });
    }
    return { encryptedPassword };
  },
});

export const completeDatabaseSetup = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    encryptedDatabaseUrl: v.string(),
    outcome: evidenceLibraryReconcileOutcomeValidator,
    databaseName: v.string(),
    loginName: v.string(),
  },
  returns: v.object({
    credentialId: v.id("evidenceLibraryCredentials"),
    nextStep: v.literal("storage"),
    status: v.literal("running"),
  }),
  handler: async (ctx, args) => {
    const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, {
      ...args,
      expectedStage: "database",
    });
    const credentialId = await writeEvidenceLibraryCredentialRecord(ctx, {
      libraryId: args.libraryId,
      concretePath: "/services/database/url",
      encryptedValue: requireNonBlankProvisioningValue(
        "encryptedDatabaseUrl",
        args.encryptedDatabaseUrl,
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
        step: "database",
        outcome: args.outcome,
        databaseName: args.databaseName,
        loginName: args.loginName,
      },
    });
    await ctx.scheduler.runAfter(
      EVIDENCE_LIBRARY_SETUP_ACTION_DELAY_MS,
      internal.evidenceLibraries.storageSetupActions.runStorageSetup,
      {
        libraryId: args.libraryId,
        operationId: args.operationId,
        attemptToken: args.attemptToken,
        attemptCount: args.attemptCount,
      },
    );
    return {
      credentialId,
      nextStep: transition.nextStep as "storage",
      status: transition.status as "running",
    };
  },
});
