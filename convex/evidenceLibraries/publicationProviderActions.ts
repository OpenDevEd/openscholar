"use node";

import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { createHmac } from "node:crypto";
import { encrypt, decrypt } from "../lib/crypto";
import { createError } from "../lib/errors";
import { buildPublicationConfiguration } from "../../lib/evidence-libraries/configuration/publication";
import {
  publicationSettingsValidator,
  publicationSecretsValidator,
  type PublicationSecrets,
} from "./publicationValidators";
import {
  verifyCrossrefCredentials,
  verifyZenodoCredentials,
} from "./publicationCredentialVerification";

function sandboxValue(name: string) {
  const value = process.env[`EVIDENCE_LIBRARY_${name}`]?.trim();
  if (!value)
    throw new Error(
      "The OpenScholar sandbox is not configured for this provider yet.",
    );
  return value;
}

export const verifyAndSave = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    settings: publicationSettingsValidator,
    credentials: publicationSecretsValidator,
    expectedUpdatedAt: v.union(v.null(), v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
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
      const settings = structuredClone(args.settings);
      for (const key of [
        "prefix",
        "suffixNamespace",
        "depositorName",
        "email",
        "registrant",
      ] as const)
        settings.crossref[key] = settings.crossref[key].trim();
      settings.zenodo.license = settings.zenodo.license.trim().toLowerCase();
      settings.crossref.suffixNamespace ||= prepared.slug;
      const previous: PublicationSecrets = prepared.record
        ? JSON.parse(decrypt(prepared.record.encryptedValue, encryptionKey))
        : {};
      const credentials: PublicationSecrets = {};
      if (settings.zenodo.mode === "sandbox")
        credentials.zenodoToken = sandboxValue("ZENODO_SANDBOX_TOKEN");
      if (settings.zenodo.mode === "custom")
        credentials.zenodoToken =
          args.credentials.zenodoToken?.trim() ||
          (prepared.record?.publicationSettings?.zenodo.mode === "custom"
            ? previous.zenodoToken
            : undefined);
      if (settings.crossref.mode === "sandbox") {
        credentials.crossrefLoginId = sandboxValue("CROSSREF_SANDBOX_LOGIN_ID");
        credentials.crossrefPassword = sandboxValue(
          "CROSSREF_SANDBOX_PASSWORD",
        );
        settings.crossref.prefix = sandboxValue("CROSSREF_SANDBOX_PREFIX");
        settings.crossref.depositorName = sandboxValue(
          "CROSSREF_SANDBOX_DEPOSITOR_NAME",
        );
        settings.crossref.email = sandboxValue("CROSSREF_SANDBOX_EMAIL");
        settings.crossref.registrant = sandboxValue(
          "CROSSREF_SANDBOX_REGISTRANT",
        );
      }
      if (settings.crossref.mode === "custom") {
        const sameMode =
          prepared.record?.publicationSettings?.crossref.mode === "custom";
        credentials.crossrefLoginId =
          args.credentials.crossrefLoginId?.trim() ||
          (sameMode ? previous.crossrefLoginId : undefined);
        credentials.crossrefPassword =
          args.credentials.crossrefPassword ||
          (sameMode ? previous.crossrefPassword : undefined);
      }
      buildPublicationConfiguration(settings, credentials);
      if (settings.zenodo.mode !== "off")
        await verifyZenodoCredentials(
          credentials.zenodoToken!,
          settings.zenodo.mode === "sandbox",
        );
      if (settings.crossref.mode !== "off")
        await verifyCrossrefCredentials(
          credentials.crossrefLoginId!,
          credentials.crossrefPassword!,
          settings.crossref.mode === "sandbox",
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
      if (error instanceof Error && error.name === "TimeoutError")
        throw createError(
          "VALIDATION_ERROR",
          "The provider took too long to respond. Nothing was saved. Try again.",
        );
      throw createError(
        "VALIDATION_ERROR",
        error instanceof Error
          ? error.message
          : "Credentials could not be verified. Nothing was saved.",
      );
    }
  },
});
