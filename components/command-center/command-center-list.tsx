"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SearchX } from "lucide-react";
import { ListEmpty } from "@/components/evidence-libraries/list-controls";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GRID_CLASSES } from "@/lib/constants/view-modes";
import type { ViewMode } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

interface CommandCenterListProps<T> {
  items: T[];
  viewMode: ViewMode;
  /** Use ItemComponent for proper reconciliation; renderItem is legacy */
  renderItem?: (item: T, index: number) => React.ReactNode;
  ItemComponent?: React.ComponentType<{ item: T; index: number }>;
  keyExtractor: (item: T) => string;
  // Empty state
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: React.ReactNode;
  // Filter state
  hasFilter: boolean;
  onClearFilter: () => void;
}

/**
 * Shared list component for command centers.
 * Handles grid layout based on view mode and empty state rendering.
 */
export function CommandCenterList<T>({
  items,
  viewMode,
  renderItem,
  ItemComponent,
  keyExtractor,
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  hasFilter,
  onClearFilter,
}: CommandCenterListProps<T>) {
  const tc = useTranslations("common");
  // Empty state
  if (items.length === 0) {
    return (
      <ListEmpty
        icon={hasFilter ? SearchX : EmptyIcon}
        description={hasFilter ? tc("tryAdjustingSearch") : emptyDescription}
        action={hasFilter ? (
          <Button variant="outline" size="sm" onClick={onClearFilter}>
            {tc("clearFilter")}
          </Button>
        ) : emptyAction}
      >
        {hasFilter ? tc("noMatchesFound") : emptyTitle}
      </ListEmpty>
    );
  }

  return (
    <div className={cn(GRID_CLASSES[viewMode])}>
      {items.map((item, index) => (
        <React.Fragment key={keyExtractor(item)}>
          {ItemComponent ? (
            <ItemComponent item={item} index={index} />
          ) : (
            renderItem!(item, index)
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
