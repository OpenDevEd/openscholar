/**
 * Pure sort comparators for the chat Sources panel sort pills.
 *
 * Each comparator is defined in its natural ascending form. The dir
 * parameter flips the primary axis, but the position-asc tiebreak is
 * always applied last so equal primary keys preserve the frozen original
 * order regardless of direction (per design D8).
 */

import type { SourceType } from "@/lib/chat/source-type";

export type SortField = "added" | "title" | "year" | "source" | "inContext";
export type SortDir = "asc" | "desc";

export type SortableSource = {
  position: number;
  included: boolean;
  title: string;
  year: number | null;
  sourceType: SourceType;
};

export function sortByComparator<R extends SortableSource>(
  rows: ReadonlyArray<R>,
  field: SortField,
  dir: SortDir,
): R[] {
  // Phase A R1 only handles 'added'; subsequent reds extend.
  if (field === "added") {
    const sign = dir === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => (a.position - b.position) * sign);
  }
  return [...rows];
}
