import type { ZoteroSourceEntry } from "@/convex/zotero/sourceEntry";
import { credentialKeyFor } from "./credential-paths";

export const OPENALEX_API_KEY_PATH = "/sources/0/apiKey";
export const OPENALEX_API_KEY_PATTERN = "/sources/*/apiKey";
export const OPENALEX_API_KEY_INSTANCE = "openalex";
export const OPENALEX_API_CREDENTIAL_KEY = credentialKeyFor(
  OPENALEX_API_KEY_PATTERN,
  OPENALEX_API_KEY_INSTANCE,
);

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
};

export type EvidenceSourceEntry = ZoteroSourceEntry | OpenAlexSourceEntry;

export function isOpenAlexSource(
  source: EvidenceSourceEntry,
): source is OpenAlexSourceEntry {
  return source.provider === "openalex";
}

export function newOpenAlexQueryVersion(): string {
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

/** A version identifies immutable query contents, even across source removal. */
export function assertImmutableOpenAlexQueryVersions(
  historical: readonly unknown[],
  proposed: unknown,
): void {
  const versions = new Map<string, string>();
  for (const payload of [...historical, proposed]) {
    if (!Array.isArray(payload)) continue;
    for (const value of payload) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const source = value as Record<string, unknown>;
      if (source.provider !== "openalex") continue;
      const settings = source.settings;
      if (!settings || typeof settings !== "object" || Array.isArray(settings))
        continue;
      const approved = (settings as Record<string, unknown>).approvedQuery;
      if (!approved || typeof approved !== "object" || Array.isArray(approved))
        continue;
      const { version, query } = approved as Record<string, unknown>;
      if (typeof version !== "string") continue;
      const fingerprint = queryFingerprint(query);
      const previous = versions.get(version);
      if (previous !== undefined && previous !== fingerprint) {
        throw new Error("An approved OpenAlex query version cannot be changed");
      }
      versions.set(version, fingerprint);
    }
  }
}
