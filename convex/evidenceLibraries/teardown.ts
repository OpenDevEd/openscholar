import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { readAttachedDomainOrigins } from "./domains";
import {
  requireEvidenceLibraryAccess,
  requireOrganizationAccess,
} from "./access";

/**
 * Only the attempt that holds the teardown may write about it. Without this
 * a worker that took over after a claim expired could be overwritten by the
 * one it replaced.
 */
function requireTeardownAttempt(
  operation: Doc<"evidenceLibraryConfigOperations">,
  attemptToken: string,
): void {
  if (operation.teardownAttemptToken !== attemptToken) {
    throw createError(
      "CONFLICT",
      "Another attempt is running this Evidence Library teardown",
    );
  }
}

/** How long one teardown attempt holds the operation. */
const TEARDOWN_LEASE_MS = 10 * 60 * 1000;

const BATCH_SIZE = 50;

function requireDevelopmentTeardownEnabled() {
  if (
    process.env.EL_ALLOW_DEVELOPMENT_TEARDOWN !== "true" ||
    process.env.EL_COOLIFY_ENVIRONMENT !== "development"
  ) {
    throw createError(
      "FORBIDDEN",
      "Development Evidence Library teardown is not enabled",
    );
  }
}

async function requestTeardown(
  ctx: MutationCtx,
  args: {
    confirmationName: string;
    libraryId: Id<"evidenceLibraries">;
  },
) {
  requireDevelopmentTeardownEnabled();
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  if (args.confirmationName !== access.library.name) {
    throw createError(
      "VALIDATION_ERROR",
      "Enter the full library name to confirm deletion",
    );
  }
  const operations = await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_libraryId_and_createdAt", (query) =>
      query.eq("libraryId", args.libraryId),
    )
    .collect();
  const teardown = operations.find(
    (operation) => operation.kind === "teardown",
  );
  if (teardown?.status === "queued" || teardown?.status === "running") {
    return { operationId: teardown._id, status: teardown.status };
  }
  // A draft's setup operation is created as "queued" but never starts until
  // the Owner activates it. Only work that is running, or that already ran
  // and is waiting to retry, blocks deletion.
  const activeOperation = operations.find(
    (operation) =>
      operation.kind !== "teardown" &&
      (operation.status === "running" ||
        (operation.status === "queued" &&
          (operation.attemptCount > 0 || operation.startedAt !== undefined))),
  );
  if (activeOperation) {
    throw createError(
      "CONFLICT",
      "Wait for the current library operation to finish before deleting it",
    );
  }
  const now = Date.now();
  let operationId: Id<"evidenceLibraryConfigOperations">;
  if (teardown) {
    if (teardown.status !== "failed") {
      throw createError("CONFLICT", "This library teardown cannot be retried");
    }
    operationId = teardown._id;
    await ctx.db.patch(operationId, {
      status: "queued",
      stage: "coolify",
      error: undefined,
      completedAt: undefined,
      updatedAt: now,
    });
  } else {
    operationId = await ctx.db.insert("evidenceLibraryConfigOperations", {
      libraryId: args.libraryId,
      kind: "teardown",
      idempotencyKey: `development-teardown:${args.libraryId}`,
      status: "queued",
      stage: "coolify",
      attemptCount: 0,
      requestedByClerkUserId: access.clerkUserId,
      createdAt: now,
      updatedAt: now,
    });
  }
  await ctx.db.patch(args.libraryId, {
    state: "disabled",
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.evidenceLibraries.teardownActions.runDevelopmentTeardown,
    { libraryId: args.libraryId, operationId },
  );
  return { operationId, status: "queued" as const };
}

export const requestDevelopmentTeardown = mutation({
  args: {
    confirmationName: v.string(),
    libraryId: v.id("evidenceLibraries"),
  },
  returns: v.object({
    operationId: v.id("evidenceLibraryConfigOperations"),
    status: v.union(v.literal("queued"), v.literal("running")),
  }),
  handler: requestTeardown,
});

export const getDevelopmentTeardownStatus = query({
  args: { operationId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ status: v.literal("complete") }),
    v.object({
      error: v.optional(v.object({ code: v.string(), message: v.string() })),
      libraryId: v.id("evidenceLibraries"),
      libraryName: v.string(),
      stage: v.string(),
      status: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("failed"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const access = await requireOrganizationAccess(ctx, "manage");
    const operationId = ctx.db.normalizeId(
      "evidenceLibraryConfigOperations",
      args.operationId,
    );
    if (!operationId) return null;
    const operation = await ctx.db.get(
      "evidenceLibraryConfigOperations",
      operationId,
    );
    if (!operation) return { status: "complete" as const };
    if (operation.kind !== "teardown") return null;
    if (operation.status === "succeeded") {
      return { status: "complete" as const };
    }
    const library = await ctx.db.get("evidenceLibraries", operation.libraryId);
    if (!library) return { status: "complete" as const };
    if (library.organizationId !== access.organization._id) return null;
    return {
      ...(operation.error
        ? {
            error: {
              code: operation.error.code,
              message: operation.error.message,
            },
          }
        : {}),
      libraryId: library._id,
      libraryName: library.name,
      stage: operation.stage,
      status: operation.status,
    };
  },
});

/**
 * Starts a stopped deletion again. The owner has already confirmed the name
 * once, so this asks only for the library.
 */
export const restartDevelopmentTeardown = mutation({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({ status: v.literal("queued") }),
  handler: async (ctx, args) => {
    requireDevelopmentTeardownEnabled();
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const operation = await ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_createdAt", (query) =>
        query.eq("libraryId", args.libraryId),
      )
      .order("desc")
      .first();
    if (operation?.kind !== "teardown" || operation.status !== "failed") {
      throw createError("CONFLICT", "That library is not waiting to be deleted");
    }
    await ctx.db.patch(operation._id, {
      status: "queued",
      error: undefined,
      attemptCount: 0,
      teardownLeaseExpiresAt: undefined,
      teardownAttemptToken: undefined,
      completedAt: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.evidenceLibraries.teardownActions.runDevelopmentTeardown,
      { libraryId: args.libraryId, operationId: operation._id },
    );
    return { status: "queued" as const };
  },
});

/** How many times a teardown waits for something it needs before giving up. */
const MAX_TEARDOWN_RETRIES = 5;

/**
 * Hands the teardown back and books another attempt, up to a fixed number.
 * Used when something the teardown needs is not there yet.
 */
export const retryDevelopmentTeardown = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
  },
  returns: v.object({
    status: v.union(v.literal("retrying"), v.literal("given-up")),
  }),
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(
      "evidenceLibraryConfigOperations",
      args.operationId,
    );
    if (!operation || operation.kind !== "teardown") {
      throw createError("NOT_FOUND", "Evidence Library teardown not found");
    }
    requireTeardownAttempt(operation, args.attemptToken);
    if (operation.attemptCount >= MAX_TEARDOWN_RETRIES) {
      return { status: "given-up" as const };
    }
    await ctx.db.patch(operation._id, {
      status: "queued",
      teardownLeaseExpiresAt: undefined,
      teardownAttemptToken: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      60_000,
      internal.evidenceLibraries.teardownActions.runDevelopmentTeardown,
      { libraryId: args.libraryId, operationId: args.operationId },
    );
    return { status: "retrying" as const };
  },
});

/** True when a teardown is still running but nobody holds it any more. */
export const isDevelopmentTeardownStale = internalQuery({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(
      "evidenceLibraryConfigOperations",
      args.operationId,
    );
    return (
      operation?.kind === "teardown" &&
      operation.libraryId === args.libraryId &&
      operation.status === "running" &&
      (operation.teardownLeaseExpiresAt ?? 0) <= Date.now()
    );
  },
});

export const prepareDevelopmentTeardown = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
  },
  returns: v.union(
    v.object({ claimed: v.literal(false) }),
    v.object({
      claimed: v.literal(true),
      attemptToken: v.string(),
      applicationId: v.optional(v.string()),
      privateBucket: v.optional(v.string()),
      publicBucket: v.optional(v.string()),
      targetBaseUrl: v.optional(v.string()),
      customDomains: v.array(v.string()),
      customDomainHosts: v.array(v.string()),
      certificateHostnameIds: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    requireDevelopmentTeardownEnabled();
    const [library, operation] = await Promise.all([
      ctx.db.get("evidenceLibraries", args.libraryId),
      ctx.db.get("evidenceLibraryConfigOperations", args.operationId),
    ]);
    if (
      !library ||
      !operation ||
      operation.libraryId !== args.libraryId ||
      operation.kind !== "teardown"
    ) {
      throw createError("NOT_FOUND", "Evidence Library teardown not found");
    }
    const held =
      operation.status === "running" &&
      (operation.teardownLeaseExpiresAt ?? 0) > Date.now();
    if (held) return { claimed: false as const };
    if (operation.status !== "queued" && operation.status !== "running") {
      throw createError("CONFLICT", "Evidence Library teardown is not queued");
    }
    const binding = library.runtimeBindingId
      ? await ctx.db.get(
          "evidenceLibraryRuntimeBindings",
          library.runtimeBindingId,
        )
      : null;
    const setupOperation = library.setupOperationId
      ? await ctx.db.get(
          "evidenceLibraryConfigOperations",
          library.setupOperationId,
        )
      : null;
    const domainRows = await ctx.db
      .query("evidenceLibraryDomains")
      .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
      .collect();
    const applicationId =
      binding && "targetRuntimeId" in binding
        ? binding.targetRuntimeId
        : setupOperation?.setupReceipts?.application?.applicationId;
    const now = Date.now();
    const attemptToken = crypto.randomUUID();
    await ctx.db.patch(operation._id, {
      status: "running",
      attemptCount: operation.attemptCount + 1,
      // The claim expires, so an attempt that died is picked up again
      // instead of leaving the teardown running for ever. Something has to
      // come back and look, so the wake-up is booked in the same
      // transaction as the claim.
      teardownLeaseExpiresAt: now + TEARDOWN_LEASE_MS,
      teardownAttemptToken: attemptToken,
      startedAt: now,
      completedAt: undefined,
      error: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      TEARDOWN_LEASE_MS,
      internal.evidenceLibraries.teardownActions.resumeDevelopmentTeardown,
      { libraryId: args.libraryId, operationId: operation._id },
    );
    return {
      claimed: true as const,
      attemptToken,
      applicationId,
      privateBucket:
        binding && "storagePrivateBucket" in binding
          ? binding.storagePrivateBucket
          : setupOperation?.setupReceipts?.storage?.privateBucket,
      publicBucket:
        binding && "storagePublicBucket" in binding
          ? binding.storagePublicBucket
          : setupOperation?.setupReceipts?.storage?.publicBucket,
      targetBaseUrl: binding?.targetBaseUrl,
      customDomains: await readAttachedDomainOrigins(ctx, args.libraryId),
      // Custom domains are removed from the certificate service before the
      // application goes, so a deleted library can never keep a name. The
      // host names travel too, so a hostname created before its id was saved
      // is still found and deleted.
      customDomainHosts: domainRows.map((row) => row.host),
      certificateHostnameIds: domainRows
        .map((row) => row.certificateHostnameId)
        .filter((id): id is string => typeof id === "string"),
    };
  },
});

export const setDevelopmentTeardownStage = internalMutation({
  args: {
    operationId: v.id("evidenceLibraryConfigOperations"),
    stage: v.union(
      v.literal("coolify"),
      v.literal("storage"),
      v.literal("database"),
      v.literal("convex"),
    ),
    attemptToken: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(
      "evidenceLibraryConfigOperations",
      args.operationId,
    );
    if (!operation || operation.kind !== "teardown") {
      throw createError("NOT_FOUND", "Evidence Library teardown not found");
    }
    requireTeardownAttempt(operation, args.attemptToken);
    await ctx.db.patch(operation._id, {
      stage: args.stage,
      updatedAt: Date.now(),
    });
  },
});

export const deferDevelopmentTeardown = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(
      "evidenceLibraryConfigOperations",
      args.operationId,
    );
    if (!operation || operation.kind !== "teardown") {
      throw createError("NOT_FOUND", "Evidence Library teardown not found");
    }
    requireTeardownAttempt(operation, args.attemptToken);
    // The claim is given back, so the next attempt takes its own.
    await ctx.db.patch(operation._id, {
      status: "queued",
      stage: "storage",
      teardownLeaseExpiresAt: undefined,
      teardownAttemptToken: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      10_000,
      internal.evidenceLibraries.teardownActions.runDevelopmentTeardown,
      { libraryId: args.libraryId, operationId: args.operationId },
    );
  },
});

export const failDevelopmentTeardown = internalMutation({
  args: {
    operationId: v.id("evidenceLibraryConfigOperations"),
    code: v.string(),
    message: v.string(),
    stage: v.string(),
    attemptToken: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(
      "evidenceLibraryConfigOperations",
      args.operationId,
    );
    if (!operation || operation.kind !== "teardown") return;
    requireTeardownAttempt(operation, args.attemptToken);
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "failed",
      error: { code: args.code, message: args.message, stage: args.stage },
      completedAt: now,
      updatedAt: now,
    });
  },
});

export const deleteDevelopmentTeardownBatch = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
  },
  returns: v.object({ complete: v.boolean() }),
  handler: async (ctx, args) => {
    requireDevelopmentTeardownEnabled();
    const operation = await ctx.db.get(
      "evidenceLibraryConfigOperations",
      args.operationId,
    );
    if (
      !operation ||
      operation.libraryId !== args.libraryId ||
      operation.kind !== "teardown" ||
      operation.status !== "running"
    ) {
      throw createError("NOT_FOUND", "Evidence Library teardown not found");
    }
    requireTeardownAttempt(operation, args.attemptToken);
    const sections = await ctx.db
      .query("evidenceLibraryConfigSections")
      .withIndex("by_libraryId_and_kind", (query) =>
        query.eq("libraryId", args.libraryId).eq("kind", "draft"),
      )
      .take(BATCH_SIZE);
    if (sections.length === 0) {
      sections.push(
        ...(await ctx.db
          .query("evidenceLibraryConfigSections")
          .withIndex("by_libraryId_and_kind", (query) =>
            query.eq("libraryId", args.libraryId).eq("kind", "revision"),
          )
          .take(BATCH_SIZE)),
      );
    }
    if (sections.length > 0) {
      await Promise.all(sections.map((row) => ctx.db.delete(row._id)));
      return { complete: false };
    }
    const domains = await ctx.db
      .query("evidenceLibraryDomains")
      .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
      .take(BATCH_SIZE);
    if (domains.length > 0) {
      await Promise.all(domains.map((row) => ctx.db.delete(row._id)));
      return { complete: false };
    }
    const adminCodes = await ctx.db
      .query("evidenceLibraryAdminLoginCodes")
      .withIndex("by_libraryId_and_codeDigest", (query) =>
        query.eq("libraryId", args.libraryId),
      )
      .take(BATCH_SIZE);
    if (adminCodes.length > 0) {
      await Promise.all(adminCodes.map((row) => ctx.db.delete(row._id)));
      return { complete: false };
    }
    const credentials = await ctx.db
      .query("evidenceLibraryCredentials")
      .withIndex("by_libraryId", (query) =>
        query.eq("libraryId", args.libraryId),
      )
      .take(BATCH_SIZE);
    if (credentials.length > 0) {
      await Promise.all(credentials.map((row) => ctx.db.delete(row._id)));
      return { complete: false };
    }
    const operations = (
      await ctx.db
        .query("evidenceLibraryConfigOperations")
        .withIndex("by_libraryId_and_createdAt", (query) =>
          query.eq("libraryId", args.libraryId),
        )
        .take(BATCH_SIZE + 1)
    )
      .filter((row) => row._id !== args.operationId)
      .slice(0, BATCH_SIZE);
    if (operations.length > 0) {
      await Promise.all(operations.map((row) => ctx.db.delete(row._id)));
      return { complete: false };
    }
    const drafts = await ctx.db
      .query("evidenceLibraryConfigDrafts")
      .withIndex("by_libraryId", (query) =>
        query.eq("libraryId", args.libraryId),
      )
      .take(BATCH_SIZE);
    if (drafts.length > 0) {
      await Promise.all(drafts.map((row) => ctx.db.delete(row._id)));
      return { complete: false };
    }
    const revisions = await ctx.db
      .query("evidenceLibraryConfigRevisions")
      .withIndex("by_libraryId_and_revisionKey", (query) =>
        query.eq("libraryId", args.libraryId),
      )
      .take(BATCH_SIZE);
    if (revisions.length > 0) {
      await Promise.all(revisions.map((row) => ctx.db.delete(row._id)));
      return { complete: false };
    }
    const bindings = await ctx.db
      .query("evidenceLibraryRuntimeBindings")
      .withIndex("by_libraryId", (query) =>
        query.eq("libraryId", args.libraryId),
      )
      .take(BATCH_SIZE);
    if (bindings.length > 0) {
      await Promise.all(bindings.map((row) => ctx.db.delete(row._id)));
      return { complete: false };
    }
    await ctx.db.delete(operation._id);
    await ctx.db.delete(args.libraryId);
    return { complete: true };
  },
});
