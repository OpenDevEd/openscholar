"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { encrypt } from "../lib/crypto";
import { createError } from "../lib/errors";
import {
  reconcileLibraryStorage,
  StorageSetupError,
} from "./storageSetupClient";

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw createError("INVALID_DATA", `${name} is not configured`);
  return value;
}

function requireMaxPdfBytes(): number {
  const raw = requireEnvironmentValue("EL_STORAGE_MAX_PDF_BYTES");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw createError(
      "INVALID_DATA",
      "EL_STORAGE_MAX_PDF_BYTES must be a positive integer",
    );
  }
  return value;
}

/** Creates a library's buckets, or brings them to the platform's current policy. */
export async function reconcilePlatformLibraryStorage(
  libraryId: Id<"evidenceLibraries">,
) {
  return await reconcileLibraryStorage({
    storageUrl: requireEnvironmentValue("EL_STORAGE_URL"),
    serviceRoleKey: requireEnvironmentValue("EL_STORAGE_SERVICE_KEY"),
    libraryId,
    maxPdfBytes: requireMaxPdfBytes(),
  });
}

type StorageSetupActionResult =
  | { status: "failed" }
  | {
      credentialId: Id<"evidenceLibraryCredentials">;
      nextStep: "application";
      status: "running";
    };

export const runStorageSetup = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("failed") }),
    v.object({
      credentialId: v.id("evidenceLibraryCredentials"),
      nextStep: v.literal("application"),
      status: v.literal("running"),
    }),
  ),
  handler: async (ctx, args): Promise<StorageSetupActionResult> => {
    try {
      const encryptionKey = requireEnvironmentValue("ENCRYPTION_KEY");
      const serviceRoleKey = requireEnvironmentValue("EL_STORAGE_SERVICE_KEY");
      const storage = await reconcilePlatformLibraryStorage(args.libraryId);
      return await ctx.runMutation(
        internal.evidenceLibraries.storageSetup.completeStorageSetup,
        {
          ...args,
          encryptedServiceRoleKey: encrypt(serviceRoleKey, encryptionKey),
          outcome: storage.outcome,
          privateBucket: storage.privateBucket,
          publicBucket: storage.publicBucket,
        },
      );
    } catch (error) {
      const safeError =
        error instanceof StorageSetupError
          ? { code: error.code, message: error.message }
          : {
              code: "STORAGE_SETUP_FAILED",
              message: "Storage setup failed before both buckets were ready",
            };
      await ctx.runMutation(
        internal.evidenceLibraries.setupOperation.failSetupOperation,
        {
          ...args,
          expectedStage: "storage",
          error: safeError,
        },
      );
      return { status: "failed" as const };
    }
  },
});
