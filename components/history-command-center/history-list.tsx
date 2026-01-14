"use client";

import React from "react";
import { motion } from "framer-motion";
import { Clock, Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ViewMode } from "@/lib/store";
import { HistoryItem } from "./history-item";
import { subtleSpring } from "./index";
import type { SearchResult } from "@/lib/types";
import Link from "next/link";

interface HistoryListProps {
  items: SearchResult[];
  viewMode: ViewMode;
  onSearchClick: (item: SearchResult) => void;
  hasFilter: boolean;
  onClearFilter: () => void;
}

export function HistoryList({
  items,
  viewMode,
  onSearchClick,
  hasFilter,
  onClearFilter,
}: HistoryListProps) {
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
            <Clock className="h-7 w-7 text-muted-foreground" />
          )}
        </div>

        <h3 className="text-lg font-semibold text-foreground mb-2">
          {hasFilter ? "No matches found" : "No search history yet"}
        </h3>

        <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
          {hasFilter
            ? "Try adjusting your search filter to find what you're looking for."
            : "Start searching for academic papers and your search history will appear here."}
        </p>

        {hasFilter ? (
          <Button variant="outline" onClick={onClearFilter} className="gap-2">
            Clear Filter
          </Button>
        ) : (
          <Button asChild className="gap-2">
            <Link href="/">
              <Search className="h-4 w-4" />
              Start a Search
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </motion.div>
    );
  }

  // Grid layout classes based on view mode
  const gridClasses: Record<ViewMode, string> = {
    "list-simple": "flex flex-col gap-2",
    "list-detail": "flex flex-col gap-4",
    "grid-2": "grid grid-cols-1 md:grid-cols-2 gap-4",
    "grid-3": "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3",
  };

  return (
    <div className={cn(gridClasses[viewMode])}>
      {items.map((item, index) => (
        <HistoryItem
          key={item.id}
          item={item}
          index={index}
          viewMode={viewMode}
          onSearchClick={onSearchClick}
        />
      ))}
    </div>
  );
}
