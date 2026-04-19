/**
 * Pure source-type classifier for the chat Sources panel.
 *
 * Derives a single categorical label from the nullable discriminators
 * on an `extractionJobSources` row. Chat jobs can only legitimately
 * carry OpenAlex or Zotero sources: uploads are disabled at job
 * creation (`usePdfs = false`), and saved-search history is expanded
 * into concrete OpenAlex results before the chat thread exists. The
 * classifier therefore returns a narrower union than the extraction
 * pipeline's taxonomy (`convex/extraction/expandSources.ts`).
 *
 * Precedence: zoteroUserId > openalexId > unknown. A row should only
 * satisfy one rule in practice, but defensive precedence keeps the
 * output stable if a pathological row carries multiple signals.
 */

export type ChatSourceType = "openalex" | "zotero" | "unknown";

export type SourceTypeInput = {
  zoteroUserId?: string;
  openalexId?: string;
};

export function classifySourceType(row: SourceTypeInput): ChatSourceType {
  if (row.zoteroUserId != null) return "zotero";
  if (row.openalexId != null) return "openalex";
  return "unknown";
}
