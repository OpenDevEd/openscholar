"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export interface UseTransactionsKeyboardOpts {
  rows: readonly { id: string }[];
  listRef: RefObject<HTMLElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  onActivateRow: (rowId: string) => void;
  onClearSearch: () => void;
  onOpenExport: () => void;
  isDrawerOpen: boolean;
  onCloseDrawer: () => void;
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform ?? navigator.platform;
  return /mac/i.test(platform);
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  return target.isContentEditable;
}

export function useTransactionsKeyboard(opts: UseTransactionsKeyboardOpts) {
  const {
    rows,
    listRef,
    searchRef,
    onActivateRow,
    onClearSearch,
    onOpenExport,
    isDrawerOpen,
    onCloseDrawer,
  } = opts;

  const [activeId, setActiveId] = useState<string | null>(null);

  // Hold the latest of everything the handler needs so we can keep the
  // effect registration dep-free (one listener for the whole component
  // lifetime — no re-registration churn on row updates).
  const stateRef = useRef({
    rows,
    activeId,
    onActivateRow,
    onClearSearch,
    onOpenExport,
    isDrawerOpen,
    onCloseDrawer,
  });
  stateRef.current = {
    rows,
    activeId,
    onActivateRow,
    onClearSearch,
    onOpenExport,
    isDrawerOpen,
    onCloseDrawer,
  };

  // Reset active descendant when rows change (filter / sort / pagination).
  useEffect(() => {
    if (activeId && !rows.some((r) => r.id === activeId)) {
      setActiveId(null);
    }
  }, [rows, activeId]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const current = stateRef.current;
      const target = e.target;

      if (isTextInputTarget(target)) {
        if (e.key === "Escape") {
          const input = target as HTMLInputElement;
          if (input.value) {
            e.preventDefault();
            current.onClearSearch();
          } else {
            input.blur();
          }
        }
        return;
      }

      const modifier = isMacPlatform() ? e.metaKey : e.ctrlKey;
      if (modifier && e.key.toLowerCase() === "e") {
        e.preventDefault();
        current.onOpenExport();
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (e.key === "Escape" && current.isDrawerOpen) {
        e.preventDefault();
        current.onCloseDrawer();
        return;
      }

      const list = listRef.current;
      if (!list || !(target instanceof Node) || !list.contains(target)) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const index = current.activeId
          ? current.rows.findIndex((r) => r.id === current.activeId)
          : -1;
        const next = Math.min(index + 1, current.rows.length - 1);
        const row = current.rows[next];
        if (row) {
          setActiveId(row.id);
          document
            .getElementById(`txn-row-${row.id}`)
            ?.scrollIntoView({ block: "nearest" });
        }
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        const index = current.activeId
          ? current.rows.findIndex((r) => r.id === current.activeId)
          : 0;
        const next = Math.max(index - 1, 0);
        const row = current.rows[next];
        if (row) {
          setActiveId(row.id);
          document
            .getElementById(`txn-row-${row.id}`)
            ?.scrollIntoView({ block: "nearest" });
        }
        return;
      }

      if (e.key === "Enter" && current.activeId) {
        e.preventDefault();
        current.onActivateRow(current.activeId);
      }
    },
    [listRef, searchRef],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  return { activeId, setActiveId };
}
