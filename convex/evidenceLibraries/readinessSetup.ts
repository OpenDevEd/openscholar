import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
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
    const localization = await ctx.db
      .query("evidenceLibraryConfigSections")
      .withIndex("by_revisionId_and_sectionKey", (query) =>
        query
          .eq("revisionId", setup.revision._id)
          .eq("sectionKey", "localization"),
      )
      .unique();
    const payload = localization?.payload;
    if (
      localization?.kind !== "revision" ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).defaultLocale !== "string"
    ) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library default language is missing",
      );
    }
    return {
      applicationId: application.applicationId,
      deploymentId: deployment.deploymentId,
      runtimeCommit: application.runtimeCommit,
      runtimeConfigSha256: application.runtimeConfigSha256,
      coolifyConfigHash: application.coolifyConfigHash,
      revisionKey: setup.revision.revisionKey,
      targetBaseUrl: setup.runtimeBinding.targetBaseUrl,
      defaultLocale: (payload as Record<string, string>).defaultLocale,
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
