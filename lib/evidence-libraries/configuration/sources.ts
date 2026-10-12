import type { ZoteroSourceEntry } from "@/convex/zotero/sourceEntry";
import { credentialKeyFor } from "./credential-paths";

export const OPENALEX_API_KEY_PATH = "/sources/0/apiKey";
export const OPENALEX_API_KEY_PATTERN = "/sources/*/apiKey";
export const OPENALEX_API_KEY_INSTANCE = "openalex";
export const OPENALEX_API_CREDENTIAL_KEY = credentialKeyFor(
  OPENALEX_API_KEY_PATTERN,
  OPENALEX_API_KEY_INSTANCE,
);

/** How close a record is to a screening source's subject, lowest first, as the library grades it. */
export type ScreeningGrade = "not-about" | "passing" | "touches" | "about";

/**
 * A source's AI screening: whether the library grades its records against a subject, and which grades it keeps out of
 * the library. A source saved before screening has none, which the library reads as off.
 */
export type SourceScreeningSettings = { enabled: boolean; subject: string; keptOut: ScreeningGrade[] };

/** What an import asks OpenAlex: a classic search and filter, or one OQL query with the filters in it. */
export type OpenAlexQuery = { filter?: string; search?: string; oql?: string };

export type OpenAlexSourceEntry = {
  key: string;
  provider: "openalex";
  enabled: boolean;
  writebackEnabled: false;
  settings: {
    name: string;
    /** The search it was made from, which reopens with every control. */
    searchUrl: string;
    apiKeyMode: "platform" | "custom";
    approvedQuery: {
      version: string;
      approvedAt: string;
      query: OpenAlexQuery;
    };
    downloadPdfs: boolean;
  };
  screening?: SourceScreeningSettings;
};

/** One of the owner's OpenScholar collections, which the library follows live. Its items resolve through OpenAlex. */
export type OpenScholarCollectionSourceEntry = {
  key: string;
  provider: "openscholar";
  collectionId: string;
  enabled: boolean;
  writebackEnabled: false;
  settings: {
    /** The collection's name when it was added; the library reads the current one itself. */
    name: string;
    apiKeyMode: "platform" | "custom";
    downloadPdfs: boolean;
  };
  screening?: SourceScreeningSettings;
};

export type EvidenceSourceEntry =
  | ZoteroSourceEntry
  | OpenAlexSourceEntry
  | OpenScholarCollectionSourceEntry;

/** Sources whose records are OpenAlex works, read with the library's OpenAlex key. */
export type OpenAlexWorksSourceEntry = OpenAlexSourceEntry | OpenScholarCollectionSourceEntry;

export function readsOpenAlexWorks(
  source: EvidenceSourceEntry,
): source is OpenAlexWorksSourceEntry {
  return source.provider === "openalex" || source.provider === "openscholar";
}

/** The source with OpenAlex read through the platform's key or the library's own. */
export function withOpenAlexKeyMode<T extends OpenAlexWorksSourceEntry>(
  source: T,
  apiKeyMode: "platform" | "custom",
): T {
  return { ...source, settings: { ...source.settings, apiKeyMode } };
}

export function collectionSourceKey(collectionId: string): string {
  return `openscholar-${collectionId}`;
}

export function collectionSourceEntry(
  collection: { collectionId: string; name: string },
  apiKeyMode: "platform" | "custom",
): OpenScholarCollectionSourceEntry {
  return {
    key: collectionSourceKey(collection.collectionId),
    provider: "openscholar",
    collectionId: collection.collectionId,
    enabled: true,
    writebackEnabled: false,
    // A source name holds 80 characters; the collection keeps its full name.
    settings: { name: collection.name.slice(0, 80), apiKeyMode, downloadPdfs: false },
  };
}

function newOpenAlexQueryVersion(): string {
  return crypto.randomUUID();
}

function queryFingerprint(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const query = value as Record<string, unknown>;
  return JSON.stringify({ filter: query.filter, search: query.search, oql: query.oql });
}

export function approveOpenAlexQuery(
  current: OpenAlexSourceEntry["settings"]["approvedQuery"] | undefined,
  query: OpenAlexQuery,
): OpenAlexSourceEntry["settings"]["approvedQuery"] {
  if (current && queryFingerprint(current.query) === queryFingerprint(query)) {
    return current;
  }
  return {
    version: newOpenAlexQueryVersion(),
    approvedAt: new Date().toISOString(),
    query,
  };
}

/** Each approved OpenAlex query version in a sources payload, with its query's fingerprint. */
export function approvedQueryVersions(payload: unknown): Array<{ version: string; fingerprint: string }> {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const source = value as Record<string, unknown>;
    if (source.provider !== "openalex") return [];
    const settings = source.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return [];
    const approved = (settings as Record<string, unknown>).approvedQuery;
    if (!approved || typeof approved !== "object" || Array.isArray(approved)) return [];
    const { version, query } = approved as Record<string, unknown>;
    return typeof version === "string" ? [{ version, fingerprint: queryFingerprint(query) }] : [];
  });
}

/** A version identifies immutable query contents, even across source removal. */
export function assertImmutableOpenAlexQueryVersions(
  historical: readonly unknown[],
  proposed: unknown,
): void {
  const versions = new Map<string, string>();
  for (const payload of [...historical, proposed]) {
    for (const { version, fingerprint } of approvedQueryVersions(payload)) {
      const previous = versions.get(version);
      if (previous !== undefined && previous !== fingerprint) {
        throw new Error("An approved OpenAlex query version cannot be changed");
      }
      versions.set(version, fingerprint);
    }
  }
}
