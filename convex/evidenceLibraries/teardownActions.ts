"use node";

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  CloudflareSaasError,
  createPlatformCloudflareSaasClient,
} from "./cloudflareSaasClient";
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
 * The custom domains and their certificates are taken down inside the first
 * stage, so a failure there is reported as the domains when that is what was
 * being removed, and as the running site otherwise.
 */
function readTeardownStep(
  stage: "convex" | "coolify" | "database" | "storage",
  duringDomains: boolean,
): "domains" | "runtime" | "files" | "database" | "records" {
  if (stage === "coolify") return duringDomains ? "domains" : "runtime";
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
    // True while the custom domains and their certificates are coming down.
    let removingDomains = false;
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
      // The custom domains come down first, so anything that fails from here
      // until the storage step is a failure to remove them — including not
      // finding the certificate service at all.
      // The custom domains come down first, so anything that fails from here
      // until the storage step is a failure to remove them — including not
      // finding the certificate service at all.
      removingDomains = true;
      const cloudflare = createPlatformCloudflareSaasClient();
      if (!cloudflare && prepared.customDomainHosts.length > 0) {
        // The library's records are the only note that these hostnames
        // exist, so they are kept until the certificate service can say the
        // hostnames are gone. A few more tries first: the account may be
        // being set up.
        const again = await ctx.runMutation(
          internal.evidenceLibraries.teardown.retryDevelopmentTeardown,
          { libraryId: args.libraryId, operationId: args.operationId, attemptToken },
        );
        if (again.status === "retrying") return { status: "pending" as const };
        throw new Error(
          "Custom domains are set up on this library but not on this platform",
        );
      }
      if (cloudflare) {
        // By name as well as by id: a hostname created before its id was
        // written down would otherwise be left behind for ever.
        for (const host of prepared.customDomainHosts) {
          await holdTeardown(ctx, args.operationId, attemptToken);
          await deleteCustomHostname(cloudflare, {
            host,
            certificateHostnameId: null,
          });
        }
        for (const hostnameId of prepared.certificateHostnameIds) {
          await holdTeardown(ctx, args.operationId, attemptToken);
          await cloudflare.deleteCustomHostname(hostnameId);
        }
      }

      removingDomains = false;
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
        error instanceof StorageSetupError ||
        error instanceof DatabaseProvisionerError ||
        error instanceof CloudflareSaasError
          ? { code: error.code, message: error.message }
          : {
              code: "DEVELOPMENT_TEARDOWN_FAILED",
              message: "The development library could not be deleted",
            };
      // Which part of the deletion stopped, in this library's own words. The
      // page says that; the provider's own message is kept for the log only.
      const failedStep = readTeardownStep(stage, removingDomains);
      if (!attemptToken) return { status: "pending" as const };
      // The certificate service being unreachable is usually a moment, not a
      // decision. The library keeps its records and waits, and only says so
      // after the last try.
      if (
        error instanceof CloudflareSaasError &&
        error.code === "CLOUDFLARE_UNAVAILABLE"
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
