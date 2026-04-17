"use client";

import { useRef, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface SelectableListProps<T> {
  items: T[];
  isSelected: (t: T) => boolean;
  onToggle: (t: T, mods?: { shift?: boolean }) => void;
  onToggleAll: () => void;
  renderRow: (t: T) => ReactNode;
  keyOf: (t: T) => string;
  className?: string;
  headerLabel?: ReactNode;
  emptyState?: ReactNode;
}

export function SelectableList<T>({
  items,
  isSelected,
  onToggle,
  onToggleAll,
  renderRow,
  keyOf,
  className,
  headerLabel,
  emptyState,
}: SelectableListProps<T>) {
  const lastIndexRef = useRef<number | null>(null);

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
    const shift = Boolean(event.shiftKey);
    const last = lastIndexRef.current;
    if (shift && last !== null && last !== index) {
      const [from, to] = last < index ? [last, index] : [index, last];
      // Target state: the opposite of the current item's state (same as a
      // plain click would produce). Only toggle items that don't already
      // match the target, so re-entry into an existing selection doesn't
      // flip rows off unexpectedly.
      const target = !isSelected(current);
      for (let i = from; i <= to; i++) {
        const item = items[i];
        if (!item) continue;
        if (isSelected(item) !== target) onToggle(item, { shift: true });
      }
    } else {
      onToggle(current);
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
        className="flex items-center gap-3 p-3 bg-muted/50 text-xs font-medium text-muted-foreground"
        data-selectable-header
      >
        <Checkbox
          aria-label="Select all visible"
          checked={headerChecked}
          onCheckedChange={() => onToggleAll()}
        />
        {headerLabel ?? (
          <span>
            {selectedCount > 0
              ? `${selectedCount} selected`
              : `${total} item${total === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      {items.map((item, index) => {
        const selected = isSelected(item);
        const key = keyOf(item);
        return (
          <div
            key={key}
            data-selectable-row
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            onClick={(e) => handleRowActivate(index, { shiftKey: e.shiftKey })}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                handleRowActivate(index, { shiftKey: e.shiftKey });
              }
            }}
            className={cn(
              "cursor-pointer transition-colors duration-150 p-4 flex items-start gap-3 outline-none",
              index % 2 === 0 ? "bg-background" : "bg-muted/30",
              selected
                ? "bg-primary/5 border-l-4 border-l-primary"
                : "hover:bg-muted/50 border-l-4 border-l-transparent",
              "focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <div className="mt-0.5">
              <Checkbox
                checked={selected}
                tabIndex={-1}
                onCheckedChange={() => {
                  onToggle(item);
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
