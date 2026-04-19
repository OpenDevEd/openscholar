"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";

interface UseSourcesPanelKeyboardArgs {
  visibleRows: ChatSourceRow[];
  onToggleOne: (row: ChatSourceRow, next: boolean) => void;
  onToggleRange: (rows: ChatSourceRow[], next: boolean) => void;
  onIncludeAllVisible: () => void;
  onInvertVisible: () => void;
  onClearSearch: () => void;
  hasSearchQuery: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

interface UseSourcesPanelKeyboardResult {
  activeIndex: number | null;
  activeId: string | null;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  setActiveIndex: (index: number | null) => void;
}

/**
 * Composite listbox keyboard handler implementing WAI-ARIA APG patterns
 * for multi-select listbox with `aria-activedescendant`. Single tab stop
 * at the listbox container; arrow keys move the visible focus ring;
 * Space toggles; ⌘A includes-all-visible; Shift+⌘A inverts; / focuses
 * the search input; Esc clears search or releases focus.
 */
export function useSourcesPanelKeyboard({
  visibleRows,
  onToggleOne,
  onToggleRange,
  onIncludeAllVisible,
  onInvertVisible,
  onClearSearch,
  hasSearchQuery,
  searchInputRef,
}: UseSourcesPanelKeyboardArgs): UseSourcesPanelKeyboardResult {
  const [activeIndex, setActiveIndex] = useState<number | null>(
    visibleRows.length > 0 ? 0 : null,
  );
  const lastShiftAnchorRef = useRef<number | null>(null);

  const clampIndex = useCallback(
    (raw: number): number => {
      if (visibleRows.length === 0) return 0;
      if (raw < 0) return 0;
      if (raw >= visibleRows.length) return visibleRows.length - 1;
      return raw;
    },
    [visibleRows.length],
  );

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      // Defer to the search input when it owns focus (avoids hijacking
      // typing keys). Only / and Esc participate while the search has focus.
      const isSearchFocused = document.activeElement === searchInputRef.current;
      if (event.key === "/" && !isSearchFocused) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (isSearchFocused && hasSearchQuery) {
          event.preventDefault();
          onClearSearch();
          return;
        }
        if (!isSearchFocused) {
          event.preventDefault();
          setActiveIndex(null);
          return;
        }
      }
      if (isSearchFocused) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = clampIndex((activeIndex ?? -1) + 1);
        setActiveIndex(next);
        if (event.shiftKey) {
          const target = visibleRows[next];
          if (target) onToggleOne(target, !target.included);
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const next = clampIndex((activeIndex ?? visibleRows.length) - 1);
        setActiveIndex(next);
        if (event.shiftKey) {
          const target = visibleRows[next];
          if (target) onToggleOne(target, !target.included);
        }
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (activeIndex === null) return;
        const target = visibleRows[activeIndex];
        if (!target) return;
        if (event.shiftKey && lastShiftAnchorRef.current !== null) {
          const [from, to] =
            lastShiftAnchorRef.current < activeIndex
              ? [lastShiftAnchorRef.current, activeIndex]
              : [activeIndex, lastShiftAnchorRef.current];
          const target_state = !target.included;
          const batch = visibleRows
            .slice(from, to + 1)
            .filter((row) => row.included !== target_state);
          if (batch.length > 0) onToggleRange(batch, target_state);
        } else {
          onToggleOne(target, !target.included);
        }
        lastShiftAnchorRef.current = activeIndex;
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (event.shiftKey) onInvertVisible();
        else onIncludeAllVisible();
        return;
      }
    },
    [
      activeIndex,
      clampIndex,
      hasSearchQuery,
      onClearSearch,
      onIncludeAllVisible,
      onInvertVisible,
      onToggleOne,
      onToggleRange,
      searchInputRef,
      visibleRows,
    ],
  );

  const activeId =
    activeIndex !== null && visibleRows[activeIndex]
      ? `src-row-${visibleRows[activeIndex].chatPaperId}`
      : null;

  return { activeIndex, activeId, onKeyDown, setActiveIndex };
}
