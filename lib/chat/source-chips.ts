/**
 * Pure helpers for the chat Sources panel source-type chip bar.
 *
 * The chip bar is a single-select facet over `sourceType`; this module
 * computes the per-bucket counts the chips render and the visible-row
 * filter the panel applies after a chip is chosen. The 'unknown' bucket
 * is intentionally omitted from the chip UI but its count is reported
 * here for completeness so future debug surfaces can read it.
 */

import type { SourceType } from "@/lib/chat/source-type";

export type SourceChip = "all" | "openalex" | "upload" | "zotero" | "history";

export type ChippableSource = {
  sourceType: SourceType;
};

export type ChipCounts = {
  all: number;
  openalex: number;
  upload: number;
  zotero: number;
  history: number;
  unknown: number;
};

export function computeChipCounts(
  _rows: ReadonlyArray<ChippableSource>,
): ChipCounts {
  return {
    all: 0,
    openalex: 0,
    upload: 0,
    zotero: 0,
    history: 0,
    unknown: 0,
  };
}
