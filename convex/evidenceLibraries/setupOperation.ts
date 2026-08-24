import { internalMutation, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { sanitizeOperationError } from "./operations";
import { requireNonBlankProvisioningValue } from "./provisioning";
import { readEvidenceLibrarySetupRecords } from "./setupRecords";
import {
  evidenceLibraryOperationErrorInputValidator,
  evidenceLibrarySetupResultValidator,
  evidenceLibrarySetupReceiptsValidator,
  evidenceLibrarySetupStageValidator,
  type EvidenceLibrarySetupResult,
  type EvidenceLibrarySetupReceipt,
  type EvidenceLibrarySetupReceipts,
  type EvidenceLibrarySetupStage,
} from "./validators";

export const EVIDENCE_LIBRARY_SETUP_STEPS = [
  "database",
  "storage",
  "application",
  "deployment",
  "health_check",
] as const satisfies readonly EvidenceLibrarySetupStage[];

export const EVIDENCE_LIBRARY_SETUP_LEASE_MS = 20 * 60 * 1_000;
export const EVIDENCE_LIBRARY_SETUP_ACTION_DELAY_MS = 1_000;

function setupStagePosition(step: EvidenceLibrarySetupStage): number {
  return EVIDENCE_LIBRARY_SETUP_STEPS.indexOf(step);
}

function requireSetupResourceIdentity(field: string, value: string): string {
  const normalized = requireNonBlankProvisioningValue(field, value);
  if (normalized.length > 200) {
    throw createError(
      "VALIDATION_ERROR",
      `${field} must contain no more than 200 characters`,
    );
  }
  return normalized;
}

function requireRuntimeCommit(value: string): string {
  const commit = requireSetupResourceIdentity("runtimeCommit", value);
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw createError(
      "VALIDATION_ERROR",
      "runtimeCommit must be a lowercase 40-character commit",
    );
  }
  return commit;
}

function requireSha256(field: string, value: string): string {
  const digest = requireSetupResourceIdentity(field, value);
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw createError(
      "VALIDATION_ERROR",
      `${field} must be a lowercase 64-character digest`,
    );
  }
  return digest;
}

function validateSetupReceipt(
  result: EvidenceLibrarySetupResult,
  checkedAt: number,
): EvidenceLibrarySetupReceipt {
  switch (result.step) {
    case "database":
      return {
        ...result,
        checkedAt,
        databaseName: requireSetupResourceIdentity(
          "databaseName",
          result.databaseName,
        ),
        loginName: requireSetupResourceIdentity("loginName", result.loginName),
      };
    case "storage":
      return {
        ...result,
        checkedAt,
        privateBucket: requireSetupResourceIdentity(
          "privateBucket",
          result.privateBucket,
        ),
        publicBucket: requireSetupResourceIdentity(
          "publicBucket",
          result.publicBucket,
        ),
      };
    case "application":
      return {
        ...result,
        checkedAt,
        applicationId: requireSetupResourceIdentity(
          "applicationId",
          result.applicationId,
        ),
        runtimeCommit: requireRuntimeCommit(result.runtimeCommit),
        runtimeConfigSha256: requireSha256(
          "runtimeConfigSha256",
          result.runtimeConfigSha256,
        ),
        coolifyConfigHash: requireSha256(
          "coolifyConfigHash",
          result.coolifyConfigHash,
        ),
      };
    case "deployment":
      return {
        ...result,
        checkedAt,
        applicationId: requireSetupResourceIdentity(
          "applicationId",
          result.applicationId,
        ),
        deploymentId: requireSetupResourceIdentity(
          "deploymentId",
          result.deploymentId,
        ),
        runtimeCommit: requireRuntimeCommit(result.runtimeCommit),
        runtimeConfigSha256: requireSha256(
          "runtimeConfigSha256",
          result.runtimeConfigSha256,
        ),
        coolifyConfigHash: requireSha256(
          "coolifyConfigHash",
          result.coolifyConfigHash,
        ),
      };
    case "health_check":
      return {
        ...result,
        checkedAt,
        applicationId: requireSetupResourceIdentity(
          "applicationId",
          result.applicationId,
        ),
        deploymentId: requireSetupResourceIdentity(
          "deploymentId",
          result.deploymentId,
        ),
        revisionKey: requireSetupResourceIdentity(
          "revisionKey",
          result.revisionKey,
        ),
      };
  }
}

function withSetupReceipt(
  receipts: EvidenceLibrarySetupReceipts,
  receipt: EvidenceLibrarySetupReceipt,
): EvidenceLibrarySetupReceipts {
  return { ...receipts, [receipt.step]: receipt };
}

function isProvisionedBinding(
  binding: Doc<"evidenceLibraryRuntimeBindings">,
): binding is Extract<
  Doc<"evidenceLibraryRuntimeBindings">,
  { targetRuntimeId: string }
> {
  return "targetRuntimeId" in binding;
}

function baseRuntimeBindingFields(
  binding: Doc<"evidenceLibraryRuntimeBindings">,
) {
  return {
    libraryId: binding.libraryId,
    targetBaseUrl: binding.targetBaseUrl,
    createdAt: binding.createdAt,
  };
}

function provisionedRuntimeBindingFields(
  binding: Extract<
    Doc<"evidenceLibraryRuntimeBindings">,
    { targetRuntimeId: string }
  >,
) {
  return {
    ...baseRuntimeBindingFields(binding),
    targetRuntimeId: binding.targetRuntimeId,
    searchHost: binding.searchHost,
    searchIndex: binding.searchIndex,
    storageUrl: binding.storageUrl,
    storagePrivateBucket: binding.storagePrivateBucket,
    storagePublicBucket: binding.storagePublicBucket,
    storageMaxPdfBytes: binding.storageMaxPdfBytes,
    databaseCredentialId: binding.databaseCredentialId,
    searchCredentialId: binding.searchCredentialId,
    storageCredentialId: binding.storageCredentialId,
    ...(binding.zoteroTranslationUrl === undefined
      ? {}
      : { zoteroTranslationUrl: binding.zoteroTranslationUrl }),
    ...(binding.lastVerifiedAt === undefined
      ? {}
      : { lastVerifiedAt: binding.lastVerifiedAt }),
  };
}

async function readLinkedSetup(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
  },
) {
  const library = await ctx.db.get("evidenceLibraries", args.libraryId);
  if (!library || library.setupOperationId !== args.operationId) {
    throw createError(
      "NOT_FOUND",
      "Evidence Library setup operation not found",
    );
  }
  const setup = await readEvidenceLibrarySetupRecords(ctx, library);
  if (
    setup.setupOperation._id !== args.operationId ||
    setup.setupOperation.kind !== "setup" ||
    !setup.setupOperation.revisionId ||
    setup.setupOperation.revisionId !== setup.revision._id
  ) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library setup does not have one activated revision",
    );
  }
  return setup;
}

export async function claimEvidenceLibrarySetupOperation(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
    attemptToken?: string;
  },
) {
  const setup = await readLinkedSetup(ctx, args);
  const operation = setup.setupOperation;
  const now = Date.now();
  const attemptToken = requireSetupResourceIdentity(
    "attemptToken",
    args.attemptToken ?? `elsetup_${operation._id}_${operation.attemptCount + 1}`,
  );
  if (
    operation.status === "running" &&
    (operation.setupLeaseExpiresAt === undefined ||
      operation.setupLeaseExpiresAt > now)
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Library setup operation is already running",
    );
  }
  if (operation.status === "succeeded") {
    throw createError(
      "CONFLICT",
      "Evidence Library setup operation is already complete",
    );
  }
  const setupReceipts = operation.setupReceipts ?? {};
  const setupLeaseExpiresAt = now + EVIDENCE_LIBRARY_SETUP_LEASE_MS;
  await ctx.db.patch(operation._id, {
    status: "running",
    stage: "database",
    attemptCount: operation.attemptCount + 1,
    error: undefined,
    startedAt: now,
    completedAt: undefined,
    setupAttemptToken: attemptToken,
    setupLeaseExpiresAt,
    updatedAt: now,
  });
  if (setup.runtimeBinding.state === "failed") {
    if (isProvisionedBinding(setup.runtimeBinding)) {
      await ctx.db.replace(setup.runtimeBinding._id, {
        ...provisionedRuntimeBindingFields(setup.runtimeBinding),
        state: "pending",
        updatedAt: now,
      });
    } else {
      await ctx.db.replace(setup.runtimeBinding._id, {
        ...baseRuntimeBindingFields(setup.runtimeBinding),
        state: "pending",
        updatedAt: now,
      });
    }
  }
  return {
    attemptCount: operation.attemptCount + 1,
    revisionId: setup.revision._id,
    revisionKey: setup.revision.revisionKey,
    setupReceipts,
    step: "database" as const,
    attemptToken,
    setupLeaseExpiresAt,
  };
}

export async function claimAndScheduleEvidenceLibrarySetupOperation(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
    attemptToken?: string;
  },
) {
  const claimed = await claimEvidenceLibrarySetupOperation(ctx, args);
  await ctx.scheduler.runAfter(
    EVIDENCE_LIBRARY_SETUP_ACTION_DELAY_MS,
    internal.evidenceLibraries.databaseSetupActions.runDatabaseSetup,
    {
      libraryId: args.libraryId,
      operationId: args.operationId,
      attemptToken: claimed.attemptToken,
      attemptCount: claimed.attemptCount,
    },
  );
  return { ...claimed, status: "running" as const };
}

function requireCurrentSetupAttempt(
  operation: Doc<"evidenceLibraryConfigOperations">,
  attemptToken: string,
  attemptCount: number,
) {
  const normalized = requireSetupResourceIdentity("attemptToken", attemptToken);
  if (
    operation.status !== "running" ||
    operation.setupAttemptToken !== normalized ||
    operation.attemptCount !== attemptCount ||
    !operation.setupLeaseExpiresAt ||
    operation.setupLeaseExpiresAt <= Date.now()
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Library setup attempt is no longer active",
    );
  }
  return normalized;
}

export async function requireCurrentEvidenceLibrarySetupAttempt(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
    attemptToken: string;
    attemptCount: number;
    expectedStage?: EvidenceLibrarySetupStage;
  },
) {
  const setup = await readLinkedSetup(ctx, args);
  requireCurrentSetupAttempt(
    setup.setupOperation,
    args.attemptToken,
    args.attemptCount,
  );
  if (
    args.expectedStage &&
    setup.setupOperation.stage !== args.expectedStage
  ) {
    throw createError(
      "CONFLICT",
      `Evidence Library setup is running ${setup.setupOperation.stage}, not ${args.expectedStage}`,
    );
  }
  return setup;
}

export async function recordEvidenceLibrarySetupStep(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
    attemptToken: string;
    attemptCount: number;
    result: EvidenceLibrarySetupResult;
  },
) {
  const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, args);
  const operation = setup.setupOperation;
  if (operation.stage !== args.result.step) {
    throw createError(
      "CONFLICT",
      `Evidence Library setup is running ${operation.stage}, not ${args.result.step}`,
    );
  }
  const now = Date.now();
  const receipt = validateSetupReceipt(args.result, now);
  const setupReceipts = withSetupReceipt(
    operation.setupReceipts ?? {},
    receipt,
  );
  const position = setupStagePosition(receipt.step);
  const nextStep = EVIDENCE_LIBRARY_SETUP_STEPS[position + 1] ?? null;

  if (receipt.step !== "health_check") {
    await ctx.db.patch(operation._id, {
      setupReceipts,
      stage: nextStep!,
      setupLeaseExpiresAt: now + EVIDENCE_LIBRARY_SETUP_LEASE_MS,
      updatedAt: now,
    });
    return { nextStep, status: "running" as const };
  }

  if (receipt.revisionKey !== setup.revision.revisionKey) {
    throw createError(
      "CONFLICT",
      "Evidence Library readiness reported a different configuration revision",
    );
  }
  if (
    EVIDENCE_LIBRARY_SETUP_STEPS.some((step) => !setupReceipts[step]) ||
    !isProvisionedBinding(setup.runtimeBinding)
  ) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library setup resources are incomplete",
    );
  }
  const application = setupReceipts.application!;
  const deployment = setupReceipts.deployment!;
  const storage = setupReceipts.storage!;
  if (
    application.applicationId !== setup.runtimeBinding.targetRuntimeId ||
    deployment.applicationId !== application.applicationId ||
    deployment.runtimeCommit !== application.runtimeCommit ||
    deployment.runtimeConfigSha256 !== application.runtimeConfigSha256 ||
    deployment.coolifyConfigHash !== application.coolifyConfigHash ||
    receipt.applicationId !== application.applicationId ||
    receipt.deploymentId !== deployment.deploymentId
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Library readiness does not match its Coolify application and deployment",
    );
  }
  if (
    storage.privateBucket !== setup.runtimeBinding.storagePrivateBucket ||
    storage.publicBucket !== setup.runtimeBinding.storagePublicBucket
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Library readiness does not match its storage buckets",
    );
  }
  await ctx.db.patch(operation._id, {
    setupReceipts,
    status: "succeeded",
    stage: "completed",
    receipt: {
      revisionKey: receipt.revisionKey,
      runtimeReceiptId: receipt.deploymentId,
      activatedAt: receipt.checkedAt,
    },
    completedAt: now,
    setupAttemptToken: undefined,
    setupLeaseExpiresAt: undefined,
    setupEncryptedDatabasePassword: undefined,
    setupRuntimeCommit: undefined,
    updatedAt: now,
  });
  await ctx.db.replace(setup.runtimeBinding._id, {
    ...provisionedRuntimeBindingFields(setup.runtimeBinding),
    state: "ready",
    lastVerifiedAt: receipt.checkedAt,
    updatedAt: now,
  });
  await ctx.db.patch(setup.library._id, {
    state: "active",
    activeRevisionId: setup.revision._id,
    updatedByClerkUserId: operation.requestedByClerkUserId,
    updatedAt: now,
  });
  return { nextStep: null, status: "succeeded" as const };
}

export async function failEvidenceLibrarySetupOperation(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
    attemptToken: string;
    attemptCount: number;
    expectedStage: EvidenceLibrarySetupStage;
    error: { code: string; message: string };
  },
) {
  const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, args);
  const operation = setup.setupOperation;
  if (operation.stage !== args.expectedStage) {
    throw createError(
      "CONFLICT",
      `Evidence Library setup is running ${operation.stage}, not ${args.expectedStage}`,
    );
  }
  const error = sanitizeOperationError(args.error, args.expectedStage);
  const now = Date.now();
  await ctx.db.patch(operation._id, {
    status: "failed",
    error,
    completedAt: now,
    setupAttemptToken: undefined,
    setupLeaseExpiresAt: undefined,
    updatedAt: now,
  });
  if (isProvisionedBinding(setup.runtimeBinding)) {
    await ctx.db.replace(setup.runtimeBinding._id, {
      ...provisionedRuntimeBindingFields(setup.runtimeBinding),
      state: "failed",
      error: { code: error.code, message: error.message },
      updatedAt: now,
    });
  } else {
    await ctx.db.replace(setup.runtimeBinding._id, {
      ...baseRuntimeBindingFields(setup.runtimeBinding),
      state: "failed",
      error: { code: error.code, message: error.message },
      updatedAt: now,
    });
  }
  return "failed" as const;
}

export async function renewEvidenceLibrarySetupLease(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
    attemptToken: string;
    attemptCount: number;
  },
) {
  const setup = await requireCurrentEvidenceLibrarySetupAttempt(ctx, args);
  const now = Date.now();
  const setupLeaseExpiresAt = now + EVIDENCE_LIBRARY_SETUP_LEASE_MS;
  await ctx.db.patch(setup.setupOperation._id, {
    setupLeaseExpiresAt,
    updatedAt: now,
  });
  return { setupLeaseExpiresAt };
}

export const claimSetupOperation = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
  },
  returns: v.object({
    attemptCount: v.number(),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    revisionKey: v.string(),
    setupReceipts: evidenceLibrarySetupReceiptsValidator,
    step: evidenceLibrarySetupStageValidator,
    attemptToken: v.string(),
    setupLeaseExpiresAt: v.number(),
    status: v.literal("running"),
  }),
  handler: claimAndScheduleEvidenceLibrarySetupOperation,
});

export const recordSetupStep = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    result: evidenceLibrarySetupResultValidator,
  },
  returns: v.object({
    nextStep: v.union(evidenceLibrarySetupStageValidator, v.null()),
    status: v.union(v.literal("running"), v.literal("succeeded")),
  }),
  handler: recordEvidenceLibrarySetupStep,
});

export const failSetupOperation = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    expectedStage: evidenceLibrarySetupStageValidator,
    error: evidenceLibraryOperationErrorInputValidator,
  },
  returns: v.literal("failed"),
  handler: failEvidenceLibrarySetupOperation,
});

export const renewSetupLease = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.object({ setupLeaseExpiresAt: v.number() }),
  handler: renewEvidenceLibrarySetupLease,
});
