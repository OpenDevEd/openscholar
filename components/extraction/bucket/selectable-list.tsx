"use client";

import { useRef, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Loader2 } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface SelectableListProps<T> {
  items: T[];
  isSelected: (t: T) => boolean;
  isDisabled?: (t: T) => boolean;
  onToggle: (t: T, next: boolean) => void;
  /**
   * Optional batch handler for shift-click ranges. When defined, a
   * shift-range collects every item that needs to change state and
   * issues a single call — one store write instead of N — which avoids
   * flooding Zustand subscribers with N re-renders inside one user
   * interaction. Fall back to N `onToggle` calls when undefined.
   */
  onToggleRange?: (items: T[], next: boolean) => void;
  /**
   * Header "select all / deselect all" handler. Optional: when
   * omitted, the header checkbox is not rendered (e.g. the History
   * tab staging a mass-select is unnecessary and the full-list
   * behaviour risks blowing past caps). Shift-click ranges still work
   * via `onToggleRange`.
   */
  onToggleAll?: (next: boolean) => void;
  /**
   * Optional "select everything that matches across pages" hook. When
   * defined AND the current page is fully selected AND `hasMore` is
   * true, the list renders a banner offering to stage every matching
   * item server-wide. The handler is responsible for fetching and
   * staging; SelectableList only drives its disabled/loading state.
   */
  onSelectAllAcross?: () => Promise<void> | void;
  /**
   * Optional cancel hook for `onSelectAllAcross`. Zotero fetches pages
   * sequentially (cursor-paginated API), so mass-select can take a few
   * seconds. When provided, the banner swaps "Staging…" for a Cancel
   * link that signals the handler to stop. Library/Collections fetch
   * everything in one request and don't need this.
   */
  onCancelSelectAllAcross?: () => void;
  hasMore?: boolean;
  renderRow: (t: T) => ReactNode;
  keyOf: (t: T) => string;
  className?: string;
  headerLabel?: ReactNode;
  emptyState?: ReactNode;
  /**
   * Row ARIA role.
   *
   * - "button" (default): each row is a focusable role="button" with
   *   aria-pressed and tabindex=0. Right semantic for the bucket flow,
   *   where each row is a discrete actionable target with its own tab
   *   stop.
   * - "option": each row becomes a non-focusable role="option" with
   *   aria-selected. Right semantic for a WAI-ARIA APG listbox where
   *   the parent container is the single tab stop and manages focus
   *   via aria-activedescendant. Avoids the nested-interactive axe
   *   violation that role="button"+focusable inner controls would
   *   otherwise raise.
   */
  rowAs?: "button" | "option";
}

export function SelectableList<T>({
  items,
  isSelected,
  isDisabled,
  onToggle,
  onToggleRange,
  onToggleAll,
  onSelectAllAcross,
  onCancelSelectAllAcross,
  hasMore,
  renderRow,
  keyOf,
  className,
  headerLabel,
  emptyState,
  rowAs = "button",
}: SelectableListProps<T>) {
  const lastIndexRef = useRef<number | null>(null);
  const [selectingAllAcross, setSelectingAllAcross] = useState(false);

  const total = items.length;
  const selectedCount = items.reduce(
    (n, item) => n + (isSelected(item) ? 1 : 0),
    0,
  );

  const headerChecked: boolean | "indeterminate" =
    total === 0
      ? false
      : selectedCount === total
        ? true
        : selectedCount === 0
          ? false
          : "indeterminate";

  const handleRowActivate = (index: number, event: {
    shiftKey?: boolean;
  }) => {
    const current = items[index];
    if (!current) return;
    if (isDisabled?.(current)) return;
    const shift = Boolean(event.shiftKey);
    const last = lastIndexRef.current;
    if (shift && last !== null && last !== index) {
      const [from, to] = last < index ? [last, index] : [index, last];
      // Target state: the opposite of the current item's state (same as a
      // plain click would produce). Only toggle items that don't already
      // match the target, so re-entry into an existing selection doesn't
      // flip rows off unexpectedly.
      const target = !isSelected(current);
      if (onToggleRange) {
        const batch: T[] = [];
        for (let i = from; i <= to; i++) {
          const item = items[i];
          if (!item) continue;
          if (!isDisabled?.(item) && isSelected(item) !== target) batch.push(item);
        }
        if (batch.length > 0) onToggleRange(batch, target);
      } else {
        for (let i = from; i <= to; i++) {
          const item = items[i];
          if (!item) continue;
          if (!isDisabled?.(item) && isSelected(item) !== target) onToggle(item, target);
        }
      }
    } else {
      onToggle(current, !isSelected(current));
    }
    lastIndexRef.current = index;
  };

  if (total === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>;
  }

  return (
    <div
      className={cn(
        "divide-y divide-border border border-border rounded-xl overflow-hidden",
        className,
      )}
    >
      <div
        className="flex items-center gap-3 p-3 bg-inset text-xs font-medium text-muted-foreground"
        data-selectable-header
      >
        {onToggleAll && (
          <Checkbox
            aria-label="Select all visible"
            checked={headerChecked}
            onCheckedChange={() => onToggleAll(headerChecked !== true)}
          />
        )}
        {headerLabel ?? (
          <span>
            {selectedCount > 0
              ? `${selectedCount} selected`
              : `${total} item${total === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      {onSelectAllAcross && hasMore && headerChecked === true && (
        <div
          className="flex items-center justify-between gap-3 p-3 bg-primary/5 text-xs"
          data-selectable-all-across
        >
          <span className="text-muted-foreground">
            All {total} items on this page are selected.
          </span>
          <div className="flex items-center gap-3">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-medium"
              disabled={selectingAllAcross}
              onClick={() => {
                setSelectingAllAcross(true);
                Promise.resolve(onSelectAllAcross()).finally(() =>
                  setSelectingAllAcross(false),
                );
              }}
            >
              {selectingAllAcross ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Staging…
                </>
              ) : (
                <>Select everything that matches →</>
              )}
            </Button>
            {selectingAllAcross && onCancelSelectAllAcross && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs text-muted-foreground"
                onClick={onCancelSelectAllAcross}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
      {items.map((item, index) => {
        const selected = isSelected(item);
        const disabled = isDisabled?.(item) ?? false;
        const key = keyOf(item);
        return (
          <div
            key={key}
            data-selectable-row
            // In option mode the inner renderRow owns the role="option"
            // semantics (id + aria-selected), and this outer wrapper is
            // a non-interactive click target — that avoids the
            // nested-interactive axe violation that role="button"+
            // focusable inner controls (Checkbox, anchors) would raise.
            {...(rowAs === "button"
              ? { role: "button", tabIndex: 0, "aria-pressed": selected, "aria-disabled": disabled }
              : {})}
            onClick={(e) => handleRowActivate(index, { shiftKey: e.shiftKey })}
            onKeyDown={(e) => {
              if (rowAs === "option") return;
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                handleRowActivate(index, { shiftKey: e.shiftKey });
              }
            }}
            className={cn(
              "cursor-pointer transition-colors duration-150 p-4 flex items-start gap-3 outline-none",
              index % 2 === 0 ? "bg-background" : "bg-inset",
              selected
                ? "bg-primary/5 border-l-4 border-l-primary"
                : "hover:bg-muted border-l-4 border-l-transparent",
              "focus-visible:ring-2 focus-visible:ring-ring",
              disabled && "cursor-default opacity-60",
            )}
          >
            <div className="mt-0.5">
              <Checkbox
                checked={selected}
                disabled={disabled}
                tabIndex={-1}
                onCheckedChange={() => {
                  onToggle(item, !selected);
                  lastIndexRef.current = index;
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="flex-1 min-w-0">{renderRow(item)}</div>
          </div>
        );
      })}
    </div>
  );
}
