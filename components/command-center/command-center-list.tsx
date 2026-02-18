"use client";

import React from "react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";
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
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={subtleSpring}
        className="flex flex-col items-center justify-center py-16 px-4"
      >
        <div
          className={cn(
            "w-16 h-16 rounded-2xl mb-6",
            "bg-gradient-to-br from-muted/80 to-muted/40",
            "flex items-center justify-center",
            "border border-border/50"
          )}
        >
          {hasFilter ? (
            <Search className="h-7 w-7 text-muted-foreground" />
          ) : (
            <EmptyIcon className="h-7 w-7 text-muted-foreground" />
          )}
        </div>

        <h3 className="text-lg font-semibold text-foreground mb-2">
          {hasFilter ? tc("noMatchesFound") : emptyTitle}
        </h3>

        <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
          {hasFilter
            ? tc("tryAdjustingSearch")
            : emptyDescription}
        </p>

        {hasFilter ? (
          <Button variant="outline" onClick={onClearFilter} className="gap-2">
            {tc("clearFilter")}
          </Button>
        ) : (
          emptyAction
        )}
      </motion.div>
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
