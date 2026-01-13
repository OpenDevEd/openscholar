"use client";

/**
 * Search Tooltip Content
 * Minimal, sidebar-aligned tooltip for search items
 * Uses UnifiedFilterBadges and QueryEvolution for consistent display
 */

import React from "react";
import { formatNumber, formatTimeAgo } from "@/lib/format";
import { SearchField, QueryHistoryEntry } from "@/lib/types/search.types";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";
import { UnifiedFilterBadges } from "@/components/ui/filter-display";
import { QueryEvolution } from "@/components/ui/query-evolution";
import { QueryText } from "@/components/ui/query-text";

interface SearchTooltipContentProps {
  id: string;
  query: string;
  count: number;
  createdAt: string;
  updatedAt: string;
  field?: SearchField;
  sortBy?: string;
  yearRange?: [number, number];
  dateRange?: DateRange;
  filterType?: "date" | "year";
  isYearRangeEnabled?: boolean;
  selectedRegions?: string[];
  selectedCountryFocus?: string[];
  language?: string;
  reviewFilter?: boolean;
  ratingRange?: [number, number];
  onlyRatedPapers?: boolean;
  citesItemId?: string;
  citedByItemId?: string;
  relatedToItemId?: string;
  queryHistory?: QueryHistoryEntry[];
  // Note: questionHistory and screening props removed - not shown in tooltip
}

export function SearchTooltipContent({
  id,
  query,
  count,
  createdAt,
  field,
  sortBy,
  yearRange,
  dateRange,
  filterType,
  isYearRangeEnabled,
  selectedRegions,
  selectedCountryFocus,
  language,
  reviewFilter,
  ratingRange,
  onlyRatedPapers,
  citesItemId,
  citedByItemId,
  relatedToItemId,
  queryHistory,
}: SearchTooltipContentProps) {
  const timeAgo = formatTimeAgo(createdAt);

  // Build filter params for UnifiedFilterBadges
  const filterParams = {
    field,
    sortBy,
    yearRange,
    dateRange,
    filterType,
    isYearRangeEnabled,
    selectedRegions,
    selectedCountryFocus,
    language,
    reviewFilter,
    ratingRange,
    onlyRatedPapers,
    citesItemId,
    citedByItemId,
    relatedToItemId,
  };

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
            {formatNumber(count)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
          <Clock className="h-2.5 w-2.5" />
          <span>{timeAgo}</span>
        </div>
      </div>

      {/* Filters: Inline muted badges */}
      <UnifiedFilterBadges
        result={filterParams}
        variant="sidebar"
        showAll={false}
      />

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
