"use client";

import React, { useState } from "react";
import { DateRange } from "react-day-picker";
import { useTranslations, useFormatter, useNow } from "next-intl";
import { History, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getIdColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SearchField } from "@/lib/types";
import { FilterChips } from "@/components/ui/filter-display";
import { languageOptions } from "@/components/language-selector";
import { QueryText } from "@/components/ui/query-text";
import {
  getFieldLabel,
  getSortLabel,
  hasActiveFiltersFromResult,
  type FilterT,
} from "@/lib/filters";
import { SearchHistoryBookmarkForm } from "@/components/search-history-bookmark-form";
import { SearchHistoryActionButtons } from "@/components/search-history-action-buttons";
import { QueryHistoryDisplay } from "@/components/search-history-query-display";

export interface SearchHistoryItemProps {
  result: {
    id: string;
    query: string;
    count: number;
    field?: SearchField;
    sortBy?: string;
    dateRange?: DateRange;
    yearRange?: [number, number];
    filterType?: "date" | "year";
    createdAt: string;
    language?: string;
    questionHistory?: { question: string }[];
    queryHistory?: { query: string; timestamp: string }[];
  };
  index: number;
  actualIndex: number;
  variant?: "compact" | "full";
  currentSearchId?: string;
  currentSearchField: SearchField;
  bookmarkingIndex: number | null;
  loadingResultIndex: number | null;
  onBookmarkClick: (index: number) => void;
  onBookmarkCancel: () => void;
  onCopyQuery: (query: string) => void;
  onDeleteItem: (index: number, query: string) => void;
  onQueryDelete: (searchId: string, queryIndex: number) => void;
  onSearchResults: (
    query: string,
    searchField: SearchField,
    dateRange?: DateRange,
    sortBy?: string,
    yearRange?: [number, number],
    filterType?: "date" | "year",
    index?: number
  ) => void;
  onQuerySelect?: (searchId: string, query: string) => void;
}

export function SearchHistoryItem({
  result,
  index: _index,
  actualIndex,
  variant = "compact",
  currentSearchId,
  currentSearchField,
  bookmarkingIndex,
  loadingResultIndex,
  onBookmarkClick,
  onBookmarkCancel,
  onCopyQuery,
  onDeleteItem,
  onQueryDelete,
  onSearchResults,
  onQuerySelect,
}: SearchHistoryItemProps) {
  const t = useTranslations();
  const tc = useTranslations("common");
  const ta = useTranslations("accessibility");
  const tl = useTranslations("languages");
  const tp = useTranslations("paperCard");
  const tFilters = useTranslations("searchFilters");
  const format = useFormatter();
  const now = useNow();

  const isCurrentSearch = currentSearchId && result.id === currentSearchId;
  const idColor = getIdColor(result.id);
  const [isQueryHistoryExpanded, setIsQueryHistoryExpanded] = useState(false);
  const queryHistoryCount = result.queryHistory?.length || 0;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border transition-all duration-200",
        isCurrentSearch
          ? "border-primary/50 bg-primary/5 shadow-md ring-1 ring-primary/20"
          : cn(
              "border-border/50 hover:border-border",
              variant === "compact"
                ? "bg-card/85 hover:bg-card/95 hover:shadow-md"
                : "bg-card/80 hover:bg-card/90 hover:shadow-lg"
            )
      )}
    >
      <div className={cn(variant === "compact" ? "p-4" : "p-5", !isQueryHistoryExpanded && "pb-2")}>
        {/* === HERO SECTION: Result Count + Info Rows === */}
        <div
          className={cn(
            "flex gap-3 items-stretch",
            variant === "compact" ? "flex-col sm:flex-row" : "flex-row"
          )}
        >
          {/* Result Count Block */}
          <div
            className={cn(
              "flex-shrink-0 rounded-lg flex flex-col items-center justify-center",
              variant === "compact" ? "px-3 py-2 min-w-[72px]" : "px-4 py-2 min-w-[88px]"
            )}
            style={{
              backgroundColor: idColor.bg,
              border: `1px solid ${idColor.border}`,
            }}
          >
            <div
              className={cn(
                "font-bold leading-none",
                variant === "compact" ? "text-lg" : "text-xl"
              )}
              style={{ color: idColor.text }}
            >
              {format.number(
                result.count,
                result.count >= 1000 ? { notation: "compact", maximumFractionDigits: 1 } : undefined
              )}
            </div>
            <div
              className="text-[10px] opacity-70 leading-none mt-0.5"
              style={{ color: idColor.text }}
            >
              {t("common.results").toLowerCase()}
            </div>
          </div>

          {/* Info Rows */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
            <p
              className={cn(
                "break-words leading-tight",
                variant === "compact" ? "text-sm font-medium" : "text-base font-semibold"
              )}
            >
              <QueryText query={result.query} />
            </p>

            {(result.questionHistory?.length ?? 0) > 0 && (
              <p
                className="text-xs text-muted-foreground leading-tight truncate"
                title={result.questionHistory?.[result.questionHistory.length - 1]?.question}
              >
                <span className="opacity-60">{tc("questionPrefix")}</span>{" "}
                {result.questionHistory?.[result.questionHistory.length - 1]?.question}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground leading-tight">
              <span>{format.relativeTime(new Date(result.createdAt), now)}</span>
              <span className="opacity-50">•</span>
              <span>{getFieldLabel(result.field, tFilters as FilterT)}</span>
              {result.sortBy && getSortLabel(result.sortBy, tFilters as FilterT) && (
                <>
                  <span className="opacity-50">•</span>
                  <span>{getSortLabel(result.sortBy, tFilters as FilterT)}</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-xs leading-tight">
              {result.language ? (
                (() => {
                  const lang = languageOptions.find((l) => l.code === result.language);
                  return lang ? (
                    <>
                      <img
                        src={lang.flagUrl}
                        alt={tl(lang.code as never) || lang.name}
                        className="w-4 h-3 rounded-sm object-cover shadow-sm border border-border/30"
                      />
                      <span className="text-foreground">{tl(lang.code as never) || lang.name}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Languages className="h-3 w-3" />
                      <span className="italic">{tp("languageNotSet")}</span>
                    </span>
                  );
                })()
              ) : (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Languages className="h-3 w-3" />
                  <span className="italic">{tp("languageNotSet")}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* === BOOKMARK FORM (inline, when active) === */}
        {bookmarkingIndex === actualIndex && (
          <div className="mt-4">
            <SearchHistoryBookmarkForm
              query={result.query}
              onSubmit={() => onBookmarkCancel()}
              onCancel={onBookmarkCancel}
              variant="full"
            />
          </div>
        )}

        {/* === FOOTER: Filters + History + Actions === */}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
          <div className="flex-1 overflow-x-auto scrollbar-hover">
            {hasActiveFiltersFromResult(result) && (
              <FilterChips filters={result} />
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {queryHistoryCount > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "text-muted-foreground hover:text-foreground gap-1",
                  variant === "compact" ? "h-7 px-2" : "h-8 px-2"
                )}
                onClick={() => setIsQueryHistoryExpanded(!isQueryHistoryExpanded)}
                title={ta("queryHistory")}
              >
                <History className={cn(variant === "compact" ? "h-3 w-3" : "h-3.5 w-3.5")} />
                <span className={cn(variant === "compact" ? "text-xs" : "text-xs")}>
                  {queryHistoryCount}
                </span>
              </Button>
            )}

            <SearchHistoryActionButtons
              query={result.query}
              searchId={result.id}
              index={actualIndex}
              variant={variant}
              isLoading={loadingResultIndex === actualIndex}
              canDelete={true}
              onCopy={onCopyQuery}
              onBookmark={onBookmarkClick}
              onSearch={(query) =>
                onSearchResults(
                  query,
                  result.field || currentSearchField,
                  result.dateRange,
                  result.sortBy,
                  result.yearRange,
                  result.filterType,
                  actualIndex
                )
              }
              onDelete={onDeleteItem}
            />
          </div>
        </div>

        {/* === EXPANDED QUERY HISTORY === */}
        {isQueryHistoryExpanded && queryHistoryCount > 1 && (
          <div className="mt-3">
            <QueryHistoryDisplay
              queryHistory={result.queryHistory ?? []}
              currentQuery={result.query}
              searchId={result.id}
              onQuerySelect={onQuerySelect}
              onCopyQuery={onCopyQuery}
              onDeleteQueryEntry={onQueryDelete}
              initiallyExpanded={true}
            />
          </div>
        )}
      </div>
    </div>
  );
}
