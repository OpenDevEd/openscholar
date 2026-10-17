import type { SourceScreeningSettings } from "../../lib/evidence-libraries/configuration/sources";

// The draft shape of one connected Zotero group. Shared by the page and the
// deploy pipeline; it never carries the key, which is added at deploy time.
export type ZoteroSourceEntry = {
  key: string;
  provider: "zotero";
  groupId: string;
  enabled: boolean;
  writebackEnabled: boolean;
  /** Whether the group adds PDFs, and which: those with one of its publish tags, or every one. */
  settings: { downloadPdfs: boolean; pdfPublishing: ZoteroPdfPublishing };
  screening?: SourceScreeningSettings;
};

/** The group's publish tags also make its notes and links public, whichever PDFs are published. */
export type ZoteroPdfPublishing = { mode: "tagged" | "every"; tags: string[] };

/** The publish tags a new group starts with, the runtime's own defaults. */
export const DEFAULT_ZOTERO_PUBLISH_TAGS = ["_publish", "publishPDF"];

export function zoteroSourceKey(groupId: string): string {
  return `zotero-${groupId}`;
}

export function zoteroSourceEntry(groupId: string): ZoteroSourceEntry {
  return {
    key: zoteroSourceKey(groupId),
    provider: "zotero",
    groupId,
    enabled: true,
    writebackEnabled: false,
    settings: { downloadPdfs: true, pdfPublishing: { mode: "tagged", tags: [...DEFAULT_ZOTERO_PUBLISH_TAGS] } },
  };
}
