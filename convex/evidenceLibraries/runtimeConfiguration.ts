"use node";

import { buildPublicationConfiguration } from "../../lib/evidence-libraries/configuration/publication";
import type { PublicationSettings } from "./publicationValidators";

import { createHash } from "node:crypto";
import {
  assembleEvidenceLibraryConfiguration,
  type AssembledEvidenceLibraryConfiguration,
  type OwnerSections,
  type PlatformBrandAssets,
  type PlatformMailService,
  type TeamMember,
} from "../../lib/evidence-libraries/configuration/assembly";
import type { Id } from "../_generated/dataModel";
import { decrypt } from "../lib/crypto";
import type { ZoteroGroupScopes } from "../zotero/groupAccess";
import { createSourceCredentials } from "./sourceCredentials";
import { createAiProviderKey } from "./aiProviderKey";

export const EVIDENCE_LIBRARY_SEARCH_HOST = "http://meilisearch:7700";
export const EVIDENCE_LIBRARY_SEARCH_INDEX = "evidence_library";

/**
 * Where a library sends someone who opens its admin area without a session:
 * the OpenScholar page that signs them in and hands the session back.
 */
export function buildEvidenceLibraryLoginPageUrl(input: {
  libraryId: Id<"evidenceLibraries">;
  appOrigin: string;
}): string {
  return new URL(
    `/evidence-libraries/${encodeURIComponent(input.libraryId)}/admin`,
    input.appOrigin,
  ).toString();
}

/**
 * Setup and publishing both build the configuration here. Every input is
 * required, even the ones that can be undefined, so a path that forgets one
 * fails to compile instead of shipping a library without it.
 */
export function assembleEvidenceLibraryRuntimePayload(input: {
  /** When this configuration is built; the runtime takes only newer ones. */
  assembledAt: number;
  encryptionKey: string;
  libraryId: Id<"evidenceLibraries">;
  revision: { key: string; createdAt: number };
  origins: { app: string; convexSite: string };
  sections: OwnerSections;
  credentials: {
    encryptedMachine: string;
    encryptedAuthentication: string;
    encryptedDatabaseUrl: string;
  };
  search: { host: string; encryptedKey: string; index: string };
  storage: {
    url: string;
    encryptedServiceRoleKey: string;
    privateBucket: string;
    publicBucket: string;
    maxPdfBytes: number;
  };
  zoteroTranslationUrl: string | undefined;
  mail: PlatformMailService | undefined;
  brand: PlatformBrandAssets | undefined;
  embeddingApiKey: string | undefined;
  zoteroGroups: {
    groupId: string;
    encryptedApiKey: string;
    scopes: ZoteroGroupScopes;
  }[];
  aiProviderKey: { encryptedApiKey: string } | undefined;
  openAlexApiKey: { encryptedApiKey: string } | undefined;
  platformOpenAlexApiKey: string | undefined;
  publicationProviders:
    | { settings: PublicationSettings; encryptedCredentials: string }
    | undefined;
  allowedAiModels: readonly string[];
  aiModelMetadata: Record<string, { name: string; company: string }>;
  aiModelCatalogReady: boolean;
  team: readonly TeamMember[];
}): {
  runtimeConfig: AssembledEvidenceLibraryConfiguration;
  runtimeConfigJson: string;
  runtimeConfigSha256: string;
} {
  const runtimeConfig = assembleEvidenceLibraryConfiguration({
    sections: input.sections,
    managed: {
      revision: input.revision.key,
      // When this copy was built, not when its version was frozen: a rollback
      // stamps the configuration it restores with the time it ran, and the
      // runtime only takes a configuration newer than the one it has.
      updatedAt: new Date(input.assembledAt).toISOString(),
      libraryId: input.libraryId,
      convexSiteUrl: input.origins.convexSite,
      loginPageUrl: buildEvidenceLibraryLoginPageUrl({
        libraryId: input.libraryId,
        appOrigin: input.origins.app,
      }),
      machineCredential: decrypt(
        input.credentials.encryptedMachine,
        input.encryptionKey,
      ),
      authenticationSecret: decrypt(
        input.credentials.encryptedAuthentication,
        input.encryptionKey,
      ),
      databaseUrl: decrypt(
        input.credentials.encryptedDatabaseUrl,
        input.encryptionKey,
      ),
      searchHost: input.search.host,
      searchKey: decrypt(input.search.encryptedKey, input.encryptionKey),
      searchIndex: input.search.index,
      storageUrl: input.storage.url,
      storageServiceRoleKey: decrypt(
        input.storage.encryptedServiceRoleKey,
        input.encryptionKey,
      ),
      storagePrivateBucket: input.storage.privateBucket,
      storagePublicBucket: input.storage.publicBucket,
      storageMaxPdfBytes: input.storage.maxPdfBytes,
      allowedAiModels: input.allowedAiModels,
      aiModelMetadata: input.aiModelMetadata,
      aiModelCatalogReady: input.aiModelCatalogReady,
      zoteroTranslationUrl: input.zoteroTranslationUrl,
      mail: input.mail,
      brand: input.brand,
      embeddingApiKey: input.embeddingApiKey,
      team: input.team,
      publication: input.publicationProviders
        ? buildPublicationConfiguration(
            input.publicationProviders.settings,
            JSON.parse(
              decrypt(
                input.publicationProviders.encryptedCredentials,
                input.encryptionKey,
              ),
            ),
          )
        : undefined,
    },
    // Each Zotero source gets its group's key here and nowhere earlier.
    applySourceCredentials: createSourceCredentials(
      input.zoteroGroups.map((group) => ({
        groupId: group.groupId,
        apiKey: decrypt(group.encryptedApiKey, input.encryptionKey),
        scopes: group.scopes,
      })),
      {
        custom: input.openAlexApiKey
          ? decrypt(input.openAlexApiKey.encryptedApiKey, input.encryptionKey)
          : undefined,
        platform: input.platformOpenAlexApiKey,
      },
    ),
    // The AI provider key, likewise: decrypted only for this payload.
    applyAiProviderKey: createAiProviderKey(
      input.aiProviderKey
        ? decrypt(input.aiProviderKey.encryptedApiKey, input.encryptionKey)
        : undefined,
    ),
  });
  const runtimeConfigJson = runtimeConfigText(runtimeConfig);
  return {
    runtimeConfig,
    runtimeConfigJson,
    runtimeConfigSha256: createHash("sha256")
      .update(runtimeConfigJson)
      .digest("hex"),
  };
}

/**
 * The configuration as the runtime receives it. Coolify writes it into a build-time .env file inside single quotes
 * and cannot escape one there, so a library whose text had an apostrophe could not be deployed. Apostrophes go as
 * JSON's \u0027 escape, which parses to the same text.
 */
export function runtimeConfigText(runtimeConfig: unknown) {
  return JSON.stringify(runtimeConfig).replaceAll("'", "\\u0027");
}
