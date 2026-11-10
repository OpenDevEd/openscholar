import { mutation, type MutationCtx } from "../lib/functions";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { readChangedSections } from "./configurationSnapshot";
import { requireEvidenceLibraryAccess } from "./access";
import {
  type EvidenceLibraryOperationKind,
  evidenceLibraryRequestableOperationKindValidator,
} from "./validators";
import { refuseApps } from "../lib/auth";

async function queueOperationRecord(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    kind: EvidenceLibraryOperationKind;
    idempotencyKey: string;
    revisionId?: Id<"evidenceLibraryConfigRevisions">;
    activationEditVersion?: number;
    requestedByClerkUserId?: string;
    runtimeUpdate?: {
      from: string;
      to: string;
      fromImage: string;
      toImage: string;
    };
  },
) {
  const requestedByClerkUserId =
    args.requestedByClerkUserId ??
    (await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage"))
      .clerkUserId;
  if (
    (args.kind === "publish" || args.kind === "rollback") &&
    !args.revisionId
  ) {
    throw createError(
      "VALIDATION_ERROR",
      "Publish and rollback operations require a revision",
    );
  }
  const revision = args.revisionId
    ? await ctx.db.get("evidenceLibraryConfigRevisions", args.revisionId)
    : null;
  if (args.revisionId && (!revision || revision.libraryId !== args.libraryId)) {
    throw createError("NOT_FOUND", "Evidence Community revision not found");
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
      (existing.runtimeUpdate?.to ?? null) !==
        (args.runtimeUpdate?.to ?? null) ||
      (existing.runtimeUpdate?.fromImage ?? null) !==
        (args.runtimeUpdate?.fromImage ?? null) ||
      (existing.runtimeUpdate?.toImage ?? null) !==
        (args.runtimeUpdate?.toImage ?? null)
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
    // A software update lists as one, with no sections named.
    ...(revision && !args.runtimeUpdate && (args.kind === "publish" || args.kind === "setup")
      ? { changedSections: await readChangedSections(ctx, revision) }
      : {}),
    status: "queued",
    stage: "queued",
    attemptCount: 0,
    requestedByClerkUserId,
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
    runtimeUpdate?: {
      from: string;
      to: string;
      fromImage: string;
      toImage: string;
    };
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
    requestedByClerkUserId?: string;
    runtimeUpdate: {
      from: string;
      to: string;
      fromImage: string;
      toImage: string;
    };
  },
) {
  return await queueOperationRecord(ctx, { ...args, kind: "publish" });
}

export async function queueInternalRuntimeRollbackOperation(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    idempotencyKey: string;
    revisionId: Id<"evidenceLibraryConfigRevisions">;
    runtimeUpdate: {
      from: string;
      to: string;
      fromImage: string;
      toImage: string;
    };
  },
) {
  return await queueOperationRecord(ctx, {
    ...args,
    kind: "publish",
    requestedByClerkUserId: "integration-owner",
  });
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

/**
 * A custom domain changing publishes the live revision again: the proxy only
 * learns about a domain through a deployment.
 */
export async function queueDomainChangeOperation(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    idempotencyKey: string;
    revisionId: Id<"evidenceLibraryConfigRevisions">;
    /** Set when an owner's activation carries the change. */
    activationEditVersion?: number;
    domainChange: {
      host: string;
      domainId: Id<"evidenceLibraryDomains">;
      reason: "attach" | "detach" | "canonical";
      address?: string;
      redeploy?: true;
      token: string;
    };
    /** Set when the activation's settings need newer software than is running. */
    runtimeUpdate?: {
      from: string;
      to: string;
      fromImage: string;
      toImage: string;
    };
  },
) {
  const { domainChange, ...record } = args;
  const queued = await queueOperationRecord(ctx, {
    ...record,
    kind: "publish",
  });
  await ctx.db.patch(queued.operationId, { domainChange });
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
      "Evidence Community setup operation not found",
    );
  }
  if (!revision || revision.libraryId !== args.libraryId) {
    throw createError("NOT_FOUND", "Evidence Community revision not found");
  }
  if (
    operation.status !== "queued" ||
    operation.stage !== "queued" ||
    operation.attemptCount !== 0 ||
    operation.startedAt !== undefined
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Community setup operation has already started",
    );
  }
  if (operation.revisionId && operation.revisionId !== args.revisionId) {
    throw createError(
      "CONFLICT",
      "Evidence Community setup operation already has a different revision",
    );
  }
  if (
    operation.activationEditVersion !== undefined &&
    operation.activationEditVersion !== args.activationEditVersion
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Community setup operation already has a different activation request",
    );
  }
  if (!operation.revisionId) {
    await ctx.db.patch("evidenceLibraryConfigOperations", operation._id, {
      activationEditVersion: args.activationEditVersion,
      revisionId: args.revisionId,
      changedSections: await readChangedSections(ctx, revision),
      updatedAt: Date.now(),
    });
  }
  return { operationId: operation._id, status: operation.status };
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
  handler: async (ctx, args): ReturnType<typeof queueEvidenceLibraryOperation> => {
    await refuseApps(ctx);
    return await queueEvidenceLibraryOperation(ctx, args);
  },
});
