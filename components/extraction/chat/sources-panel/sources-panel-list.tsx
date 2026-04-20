// React Compiler opt-out for this file only. TanStack Virtual #736 / #1119:
// the Compiler over-memoizes `useVirtualizer`'s return value, leaving
// `getVirtualItems()` stale. Revisit when upstream ships a Compiler-safe
// implementation. Scope is intentionally this file — every other file in
// the app keeps Compiler-on.
"use no memo";
"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "@/convex/_generated/api";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";
import {
  applyInclusionPatch,
  buildBulkPatch,
} from "@/lib/chat/chat-papers-selection";
import type { SearchMatch } from "@/lib/chat/search/source-scorer";
import { SourceRow } from "./source-row";

interface SourcesPanelListProps {
  jobId: Id<"extractionJobs">;
  rows: ChatSourceRow[];
  matches: ReadonlyMap<string, SearchMatch>;
  query: string;
  activeDescendantId: string | null;
  emptyState: React.ReactNode;
}

const ROW_HEIGHT_ESTIMATE = 76;
const OVERSCAN = 8;

/**
 * Virtualized Sources listbox surface.
 *
 * Renders only the viewport + overscan window of rows via
 * `@tanstack/react-virtual` — at N=1000 the DOM holds ≤ ~(viewport+16)
 * `role="option"` elements instead of 1000. The `<SourceRow>` absorbs
 * the `data-selectable-row` click contract and the checkbox pop
 * (per-interaction, not per-row).
 *
 * Semantics preserved from the non-virtualized implementation:
 * - Container: role="listbox", aria-multiselectable, aria-activedescendant
 * - Option ids: src-row-{chatPaperId} (anchored by useSourcesPanelKeyboard)
 * - aria-posinset / aria-setsize on every rendered row for SR navigation
 *   across the virtualized viewport.
 * - Keyboard nav follows the scroll via `scrollToIndex(activeIndex, 'auto')`
 *   so the focused option is always mounted + visible.
 */
export function SourcesPanelList({
  jobId,
  rows,
  matches,
  query,
  activeDescendantId,
  emptyState,
}: SourcesPanelListProps) {
  const t = useTranslations("sourcesPanel");
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const lastIndexRef = useRef<number | null>(null);

  const toggleChatPaper = useMutation(
    api.chat.chatPapers.toggleChatPaper,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
    );
    if (!current) return;
    localStore.setQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
      applyInclusionPatch(
        current,
        new Map([[args.chatPaperId, args.included]]),
      ),
    );
  });

  const bulkSetChatPapers = useMutation(
    api.chat.chatPapers.bulkSetChatPapers,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
    );
    if (!current) return;
    const patch = buildBulkPatch(current, args.sourceIds, args.included);
    localStore.setQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
      applyInclusionPatch(current, patch),
    );
  });

  const handleSingleToggle = useCallback(
    (row: ChatSourceRow) => {
      void toggleChatPaper({
        chatPaperId: row.chatPaperId,
        included: !row.included,
      });
    },
    [toggleChatPaper],
  );

  const handleRangeToggle = useCallback(
    (fromIndex: number, toIndex: number, targetIncluded: boolean) => {
      const [from, to] =
        fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
      const batch = rows
        .slice(from, to + 1)
        .filter((r) => r.included !== targetIncluded);
      if (batch.length === 0) return;
      void bulkSetChatPapers({
        jobId,
        sourceIds: batch.map((r) => r.sourceId),
        included: targetIncluded,
      });
    },
    [bulkSetChatPapers, jobId, rows],
  );

  const handleRowActivate = useCallback(
    (index: number, shiftKey: boolean) => {
      const current = rows[index];
      if (!current) return;
      const last = lastIndexRef.current;
      if (shiftKey && last !== null && last !== index) {
        handleRangeToggle(last, index, !current.included);
      } else {
        handleSingleToggle(current);
      }
      lastIndexRef.current = index;
    },
    [handleRangeToggle, handleSingleToggle, rows],
  );

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: OVERSCAN,
    getItemKey: (index) => rows[index]!.chatPaperId,
  });

  const activeIndex = useMemo(() => {
    if (!activeDescendantId) return -1;
    return rows.findIndex(
      (r) => `src-row-${r.chatPaperId}` === activeDescendantId,
    );
  }, [rows, activeDescendantId]);

  useEffect(() => {
    if (activeIndex < 0) return;
    rowVirtualizer.scrollToIndex(activeIndex, { align: "auto" });
  }, [activeIndex, rowVirtualizer]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const el = scrollParentRef.current;
    if (el && el.clientHeight === 0 && rows.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "SourcesPanelList: scroll parent has clientHeight 0 — virtualization requires a bounded parent height.",
      );
    }
  }, [rows.length]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  if (rows.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div
      ref={scrollParentRef}
      role="listbox"
      aria-multiselectable="true"
      aria-label={t("listLabel")}
      aria-activedescendant={activeDescendantId ?? undefined}
      data-sources-panel-list
      data-virtualized="true"
      data-visible-rows={virtualItems.length}
      data-total-rows={rows.length}
      className="relative h-full w-full overflow-auto"
    >
      <div
        style={{
          height: `${totalSize}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index]!;
          const match = matches.get(row.chatPaperId);
          const activeDescendant =
            `src-row-${row.chatPaperId}` === activeDescendantId;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <SourceRow
                row={row}
                match={match}
                query={query}
                isActiveDescendant={activeDescendant}
                posInSet={virtualItem.index + 1}
                setSize={rows.length}
                onActivate={(shiftKey) =>
                  handleRowActivate(virtualItem.index, shiftKey)
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
