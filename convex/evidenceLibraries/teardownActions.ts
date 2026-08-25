"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
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
    try {
      requireDevelopmentEnvironment();
      const prepared = await ctx.runMutation(
        internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
        args,
      );
      if (!prepared.claimed) return { status: "pending" as const };
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
      await createCoolifyClient({
        origin: requireEnvironment("EL_COOLIFY_URL"),
        token: requireEnvironment("EL_COOLIFY_TOKEN"),
      }).deleteLibraryApplication({
        applicationUuid: prepared.applicationId,
        environmentName: requireEnvironment("EL_COOLIFY_ENVIRONMENT"),
        libraryId: args.libraryId,
        projectUuid: requireEnvironment("EL_COOLIFY_PROJECT_UUID"),
        publicDomain: prepared.targetBaseUrl,
        serverUuid: requireEnvironment("EL_COOLIFY_SERVER_UUID"),
      });
      stage = "storage";
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.setDevelopmentTeardownStage,
        { operationId: args.operationId, stage },
      );
      const storage = await deleteLibraryStorage({
        storageUrl: requireEnvironment("EL_STORAGE_URL"),
        serviceRoleKey: requireEnvironment("EL_STORAGE_SERVICE_KEY"),
        libraryId: args.libraryId,
      });
      if (storage.outcome === "pending") {
        await ctx.runMutation(
          internal.evidenceLibraries.teardown.deferDevelopmentTeardown,
          args,
        );
        return { status: "pending" as const };
      }
      stage = "database";
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.setDevelopmentTeardownStage,
        { operationId: args.operationId, stage },
      );
      await deleteLibraryDatabase({
        provisionerUrl: requireEnvironment("EL_DATABASE_PROVISIONER_URL"),
        token: requireEnvironment("EL_DATABASE_PROVISIONER_TOKEN"),
        libraryId: args.libraryId,
      });
      stage = "convex";
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.setDevelopmentTeardownStage,
        { operationId: args.operationId, stage },
      );
      for (let batch = 0; batch < 12; batch += 1) {
        const result = await ctx.runMutation(
          internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch,
          args,
        );
        if (result.complete) return { status: "complete" as const };
      }
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.deferDevelopmentTeardown,
        args,
      );
      return { status: "pending" as const };
    } catch (error) {
      const safe =
        error instanceof CoolifyClientError ||
        error instanceof StorageSetupError ||
        error instanceof DatabaseProvisionerError
          ? { code: error.code, message: error.message }
          : {
              code: "DEVELOPMENT_TEARDOWN_FAILED",
              message: "The development library could not be deleted",
            };
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.failDevelopmentTeardown,
        { operationId: args.operationId, stage, ...safe },
      );
      return { status: "failed" as const };
    }
  },
});
