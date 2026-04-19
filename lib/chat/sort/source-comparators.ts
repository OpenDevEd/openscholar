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

type DirectedComparator = (
  a: SortableSource,
  b: SortableSource,
  sign: 1 | -1,
) => number;

// Each comparator returns the directed primary delta. Most fields just
// multiply their natural-asc delta by `sign`. Nullable fields (year)
// always send nulls last regardless of direction — the sign only flips
// the comparison among non-null values.
const PRIMARY_COMPARATORS: Record<Exclude<SortField, "added">, DirectedComparator> = {
  title: (a, b, sign) => a.title.localeCompare(b.title) * sign,
  year: (a, b, sign) => {
    const aNull = a.year === null;
    const bNull = b.year === null;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    return (a.year! - b.year!) * sign;
  },
  source: (a, b, sign) =>
    (SOURCE_ORDER[a.sourceType] - SOURCE_ORDER[b.sourceType]) * sign,
  inContext: () => 0,
};

const SOURCE_ORDER: Record<SourceType, number> = {
  openalex: 0,
  upload: 1,
  zotero: 2,
  history: 3,
  unknown: 4,
};

export function sortByComparator<R extends SortableSource>(
  rows: ReadonlyArray<R>,
  field: SortField,
  dir: SortDir,
): R[] {
  const sign: 1 | -1 = dir === "desc" ? -1 : 1;
  if (field === "added") {
    return [...rows].sort((a, b) => (a.position - b.position) * sign);
  }
  const cmp = PRIMARY_COMPARATORS[field];
  return [...rows].sort((a, b) => {
    const primary = cmp(a, b, sign);
    if (primary !== 0) return primary;
    return a.position - b.position;
  });
}
