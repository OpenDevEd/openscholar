"use node";

import { createHash } from "node:crypto";
import {
  assembleEvidenceLibraryConfiguration,
  type AssembledEvidenceLibraryConfiguration,
  type OwnerSections,
} from "../../lib/evidence-libraries/configuration/assembly";
import type { Id } from "../_generated/dataModel";
import { decrypt } from "../lib/crypto";
import type { ZoteroGroupScopes } from "../zotero/groupAccess";
import { createZoteroSourceCredentials } from "../zotero/sourceCredentials";

export const EVIDENCE_LIBRARY_SEARCH_HOST = "http://meilisearch:7700";
export const EVIDENCE_LIBRARY_SEARCH_INDEX = "evidence_library";

export function assembleEvidenceLibraryRuntimePayload(input: {
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
  zoteroTranslationUrl?: string;
  zoteroGroups: {
    groupId: string;
    encryptedApiKey: string;
    scopes: ZoteroGroupScopes;
  }[];
}): {
  runtimeConfig: AssembledEvidenceLibraryConfiguration;
  runtimeConfigJson: string;
  runtimeConfigSha256: string;
} {
  const runtimeConfig = assembleEvidenceLibraryConfiguration({
    sections: input.sections,
    managed: {
      revision: input.revision.key,
      updatedAt: new Date(input.revision.createdAt).toISOString(),
      libraryId: input.libraryId,
      convexSiteUrl: input.origins.convexSite,
      loginPageUrl: new URL(
        `/evidence-libraries/${encodeURIComponent(input.libraryId)}/admin`,
        input.origins.app,
      ).toString(),
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
      zoteroTranslationUrl: input.zoteroTranslationUrl,
    },
    // Each Zotero source gets its group's key here and nowhere earlier.
    applySourceCredentials: createZoteroSourceCredentials(
      input.zoteroGroups.map((group) => ({
        groupId: group.groupId,
        apiKey: decrypt(group.encryptedApiKey, input.encryptionKey),
        scopes: group.scopes,
      })),
    ),
  });
  const runtimeConfigJson = JSON.stringify(runtimeConfig);
  return {
    runtimeConfig,
    runtimeConfigJson,
    runtimeConfigSha256: createHash("sha256")
      .update(runtimeConfigJson)
      .digest("hex"),
  };
}
