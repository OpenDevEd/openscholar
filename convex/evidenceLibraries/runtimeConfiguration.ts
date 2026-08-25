"use node";

import { createHash } from "node:crypto";
import {
  assembleEvidenceLibraryConfiguration,
  type AssembledEvidenceLibraryConfiguration,
} from "../../lib/evidence-libraries/configuration/assembly";
import type { EssentialConfigurationSections } from "../../lib/evidence-libraries/configuration/essential-configuration";
import { decrypt } from "../lib/crypto";

export const EVIDENCE_LIBRARY_SEARCH_HOST = "http://meilisearch:7700";
export const EVIDENCE_LIBRARY_SEARCH_INDEX = "evidence_library";

export function assembleEvidenceLibraryRuntimePayload(input: {
  encryptionKey: string;
  libraryId: string;
  revisionKey: string;
  revisionCreatedAt: number;
  appOrigin: string;
  convexSiteUrl: string;
  sections: EssentialConfigurationSections;
  encryptedMachineCredential: string;
  encryptedAuthenticationSecret: string;
  encryptedDatabaseUrl: string;
  searchHost: string;
  encryptedSearchKey: string;
  searchIndex: string;
  storageUrl: string;
  encryptedStorageServiceRoleKey: string;
  storagePrivateBucket: string;
  storagePublicBucket: string;
  storageMaxPdfBytes: number;
  zoteroTranslationUrl?: string;
}): {
  configuration: AssembledEvidenceLibraryConfiguration;
  runtimeConfigJson: string;
  runtimeConfigSha256: string;
} {
  const configuration = assembleEvidenceLibraryConfiguration({
    sections: input.sections,
    managed: {
      revision: input.revisionKey,
      updatedAt: new Date(input.revisionCreatedAt).toISOString(),
      libraryId: input.libraryId,
      convexSiteUrl: input.convexSiteUrl,
      loginPageUrl: new URL(
        `/evidence-libraries/${encodeURIComponent(input.libraryId)}/admin`,
        input.appOrigin,
      ).toString(),
      machineCredential: decrypt(
        input.encryptedMachineCredential,
        input.encryptionKey,
      ),
      authenticationSecret: decrypt(
        input.encryptedAuthenticationSecret,
        input.encryptionKey,
      ),
      databaseUrl: decrypt(input.encryptedDatabaseUrl, input.encryptionKey),
      searchHost: input.searchHost,
      searchKey: decrypt(input.encryptedSearchKey, input.encryptionKey),
      searchIndex: input.searchIndex,
      storageUrl: input.storageUrl,
      storageServiceRoleKey: decrypt(
        input.encryptedStorageServiceRoleKey,
        input.encryptionKey,
      ),
      storagePrivateBucket: input.storagePrivateBucket,
      storagePublicBucket: input.storagePublicBucket,
      storageMaxPdfBytes: input.storageMaxPdfBytes,
      zoteroTranslationUrl: input.zoteroTranslationUrl,
    },
  });
  const runtimeConfigJson = JSON.stringify(configuration);
  return {
    configuration,
    runtimeConfigJson,
    runtimeConfigSha256: createHash("sha256")
      .update(runtimeConfigJson)
      .digest("hex"),
  };
}
