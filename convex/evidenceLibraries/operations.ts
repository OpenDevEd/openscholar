import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import {
  evidenceLibraryOperationErrorInputValidator,
  evidenceLibraryOperationKindValidator,
  evidenceLibraryOperationReceiptValidator,
  evidenceLibraryRunningStageValidator,
} from "./validators";

type OperationKind = "setup" | "validate" | "publish" | "rollback";
type RunningStage = "assembling" | "validating" | "publishing" | "activating";
type OperationReceipt = {
  revisionKey?: string;
  targetConfigSha256?: string;
  runtimeReceiptId?: string;
  activatedAt?: number;
};

function validateOperationReceipt(
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

function sanitizeOperationError(
  error: { code: string; message: string },
  stage: RunningStage,
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

export async function queueEvidenceLibraryOperation(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    kind: OperationKind;
    idempotencyKey: string;
    revisionId?: Id<"evidenceLibraryConfigRevisions">;
  },
) {
  const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  if ((args.kind === "publish" || args.kind === "rollback") && !args.revisionId) {
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
      (existing.revisionId ?? null) !== (args.revisionId ?? null)
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

type TransitionArgs = {
  libraryId: Id<"evidenceLibraries">;
  operationId: Id<"evidenceLibraryConfigOperations">;
} &
  (
    | { transition: "start"; stage: RunningStage }
    | { transition: "succeed"; receipt?: OperationReceipt }
    | {
        transition: "fail";
        error: { code: string; message: string };
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
  const now = Date.now();
  if (args.transition === "start") {
    if (operation.status !== "queued" && operation.status !== "failed") {
      throw createError("CONFLICT", "Invalid Evidence Library operation transition");
    }
    await ctx.db.patch("evidenceLibraryConfigOperations", operation._id, {
      status: "running",
      stage: args.stage,
      attemptCount: operation.attemptCount + 1,
      error: undefined,
      startedAt: now,
      completedAt: undefined,
      updatedAt: now,
    });
    return "running" as const;
  }
  if (operation.status !== "running") {
    throw createError("CONFLICT", "Invalid Evidence Library operation transition");
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
    completedAt: now,
    updatedAt: now,
  });
  return "failed" as const;
}

export const queueOperation = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    kind: evidenceLibraryOperationKindValidator,
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
    stage: evidenceLibraryRunningStageValidator,
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
    error: evidenceLibraryOperationErrorInputValidator,
  },
  returns: transitionReturnValidator,
  handler: async (ctx, args) =>
    await applyOperationTransition(ctx, { ...args, transition: "fail" }),
});
