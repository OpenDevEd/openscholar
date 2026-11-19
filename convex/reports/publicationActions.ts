"use node";

// Saves the Zenodo and Crossref accounts Openscholar Reports registers with, from the form a community's settings
// use, once both have accepted them. One rule of a community's is lifted: Crossref may be on without Zenodo,
// because Openscholar decides whether its reports are archived there.
import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { refuseApps } from "../lib/auth";
import { decrypt, encrypt } from "../lib/crypto";
import { createError } from "../lib/errors";
import { publicationRefusal, verifiedPublication } from "../evidenceLibraries/publicationCredentialVerification";
import { publicationSecretsValidator, publicationSettingsValidator, type PublicationSecrets } from "../evidenceLibraries/publicationValidators";
import { CHANGED } from "./publication";

/** The DOI namespace reports get when an admin types none: 10.xxxx/openscholar-reports.r100045. */
const NAMESPACE = "openscholar-reports";

export const save = action({
  args: { settings: publicationSettingsValidator, credentials: publicationSecretsValidator, expectedUpdatedAt: v.union(v.null(), v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await refuseApps(ctx);
    const kept = await ctx.runQuery(internal.reports.publication.prepare, {});
    if (kept.savedAt !== args.expectedUpdatedAt) throw createError("CONFLICT", CHANGED);
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Credential storage is not configured.");
    try {
      const asked = structuredClone(args.settings);
      // Zenodo can archive under the Crossref DOI only while Crossref is on.
      if (asked.crossref.mode === "off") asked.zenodo.defaultIdentifierPolicy = "mint-zenodo";
      asked.crossref.suffixNamespace = asked.crossref.suffixNamespace.trim().toLowerCase();
      const previous: PublicationSecrets = kept.encryptedCredentials ? JSON.parse(decrypt(kept.encryptedCredentials, encryptionKey)) : {};
      const keptCustom = kept.encryptedCustomCredentials ? { ...(kept.customAccounts?.crossref && { crossref: kept.customAccounts.crossref }), credentials: JSON.parse(decrypt(kept.encryptedCustomCredentials, encryptionKey)) as PublicationSecrets } : undefined;
      const { settings, credentials, custom } = await verifiedPublication({ settings: asked, credentials: args.credentials }, { settings: kept.settings, credentials: previous, ...(keptCustom && { custom: keptCustom }) }, { namespace: NAMESPACE });
      await ctx.runMutation(internal.reports.publication.saveVerified, {
        settings,
        encryptedCredentials: encrypt(JSON.stringify(credentials), encryptionKey),
        customAccounts: { crossref: custom.crossref ?? null, zenodoToken: !!custom.credentials.zenodoToken, crossrefLogin: !!custom.credentials.crossrefLoginId },
        encryptedCustomCredentials: encrypt(JSON.stringify(custom.credentials), encryptionKey),
        expectedUpdatedAt: args.expectedUpdatedAt,
      });
      return null;
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw createError("VALIDATION_ERROR", publicationRefusal(error));
    }
  },
});
