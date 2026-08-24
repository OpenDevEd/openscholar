"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { decrypt, encrypt } from "../lib/crypto";
import { createError } from "../lib/errors";
import { generateOpaqueToken } from "../lib/opaqueToken";
import {
  DatabaseProvisionerError,
  reconcileLibraryDatabase,
} from "./databaseSetupClient";

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw createError("INVALID_DATA", `${name} is not configured`);
  }
  return value;
}

type DatabaseSetupActionResult =
  | { status: "failed" }
  | {
      credentialId: Id<"evidenceLibraryCredentials">;
      nextStep: "storage";
      status: "running";
    };

export const runDatabaseSetup = internalAction({
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
      nextStep: v.literal("storage"),
      status: v.literal("running"),
    }),
  ),
  handler: async (ctx, args): Promise<DatabaseSetupActionResult> => {
    try {
      const encryptionKey = requireEnvironmentValue("ENCRYPTION_KEY");
      const provisionerUrl = requireEnvironmentValue(
        "EL_DATABASE_PROVISIONER_URL",
      );
      const token = requireEnvironmentValue(
        "EL_DATABASE_PROVISIONER_TOKEN",
      );
      const prepared = await ctx.runMutation(
        internal.evidenceLibraries.databaseSetup.prepareDatabaseSetup,
        {
          ...args,
          candidateEncryptedPassword: encrypt(
            generateOpaqueToken("eldb_"),
            encryptionKey,
          ),
        },
      );
      const password = decrypt(prepared.encryptedPassword, encryptionKey);
      const result = await reconcileLibraryDatabase({
        provisionerUrl,
        token,
        libraryId: args.libraryId,
        password,
      });
      return await ctx.runMutation(
        internal.evidenceLibraries.databaseSetup.completeDatabaseSetup,
        {
          ...args,
          encryptedDatabaseUrl: encrypt(result.databaseUrl, encryptionKey),
          outcome: result.outcome,
          databaseName: result.databaseName,
          loginName: result.loginName,
        },
      );
    } catch (error) {
      const safeError =
        error instanceof DatabaseProvisionerError
          ? { code: error.code, message: error.message }
          : {
              code: "DATABASE_SETUP_FAILED",
              message: "Database setup failed before PostgreSQL was ready",
            };
      await ctx.runMutation(
        internal.evidenceLibraries.setupOperation.failSetupOperation,
        {
          ...args,
          expectedStage: "database",
          error: safeError,
        },
      );
      return { status: "failed" as const };
    }
  },
});
