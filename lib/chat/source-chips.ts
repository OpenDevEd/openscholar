/**
 * Pure helpers for the chat Sources panel source-type chip bar.
 *
 * The chip bar is a single-select facet over `sourceType`; this module
 * computes the per-bucket counts the chips render and the visible-row
 * filter the panel applies after a chip is chosen. The 'unknown' bucket
 * is intentionally omitted from the chip UI but its count is reported
 * here for completeness so future debug surfaces can read it.
 */

import type { ChatSourceType } from "@/lib/chat/source-type";

export type SourceChip = "all" | "openalex" | "zotero";

export type ChippableSource = {
  sourceType: ChatSourceType;
};

export type ChipCounts = {
  all: number;
  openalex: number;
  zotero: number;
  unknown: number;
};

export function computeChipCounts(
  rows: ReadonlyArray<ChippableSource>,
): ChipCounts {
  const counts: ChipCounts = {
    all: rows.length,
    openalex: 0,
    zotero: 0,
    unknown: 0,
  };
  for (const row of rows) counts[row.sourceType] += 1;
  return counts;
}

export function filterBySourceChip<R extends ChippableSource>(
  rows: ReadonlyArray<R>,
  chip: SourceChip,
): ReadonlyArray<R> {
  if (chip === "all") return rows;
  return rows.filter((row) => row.sourceType === chip);
}
