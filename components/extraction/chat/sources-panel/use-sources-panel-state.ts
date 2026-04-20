"use client";

import { useDeferredValue, useMemo } from "react";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import {
  computeChipCounts,
  filterBySourceChip,
  type ChipCounts,
  type SourceChip,
} from "@/lib/chat/source-chips";
import {
  runWeightedSearch,
  scoreSource,
  type SearchMatch,
} from "@/lib/chat/search/source-scorer";
import {
  sortByComparator,
  type SortDir,
  type SortField,
} from "@/lib/chat/sort/source-comparators";

const SORT_FIELDS = ["added", "title", "year", "source", "inContext"] as const;
const SORT_DIRS = ["asc", "desc"] as const;
const SOURCE_CHIPS = ["all", "openalex", "zotero"] as const;

export type SourcesPanelState = {
  q: string;
  sort: SortField;
  dir: SortDir;
  src: SourceChip;
};

export type SourcesPanelStateApi = {
  state: SourcesPanelState;
  setState: (next: Partial<SourcesPanelState>) => void;
  visibleRows: ChatSourceRow[];
  matches: ReadonlyMap<string, SearchMatch>;
  chipCounts: ChipCounts;
  totalCount: number;
  includedCount: number;
  /** True when the deferred query lags behind the eager `state.q` — i.e., the
   *  filter pipeline is still catching up with the latest keystroke. */
  isSearchStale: boolean;
};

export function useSourcesPanelState(
  rows: ReadonlyArray<ChatSourceRow>,
): SourcesPanelStateApi {
  const [state, setState] = useQueryStates(
    {
      q: parseAsString.withDefault(""),
      sort: parseAsStringLiteral(SORT_FIELDS).withDefault("added"),
      dir: parseAsStringLiteral(SORT_DIRS).withDefault("asc"),
      src: parseAsStringLiteral(SOURCE_CHIPS).withDefault("all"),
    },
    {
      urlKeys: {
        q: "src_q",
        sort: "src_sort",
        dir: "src_dir",
        src: "src_chip",
      },
    },
  );

  // Eager `state.q` binds the <input value={...}> for zero perceived lag.
  // The deferred value drives the expensive filter + scorer pipeline — under
  // rendering pressure React can interrupt its render for newer keystrokes.
  const deferredQuery = useDeferredValue(state.q);
  const isSearchStale = deferredQuery !== state.q;

  const chipCounts = useMemo(() => computeChipCounts(rows), [rows]);

  const filteredByChip = useMemo(
    () => filterBySourceChip(rows, state.src),
    [rows, state.src],
  );

  const searched = useMemo(
    () => runWeightedSearch(filteredByChip, deferredQuery),
    [filteredByChip, deferredQuery],
  );

  const visibleRows = useMemo(
    () => sortByComparator(searched, state.sort, state.dir),
    [searched, state.sort, state.dir],
  );

  const matches = useMemo(() => {
    const map = new Map<string, SearchMatch>();
    if (deferredQuery.trim().length === 0) return map;
    for (const row of visibleRows) {
      map.set(row.chatPaperId, scoreSource(row, deferredQuery));
    }
    return map;
  }, [visibleRows, deferredQuery]);

  const totalCount = rows.length;
  const includedCount = useMemo(
    () => rows.reduce((n, row) => n + (row.included ? 1 : 0), 0),
    [rows],
  );

  return {
    state,
    setState: (next) => {
      void setState(next);
    },
    visibleRows,
    matches,
    chipCounts,
    totalCount,
    includedCount,
    isSearchStale,
  };
}
