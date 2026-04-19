/**
 * Pure source-type classifier for the chat Sources panel.
 *
 * Derives a single categorical label from the nullable auxiliary fields
 * on an `extractionJobSources` row. Shared by the Convex list query
 * (for the `ChatSourceRow.sourceType` field) and by the UI chip filters.
 *
 * Precedence is deliberate: zoteroUserId > searchFilters > storage-
 * backed pdfUrl > openalexId > unknown. A row should only satisfy one
 * rule in practice, but defensive precedence keeps the output stable
 * if a pathological row carries multiple signals.
 */

export type SourceType =
  | "openalex"
  | "upload"
  | "zotero"
  | "history"
  | "unknown";

export type SourceTypeInput = {
  zoteroUserId?: string;
  searchFilters?: unknown;
  pdfUrl?: string;
  openalexId?: string;
};

export function classifySourceType(row: SourceTypeInput): SourceType {
  if (row.zoteroUserId != null) return "zotero";
  return "unknown";
}
