import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";

type OperationKind = "validate" | "publish" | "rollback";
type RunningStage = "assembling" | "validating" | "publishing" | "activating";
type OperationReceipt = {
  revisionKey?: string;
  targetConfigSha256?: string;
  runtimeReceiptId?: string;
  activatedAt?: number;
};

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
  const existing = await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_idempotencyKey", (query) =>
      query.eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (existing) {
    if (existing.libraryId !== args.libraryId || existing.kind !== args.kind) {
      throw createError("CONFLICT", "Operation idempotency key is already in use");
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
        error: { code: string; message: string; stage: string };
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
    await ctx.db.patch("evidenceLibraryConfigOperations", operation._id, {
      status: "succeeded",
      stage: "completed",
      receipt: args.receipt,
      completedAt: now,
      updatedAt: now,
    });
    return "succeeded" as const;
  }
  await ctx.db.patch("evidenceLibraryConfigOperations", operation._id, {
    status: "failed",
    error: {
      code: args.error.code.slice(0, 200),
      message: args.error.message.slice(0, 2_000),
      stage: args.error.stage.slice(0, 200),
    },
    completedAt: now,
    updatedAt: now,
  });
  return "failed" as const;
}

const operationKindValidator = v.union(
  v.literal("validate"),
  v.literal("publish"),
  v.literal("rollback"),
);
const runningStageValidator = v.union(
  v.literal("assembling"),
  v.literal("validating"),
  v.literal("publishing"),
  v.literal("activating"),
);
const receiptValidator = v.object({
  revisionKey: v.optional(v.string()),
  targetConfigSha256: v.optional(v.string()),
  runtimeReceiptId: v.optional(v.string()),
  activatedAt: v.optional(v.number()),
});

export const queueOperation = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    kind: operationKindValidator,
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

export const transitionOperation = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    transition: v.union(
      v.literal("start"),
      v.literal("succeed"),
      v.literal("fail"),
    ),
    stage: v.optional(runningStageValidator),
    receipt: v.optional(receiptValidator),
    error: v.optional(
      v.object({ code: v.string(), message: v.string(), stage: v.string() }),
    ),
  },
  returns: v.union(
    v.literal("running"),
    v.literal("succeeded"),
    v.literal("failed"),
  ),
  handler: async (ctx, args) => {
    const common = { libraryId: args.libraryId, operationId: args.operationId };
    if (args.transition === "start") {
      if (!args.stage) throw new Error("Start transition requires a stage");
      return await applyOperationTransition(ctx, {
        ...common,
        transition: "start",
        stage: args.stage,
      });
    }
    if (args.transition === "succeed") {
      return await applyOperationTransition(ctx, {
        ...common,
        transition: "succeed",
        receipt: args.receipt,
      });
    }
    if (!args.error) throw new Error("Fail transition requires an error");
    return await applyOperationTransition(ctx, {
      ...common,
      transition: "fail",
      error: args.error,
    });
  },
});
