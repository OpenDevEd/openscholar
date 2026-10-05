"use client";

/**
 * Search Tooltip Content
 * Minimal, sidebar-aligned tooltip for search items
 * Uses FilterChips and QueryEvolution for consistent display
 */

import React, { type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SearchResult } from "@/lib/types/search.types";
import { cn } from "@/lib/utils";
import { Clock } from "@/components/icons";
import { FilterChips } from "@/components/ui/filter-display";
import type { FilterParams } from "@/lib/filters";
import { QueryEvolution } from "@/components/ui/query-evolution";
import { QueryText } from "@/components/ui/query-text";
import { useLocale, useFormatter, useNow } from "next-intl";
import { useSearchHistoryEntries } from "@/lib/research/history";

interface SearchTooltipContentProps {
  id: string;
  query: string;
  /** How many papers it matches; left out when that isn't known. */
  count?: number;
  createdAt: string;
  updatedAt: string;
  filters: FilterParams;
  /** The search, whose query history the tooltip shows; read when the tooltip opens. */
  search?: SearchResult;
}

export function SearchTooltipContent({
  id,
  query,
  count,
  createdAt,
  filters,
  search,
}: SearchTooltipContentProps) {
  const history = useSearchHistoryEntries(search, "query");
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
            className="text-sm font-medium break-words flex-1 leading-snug line-clamp-6 [overflow-wrap:anywhere]"
          />
          {count === undefined ? null : (
            <span className="text-3xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium shrink-0">
              {format.number(count, count >= 1000 ? { notation: 'compact', maximumFractionDigits: 1 } : undefined)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-3xs text-muted-foreground/70">
          <Clock className="h-2.5 w-2.5" />
          <span>{timeAgo}</span>
        </div>
      </div>

      {/* Filters: Inline muted badges */}
      <FilterChips filters={filters} size="compact" />

      {/* Query Evolution: Expandable mini-list */}
      {(search?.queryHistoryCount ?? 0) > 1 && (
        <QueryEvolution
          queryHistory={history.entries}
          total={history.total}
          onLoadOlder={history.hasOlder ? history.loadOlder : undefined}
          currentQuery={query}
        />
      )}
    </div>
  );
}

/**
 * A search's card on hover, beside what it's about: its query, count, age and filters. The
 * sidebar's history shows one to the right of each search, and the assistant's steps one to
 * the left of each query they looked up, out over the page.
 */
export function SearchHoverCard({ children, side, delay, ...search }: SearchTooltipContentProps & { children: ReactElement; side: "left" | "right"; delay: number }) {
  return (
    <Tooltip delayDuration={delay}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="w-80 bg-background text-foreground border shadow-lg p-0 max-h-96 overflow-y-auto" arrowClassName="bg-background fill-background">
        <div className="p-3">
          <SearchTooltipContent {...search} />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
