"use node";

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { CoolifyClientError, createCoolifyClient } from "./coolifyClient";
import {
  DatabaseProvisionerError,
  deleteLibraryDatabase,
} from "./databaseSetupClient";
import {
  createLibraryStorageBucketNames,
  deleteLibraryStorage,
  StorageSetupError,
} from "./storageSetupClient";
import { deleteLibraryUploads } from "./uploadsClient";
import {
  deleteLibraryVolume,
  isRetryableVolumeDeletionError,
  VolumeDeletionClientError,
} from "./volumeDeletionClient";
import {
  ReadinessClientError,
  removeLibraryRuntimeRoute,
} from "./readinessClient";
import { ClerkApiError } from "./clerkOAuthApplications";
import {
  deleteLibraryOAuthClientFor,
  isRetryableOAuthClientError,
  OAuthClientBusyError,
} from "./oauthClientSync";

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function requireDevelopmentEnvironment() {
  if (
    process.env.EL_ALLOW_DEVELOPMENT_TEARDOWN !== "true" ||
    process.env.EL_COOLIFY_ENVIRONMENT !== "development"
  ) {
    throw new Error("Development Evidence Library teardown is not enabled");
  }
}

/**
 * Proves this attempt still holds the teardown and puts its lease forward.
 *
 * Called immediately before every destructive call and between batches of
 * deletions, so a healthy but slow teardown cannot be declared dead and have
 * a second worker started behind it.
 */
async function holdTeardown(
  ctx: ActionCtx,
  operationId: Id<"evidenceLibraryConfigOperations">,
  attemptToken: string,
): Promise<void> {
  await ctx.runMutation(
    internal.evidenceLibraries.teardown.holdDevelopmentTeardown,
    { operationId, attemptToken },
  );
}

/**
 * The part of the deletion a stage belongs to, as a name the page can say.
 *
 * Maps the teardown's technical stage to the part the page names.
 */
export function readTeardownStep(
  stage: "convex" | "coolify" | "database" | "storage",
): "runtime" | "files" | "database" | "records" {
  if (stage === "coolify") return "runtime";
  if (stage === "storage") return "files";
  if (stage === "database") return "database";
  return "records";
}

export const runDevelopmentTeardown = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
  },
  returns: v.object({
    status: v.union(
      v.literal("complete"),
      v.literal("pending"),
      v.literal("failed"),
    ),
  }),
  handler: async (ctx, args) => {
    let stage: "convex" | "coolify" | "database" | "storage" = "coolify";
    // Empty until this attempt holds the teardown. A failure before then has
    // nothing to write: another attempt owns the operation.
    let attemptToken = "";
    try {
      requireDevelopmentEnvironment();
      const prepared = await ctx.runMutation(
        internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
        args,
      );
      if (!prepared.claimed) return { status: "pending" as const };
      attemptToken = prepared.attemptToken;
      const expectedBuckets = createLibraryStorageBucketNames(args.libraryId);
      if (
        (prepared.privateBucket &&
          prepared.privateBucket !== expectedBuckets.privateBucket) ||
        (prepared.publicBucket &&
          prepared.publicBucket !== expectedBuckets.publicBucket)
      ) {
        throw new StorageSetupError(
          "STORAGE_BUCKET_CONFLICT",
          "The saved Storage buckets do not belong to this library",
        );
      }
      if (!prepared.targetBaseUrl) {
        throw new CoolifyClientError(
          "COOLIFY_APPLICATION_CONFLICT",
          "The library has no saved public address",
        );
      }
      await holdTeardown(ctx, args.operationId, attemptToken);
      const applicationDeletion = await createCoolifyClient({
        origin: requireEnvironment("EL_COOLIFY_URL"),
        token: requireEnvironment("EL_COOLIFY_TOKEN"),
      }).deleteLibraryApplication({
        applicationUuid: prepared.applicationId,
        environmentName: requireEnvironment("EL_COOLIFY_ENVIRONMENT"),
        libraryId: args.libraryId,
        onApplicationResolved: async (applicationId) => {
          await holdTeardown(ctx, args.operationId, attemptToken);
          await ctx.runMutation(
            internal.evidenceLibraries.teardown
              .rememberDevelopmentTeardownApplication,
            {
              applicationId,
              attemptToken,
              operationId: args.operationId,
            },
          );
          await removeLibraryRuntimeRoute({
            applicationUuid: applicationId,
            verifierUrl: requireEnvironment("EL_RUNTIME_VERIFIER_URL"),
            verifierToken: requireEnvironment("EL_RUNTIME_VERIFIER_TOKEN"),
          });
        },
        projectUuid: requireEnvironment("EL_COOLIFY_PROJECT_UUID"),
        publicDomain: prepared.targetBaseUrl,
        customDomains: prepared.customDomains,
        serverUuid: requireEnvironment("EL_COOLIFY_SERVER_UUID"),
      });
      if (applicationDeletion.applicationUuid) {
        await holdTeardown(ctx, args.operationId, attemptToken);
        await deleteLibraryVolume({
          applicationUuid: applicationDeletion.applicationUuid,
          deleterUrl: requireEnvironment("EL_VOLUME_DELETER_URL"),
          token: requireEnvironment("EL_VOLUME_DELETER_TOKEN"),
        });
      }
      stage = "storage";
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.setDevelopmentTeardownStage,
        { attemptToken, operationId: args.operationId, stage },
      );
      const storageAccess = {
        storageUrl: requireEnvironment("EL_STORAGE_URL"),
        serviceRoleKey: requireEnvironment("EL_STORAGE_SERVICE_KEY"),
        libraryId: args.libraryId,
      };
      // Listing every upload can take longer than one lease on its own, so
      // the lease is put forward before each page's deletes rather than once
      // for the whole walk.
      await deleteLibraryUploads({
        ...storageAccess,
        onBatch: () => holdTeardown(ctx, args.operationId, attemptToken),
      });
      await holdTeardown(ctx, args.operationId, attemptToken);
      const storage = await deleteLibraryStorage(storageAccess);
      if (storage.outcome === "pending") {
        await ctx.runMutation(
          internal.evidenceLibraries.teardown.deferDevelopmentTeardown,
          { ...args, attemptToken },
        );
        return { status: "pending" as const };
      }
      stage = "database";
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.setDevelopmentTeardownStage,
        { attemptToken, operationId: args.operationId, stage },
      );
      // The database request alone may take eight minutes, so its lease is
      // put forward immediately before it.
      await holdTeardown(ctx, args.operationId, attemptToken);
      await deleteLibraryDatabase({
        provisionerUrl: requireEnvironment("EL_DATABASE_PROVISIONER_URL"),
        token: requireEnvironment("EL_DATABASE_PROVISIONER_TOKEN"),
        libraryId: args.libraryId,
      });
      stage = "convex";
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.setDevelopmentTeardownStage,
        { attemptToken, operationId: args.operationId, stage },
      );
      // The OAuth application's ID lives in the rows deleted next.
      await holdTeardown(ctx, args.operationId, attemptToken);
      await deleteLibraryOAuthClientFor(ctx, args.libraryId);
      for (let batch = 0; batch < 12; batch += 1) {
        const result = await ctx.runMutation(
          internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch,
          { ...args, attemptToken },
        );
        if (result.complete) return { status: "complete" as const };
        // Between batches too: deleting rows can take longer than one lease.
        await holdTeardown(ctx, args.operationId, attemptToken);
      }
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.deferDevelopmentTeardown,
        { ...args, attemptToken },
      );
      return { status: "pending" as const };
    } catch (error) {
      const safe =
        error instanceof CoolifyClientError ||
        error instanceof ReadinessClientError ||
        error instanceof StorageSetupError ||
        error instanceof DatabaseProvisionerError ||
        error instanceof VolumeDeletionClientError
          ? { code: error.code, message: error.message }
          : error instanceof ClerkApiError || error instanceof OAuthClientBusyError
            ? {
                code: "OAUTH_CLIENT_DELETE_FAILED",
                message: "The library's OpenScholar sign-in could not be removed",
              }
          : {
              code: "DEVELOPMENT_TEARDOWN_FAILED",
              message: "The development library could not be deleted",
            };
      // Which part of the deletion stopped, in this library's own words. The
      // page says that; the provider's own message is kept for the log only.
      const failedStep = readTeardownStep(stage);
      if (!attemptToken) return { status: "pending" as const };
      // A provider that is temporarily unavailable, or a container still
      // releasing its volume, needs time rather than a second state machine.
      // The library keeps its records and waits, and only says so after the
      // last try.
      if (
        isRetryableVolumeDeletionError(error) ||
        isRetryableOAuthClientError(error)
      ) {
        const again = await ctx.runMutation(
          internal.evidenceLibraries.teardown.retryDevelopmentTeardown,
          {
            libraryId: args.libraryId,
            operationId: args.operationId,
            attemptToken,
          },
        );
        if (again.status === "retrying") return { status: "pending" as const };
      }
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.failDevelopmentTeardown,
        {
          attemptToken,
          operationId: args.operationId,
          stage,
          failedStep,
          ...safe,
        },
      );
      return { status: "failed" as const };
    }
  },
});

/**
 * Looks at a teardown whose claim has run out. An attempt that died leaves
 * the operation running for ever unless something comes back for it, so the
 * claim books this when it is taken.
 */
export const resumeDevelopmentTeardown = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    /** The attempt this wake-up was booked for, if it was booked for one. */
    attemptToken: v.optional(v.string()),
    /** The deadline it was booked for. A renewal replaces it. */
    leaseExpiresAt: v.optional(v.number()),
  },
  returns: v.object({
    status: v.union(v.literal("resumed"), v.literal("nothing-to-do")),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "resumed" | "nothing-to-do" }> => {
    const stale = await ctx.runQuery(
      internal.evidenceLibraries.teardown.isDevelopmentTeardownStale,
      {
        libraryId: args.libraryId,
        operationId: args.operationId,
        // A wake-up booked for a deadline the work has since moved past
        // says nothing: a later one owns this teardown now.
        ...(args.attemptToken ? { attemptToken: args.attemptToken } : {}),
        ...(args.leaseExpiresAt !== undefined
          ? { leaseExpiresAt: args.leaseExpiresAt }
          : {}),
      },
    );
    if (!stale) return { status: "nothing-to-do" as const };
    await ctx.runAction(
      internal.evidenceLibraries.teardownActions.runDevelopmentTeardown,
      { libraryId: args.libraryId, operationId: args.operationId },
    );
    return { status: "resumed" as const };
  },
});
