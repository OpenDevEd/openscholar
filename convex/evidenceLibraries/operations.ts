import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import {
  type EvidenceLibraryOperationKind,
  evidenceLibraryConfigRunningStageValidator,
  evidenceLibraryOperationFailureValidator,
  evidenceLibraryOperationReceiptValidator,
  evidenceLibraryRequestableOperationKindValidator,
} from "./validators";

type RunningStage = "assembling" | "validating" | "publishing" | "activating";
type OperationReceipt = {
  revisionKey?: string;
  targetConfigSha256?: string;
  runtimeReceiptId?: string;
  runtimeCommit?: string;
  coolifyConfigHash?: string;
  activatedAt?: number;
};

export function validateOperationReceipt(
  receipt: OperationReceipt | undefined,
): OperationReceipt | undefined {
  if (!receipt) return undefined;
  const normalized: OperationReceipt = {};
  if (receipt.revisionKey !== undefined) {
    const revisionKey = receipt.revisionKey.trim();
    if (!revisionKey || revisionKey.length > 64) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt revisionKey must contain 1 to 64 characters",
      );
    }
    normalized.revisionKey = revisionKey;
  }
  if (receipt.targetConfigSha256 !== undefined) {
    if (!/^[a-f0-9]{64}$/i.test(receipt.targetConfigSha256)) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt targetConfigSha256 must be a 64-character digest",
      );
    }
    normalized.targetConfigSha256 = receipt.targetConfigSha256.toLowerCase();
  }
  if (receipt.runtimeReceiptId !== undefined) {
    const runtimeReceiptId = receipt.runtimeReceiptId.trim();
    if (!runtimeReceiptId || runtimeReceiptId.length > 200) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt runtimeReceiptId must contain 1 to 200 characters",
      );
    }
    normalized.runtimeReceiptId = runtimeReceiptId;
  }
  if (receipt.runtimeCommit !== undefined) {
    if (!/^[a-f0-9]{40}$/u.test(receipt.runtimeCommit)) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt runtimeCommit must be a lowercase 40-character commit",
      );
    }
    normalized.runtimeCommit = receipt.runtimeCommit;
  }
  if (receipt.coolifyConfigHash !== undefined) {
    if (!/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/iu.test(receipt.coolifyConfigHash)) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt coolifyConfigHash must be a 32- or 64-character digest",
      );
    }
    normalized.coolifyConfigHash = receipt.coolifyConfigHash.toLowerCase();
  }
  if (receipt.activatedAt !== undefined) {
    if (!Number.isFinite(receipt.activatedAt) || receipt.activatedAt < 0) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt activatedAt must be a finite non-negative number",
      );
    }
    normalized.activatedAt = receipt.activatedAt;
  }
  return normalized;
}

const MAX_CONFIGURATION_ISSUES = 200;

export type ConfigurationIssue = { pointer: string; message: string };

export function sanitizeConfigurationIssues(
  issues: readonly ConfigurationIssue[] | undefined,
): ConfigurationIssue[] | undefined {
  if (!issues || issues.length === 0) return undefined;
  return issues.slice(0, MAX_CONFIGURATION_ISSUES).map((issue) => ({
    pointer: issue.pointer.trim().slice(0, 500),
    message: issue.message.trim().slice(0, 500),
  }));
}

export function sanitizeOperationError(
  error: { code: string; message: string },
  stage: string,
) {
  const code = error.code.trim();
  const message = error.message.trim();
  if (!code || !message) {
    throw createError(
      "VALIDATION_ERROR",
      "Operation error code and message must not be blank",
    );
  }
  return {
    code: code.slice(0, 200),
    message: message.slice(0, 2_000),
    stage,
  };
}

async function queueOperationRecord(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    kind: EvidenceLibraryOperationKind;
    idempotencyKey: string;
    revisionId?: Id<"evidenceLibraryConfigRevisions">;
    activationEditVersion?: number;
    runtimeUpdate?: { from: string; to: string };
  },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  if (
    (args.kind === "publish" || args.kind === "rollback") &&
    !args.revisionId
  ) {
    throw createError(
      "VALIDATION_ERROR",
      "Publish and rollback operations require a revision",
    );
  }
  if (args.revisionId) {
    const revision = await ctx.db.get(
      "evidenceLibraryConfigRevisions",
      args.revisionId,
    );
    if (!revision || revision.libraryId !== args.libraryId) {
      throw createError("NOT_FOUND", "Evidence Library revision not found");
    }
  }
  const existing = await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_libraryId_and_idempotencyKey", (query) =>
      query
        .eq("libraryId", args.libraryId)
        .eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (existing) {
    if (
      existing.kind !== args.kind ||
      (existing.revisionId ?? null) !== (args.revisionId ?? null) ||
      (existing.activationEditVersion ?? null) !==
        (args.activationEditVersion ?? null) ||
      (existing.runtimeUpdate?.from ?? null) !==
        (args.runtimeUpdate?.from ?? null) ||
      (existing.runtimeUpdate?.to ?? null) !== (args.runtimeUpdate?.to ?? null)
    ) {
      throw createError(
        "CONFLICT",
        "Operation idempotency key does not match the original command",
      );
    }
    return { operationId: existing._id, status: existing.status };
  }
  const now = Date.now();
  const operationId = await ctx.db.insert("evidenceLibraryConfigOperations", {
    libraryId: args.libraryId,
    kind: args.kind,
    idempotencyKey: args.idempotencyKey,
    activationEditVersion: args.activationEditVersion,
    runtimeUpdate: args.runtimeUpdate,
    revisionId: args.revisionId,
    status: "queued",
    stage: "queued",
    attemptCount: 0,
    requestedByClerkUserId: access.clerkUserId,
    createdAt: now,
    updatedAt: now,
  });
  return { operationId, status: "queued" as const };
}

export async function queueEvidenceLibraryOperation(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    kind: Exclude<EvidenceLibraryOperationKind, "publish">;
    idempotencyKey: string;
    revisionId?: Id<"evidenceLibraryConfigRevisions">;
  },
) {
  return await queueOperationRecord(ctx, args);
}

export async function queueConfigurationDeploymentOperation(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    idempotencyKey: string;
    revisionId: Id<"evidenceLibraryConfigRevisions">;
    activationEditVersion: number;
  },
) {
  return await queueOperationRecord(ctx, { ...args, kind: "publish" });
}

// A runtime update publishes the active revision again at a newer
// Evidence Library commit. No draft edit happened, so it carries the commit
// pair instead of an activation edit version.
export async function queueRuntimeUpdateOperation(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    idempotencyKey: string;
    revisionId: Id<"evidenceLibraryConfigRevisions">;
    runtimeUpdate: { from: string; to: string };
  },
) {
  return await queueOperationRecord(ctx, { ...args, kind: "publish" });
}

// An address move publishes the active revision again at a new address. No
// draft edit happened, so it carries the pair of addresses instead of an
// activation edit version.
export async function queueAddressMoveOperation(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    idempotencyKey: string;
    revisionId: Id<"evidenceLibraryConfigRevisions">;
    addressMove: {
      from: string;
      to: string;
      movedAt: number;
      count: number;
      applied: boolean;
    };
  },
) {
  const { addressMove, ...record } = args;
  const queued = await queueOperationRecord(ctx, {
    ...record,
    kind: "publish",
  });
  await ctx.db.patch(queued.operationId, { addressMove });
  return queued;
}

export async function attachRevisionToSetupOperation(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
    revisionId: Id<"evidenceLibraryConfigRevisions">;
    activationEditVersion: number;
  },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  const [operation, revision] = await Promise.all([
    ctx.db.get("evidenceLibraryConfigOperations", args.operationId),
    ctx.db.get("evidenceLibraryConfigRevisions", args.revisionId),
  ]);
  if (
    access.library.setupOperationId !== args.operationId ||
    !operation ||
    operation.libraryId !== args.libraryId ||
    operation.kind !== "setup"
  ) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library setup operation not found",
    );
  }
  if (!revision || revision.libraryId !== args.libraryId) {
    throw createError("NOT_FOUND", "Evidence Library revision not found");
  }
  if (
    operation.status !== "queued" ||
    operation.stage !== "queued" ||
    operation.attemptCount !== 0 ||
    operation.startedAt !== undefined
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Library setup operation has already started",
    );
  }
  if (operation.revisionId && operation.revisionId !== args.revisionId) {
    throw createError(
      "CONFLICT",
      "Evidence Library setup operation already has a different revision",
    );
  }
  if (
    operation.activationEditVersion !== undefined &&
    operation.activationEditVersion !== args.activationEditVersion
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Library setup operation already has a different activation request",
    );
  }
  if (!operation.revisionId) {
    await ctx.db.patch("evidenceLibraryConfigOperations", operation._id, {
      activationEditVersion: args.activationEditVersion,
      revisionId: args.revisionId,
      updatedAt: Date.now(),
    });
  }
  return { operationId: operation._id, status: operation.status };
}

type TransitionArgs = {
  libraryId: Id<"evidenceLibraries">;
  operationId: Id<"evidenceLibraryConfigOperations">;
} & (
  | { transition: "start"; stage: RunningStage }
  | { transition: "succeed"; receipt?: OperationReceipt }
  | {
      transition: "fail";
      error: { code: string; message: string; issues?: ConfigurationIssue[] };
    }
);

export async function applyOperationTransition(
  ctx: MutationCtx,
  args: TransitionArgs,
) {
  await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const operation = await ctx.db.get(
    "evidenceLibraryConfigOperations",
    args.operationId,
  );
  if (!operation || operation.libraryId !== args.libraryId) {
    throw createError("NOT_FOUND", "Evidence Library operation not found");
  }
  if (operation.kind === "setup") {
    throw createError(
      "CONFLICT",
      "Evidence Library setup uses the fixed setup transitions",
    );
  }
  const now = Date.now();
  if (args.transition === "start") {
    if (operation.status !== "queued" && operation.status !== "failed") {
      throw createError(
        "CONFLICT",
        "Invalid Evidence Library operation transition",
      );
    }
    await ctx.db.patch("evidenceLibraryConfigOperations", operation._id, {
      status: "running",
      stage: args.stage,
      attemptCount: operation.attemptCount + 1,
      error: undefined,
      issues: undefined,
      startedAt: now,
      completedAt: undefined,
      updatedAt: now,
    });
    return "running" as const;
  }
  if (operation.status !== "running") {
    throw createError(
      "CONFLICT",
      "Invalid Evidence Library operation transition",
    );
  }
  if (args.transition === "succeed") {
    const receipt = validateOperationReceipt(args.receipt);
    await ctx.db.patch("evidenceLibraryConfigOperations", operation._id, {
      status: "succeeded",
      stage: "completed",
      receipt,
      completedAt: now,
      updatedAt: now,
    });
    return "succeeded" as const;
  }
  if (operation.stage === "queued" || operation.stage === "completed") {
    throw createError("CONFLICT", "Invalid Evidence Library operation stage");
  }
  await ctx.db.patch("evidenceLibraryConfigOperations", operation._id, {
    status: "failed",
    error: sanitizeOperationError(args.error, operation.stage),
    issues: sanitizeConfigurationIssues(args.error.issues),
    completedAt: now,
    updatedAt: now,
  });
  return "failed" as const;
}

export const queueOperation = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    kind: evidenceLibraryRequestableOperationKindValidator,
    idempotencyKey: v.string(),
    revisionId: v.optional(v.id("evidenceLibraryConfigRevisions")),
  },
  returns: v.object({
    operationId: v.id("evidenceLibraryConfigOperations"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
    ),
  }),
  handler: queueEvidenceLibraryOperation,
});

const transitionReturnValidator = v.union(
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
);

export const startOperation = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    stage: evidenceLibraryConfigRunningStageValidator,
  },
  returns: transitionReturnValidator,
  handler: async (ctx, args) =>
    await applyOperationTransition(ctx, { ...args, transition: "start" }),
});

export const succeedOperation = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    receipt: v.optional(evidenceLibraryOperationReceiptValidator),
  },
  returns: transitionReturnValidator,
  handler: async (ctx, args) =>
    await applyOperationTransition(ctx, { ...args, transition: "succeed" }),
});

export const failOperation = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    error: evidenceLibraryOperationFailureValidator,
  },
  returns: transitionReturnValidator,
  handler: async (ctx, args) =>
    await applyOperationTransition(ctx, { ...args, transition: "fail" }),
});
