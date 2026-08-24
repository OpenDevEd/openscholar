"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { encrypt, getKeyPrefix } from "../lib/crypto";
import { createError } from "../lib/errors";
import { digestOpaqueToken, generateOpaqueToken } from "../lib/opaqueToken";

export const writeCredential = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    concretePath: v.string(),
    instanceKey: v.optional(v.string()),
    value: v.string(),
  },
  returns: v.id("evidenceLibraryCredentials"),
  handler: async (ctx, args): Promise<Id<"evidenceLibraryCredentials">> => {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw createError(
        "API_KEY_ENCRYPTION_KEY_MISSING",
        "Credential encryption key is not configured",
      );
    }
    const encryptedValue = encrypt(args.value, encryptionKey);
    return await ctx.runMutation(
      internal.evidenceLibraries.credentials.storeEncryptedCredential,
      {
        libraryId: args.libraryId,
        concretePath: args.concretePath,
        instanceKey: args.instanceKey,
        encryptedValue,
        maskedHint: getKeyPrefix(args.value),
      },
    );
  },
});

export const rotateServiceCredential = action({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    credential: v.string(),
    maskedHint: v.string(),
    credentialId: v.id("evidenceLibraryCredentials"),
  }),
  handler: async (ctx, args): Promise<{
    credential: string;
    maskedHint: string;
    credentialId: Id<"evidenceLibraryCredentials">;
  }> => {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw createError(
        "API_KEY_ENCRYPTION_KEY_MISSING",
        "Credential encryption key is not configured",
      );
    }
    const credential = generateOpaqueToken("els_");
    const maskedHint = getKeyPrefix(credential);
    const credentialId = await ctx.runMutation(
      internal.evidenceLibraries.credentials.storeEncryptedServiceCredential,
      {
        libraryId: args.libraryId,
        encryptedValue: encrypt(credential, encryptionKey),
        credentialDigest: digestOpaqueToken(credential),
        maskedHint,
      },
    );
    return { credential, maskedHint, credentialId };
  },
});
