"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { createPlatformCloudflareSaasClient } from "./cloudflareSaasClient";
import { deleteCustomHostname } from "./domainActions";
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
      const cloudflare = createPlatformCloudflareSaasClient();
      if (!cloudflare && prepared.customDomainHosts.length > 0) {
        // The library's records are the only note that these hostnames
        // exist. They are not deleted until the certificate service can
        // confirm the hostnames are gone.
        throw new Error(
          "Custom domains are set up on this library but not on this platform",
        );
      }
      if (cloudflare) {
        // By name as well as by id: a hostname created before its id was
        // written down would otherwise be left behind for ever.
        for (const host of prepared.customDomainHosts) {
          await deleteCustomHostname(cloudflare, {
            host,
            certificateHostnameId: null,
          });
        }
        for (const hostnameId of prepared.certificateHostnameIds) {
          await cloudflare.deleteCustomHostname(hostnameId);
        }
      }

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
        customDomains: prepared.customDomains,
        serverUuid: requireEnvironment("EL_COOLIFY_SERVER_UUID"),
      });
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
      await deleteLibraryUploads(storageAccess);
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
      for (let batch = 0; batch < 12; batch += 1) {
        const result = await ctx.runMutation(
          internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch,
          { ...args, attemptToken },
        );
        if (result.complete) return { status: "complete" as const };
      }
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.deferDevelopmentTeardown,
        { ...args, attemptToken },
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
      if (!attemptToken) return { status: "pending" as const };
      await ctx.runMutation(
        internal.evidenceLibraries.teardown.failDevelopmentTeardown,
        { attemptToken, operationId: args.operationId, stage, ...safe },
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
      args,
    );
    if (!stale) return { status: "nothing-to-do" as const };
    await ctx.runAction(
      internal.evidenceLibraries.teardownActions.runDevelopmentTeardown,
      args,
    );
    return { status: "resumed" as const };
  },
});
