"use node";

import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { createHmac } from "node:crypto";
import { encrypt, decrypt } from "../lib/crypto";
import { createError } from "../lib/errors";
import {
  publicationSettingsValidator,
  publicationSecretsValidator,
  type PublicationSecrets,
} from "./publicationValidators";
import {
  publicationRefusal,
  verifiedPublication,
} from "./publicationCredentialVerification";
import { refuseApps } from "../lib/auth";

export const verifyAndSave = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    settings: publicationSettingsValidator,
    credentials: publicationSecretsValidator,
    expectedUpdatedAt: v.union(v.null(), v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await refuseApps(ctx);
    const prepared = await ctx.runQuery(
      internal.evidenceLibraries.publicationProviders.prepare,
      { libraryId: args.libraryId },
    );
    if ((prepared.record?.updatedAt ?? null) !== args.expectedUpdatedAt)
      throw createError(
        "CONFLICT",
        "Publishing settings changed. Reload and try again.",
      );
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey)
      throw createError(
        "API_KEY_ENCRYPTION_KEY_MISSING",
        "Credential storage is not configured.",
      );
    try {
      const previous: PublicationSecrets = prepared.record
        ? JSON.parse(decrypt(prepared.record.encryptedValue, encryptionKey))
        : {};
      const { settings, credentials } = await verifiedPublication(
        args,
        { settings: prepared.record?.publicationSettings, credentials: previous },
        { namespace: prepared.slug },
      );
      await ctx.runMutation(
        internal.evidenceLibraries.publicationProviders.saveVerified,
        {
          libraryId: args.libraryId,
          settings,
          encryptedCredentials: encrypt(
            JSON.stringify(credentials),
            encryptionKey,
          ),
          expectedUpdatedAt: args.expectedUpdatedAt,
          verifiedAt: Date.now(),
          credentialDigest: createHmac("sha256", encryptionKey)
            .update(JSON.stringify([settings, credentials]))
            .digest("hex"),
        },
      );
      return null;
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw createError("VALIDATION_ERROR", publicationRefusal(error));
    }
  },
});
