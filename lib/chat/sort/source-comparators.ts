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

// Each comparator is defined ascending; sortByComparator multiplies by
// -1 for desc and always applies a position-asc tiebreak so equal
// primary keys preserve the frozen original order regardless of dir.
const PRIMARY_COMPARATORS: Record<
  Exclude<SortField, "added">,
  (a: SortableSource, b: SortableSource) => number
> = {
  title: (a, b) => a.title.localeCompare(b.title),
  year: () => 0,
  source: () => 0,
  inContext: () => 0,
};

export function sortByComparator<R extends SortableSource>(
  rows: ReadonlyArray<R>,
  field: SortField,
  dir: SortDir,
): R[] {
  const sign = dir === "desc" ? -1 : 1;
  if (field === "added") {
    return [...rows].sort((a, b) => (a.position - b.position) * sign);
  }
  const cmp = PRIMARY_COMPARATORS[field];
  return [...rows].sort((a, b) => {
    const primary = cmp(a, b) * sign;
    if (primary !== 0) return primary;
    return a.position - b.position;
  });
}
