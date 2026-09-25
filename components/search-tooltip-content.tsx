"use client";

/**
 * Search Tooltip Content
 * Minimal, sidebar-aligned tooltip for search items
 * Uses FilterChips and QueryEvolution for consistent display
 */

import React from "react";
import { QueryHistoryEntry } from "@/lib/types/search.types";
import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";
import { FilterChips } from "@/components/ui/filter-display";
import type { FilterParams } from "@/lib/filters";
import { QueryEvolution } from "@/components/ui/query-evolution";
import { QueryText } from "@/components/ui/query-text";
import { useLocale, useFormatter, useNow } from "next-intl";

interface SearchTooltipContentProps {
  id: string;
  query: string;
  count: number;
  createdAt: string;
  updatedAt: string;
  filters: FilterParams;
  queryHistory?: QueryHistoryEntry[];
  // Note: questionHistory and screening props removed - not shown in tooltip
}

export function SearchTooltipContent({
  id,
  query,
  count,
  createdAt,
  filters,
  queryHistory,
}: SearchTooltipContentProps) {
  const locale = useLocale();
  const format = useFormatter();
  const now = useNow();
  const timeAgo = format.relativeTime(new Date(createdAt), now);

  return (
    <div className="space-y-2.5">
      {/* Header: Query + Count */}
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <QueryText 
            query={query}
            className="text-sm font-medium break-words flex-1 leading-snug"
          />
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium shrink-0">
            {format.number(count, count >= 1000 ? { notation: 'compact', maximumFractionDigits: 1 } : undefined)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
          <Clock className="h-2.5 w-2.5" />
          <span>{timeAgo}</span>
        </div>
      </div>

      {/* Filters: Inline muted badges */}
      <FilterChips filters={filters} size="compact" />

      {/* Query Evolution: Expandable mini-list */}
      {queryHistory && queryHistory.length > 1 && (
        <QueryEvolution
          queryHistory={queryHistory}
          currentQuery={query}
        />
      )}
    </div>
  );
}
