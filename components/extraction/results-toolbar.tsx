"use client";

import { useCallback, useMemo, Dispatch, SetStateAction } from "react";
import {
  Table2,
  LayoutGrid,
  PanelLeft,
  ArrowUpDown,
  ChevronDown,
  Download,
  Columns3,
  Check,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchInput } from "./search-input";
import { ConfidenceFilter } from "./confidence-filter";
import { StatusFilter } from "./status-filter";
import { cn } from "@/lib/utils";
import type { FilterState, Question } from "@/lib/extraction/filtering";

export type ResultsSortBy =
  | "default"
  | "title-asc"
  | "title-desc"
  | "confidence-high"
  | "confidence-low";

interface ResultsToolbarProps {
  filters: FilterState;
  searchQueryResetKey?: number;
  onFiltersChange: Dispatch<SetStateAction<FilterState>>;
  viewMode: "table" | "cards" | "split";
  onViewModeChange: (mode: "table" | "cards" | "split") => void;
  totalCount: number;
  filteredCount: number;
  questions: Question[];
  sortBy: ResultsSortBy;
  onSortChange: (sort: ResultsSortBy) => void;
  onExportAll: () => void;
  /** Plan-04: Credits column visibility toggle (table view only). */
  showCredits: boolean;
  onShowCreditsChange: (next: boolean) => void;
}

export function ResultsToolbar({
  filters,
  searchQueryResetKey = 0,
  onFiltersChange,
  viewMode,
  onViewModeChange,
  totalCount,
  filteredCount,
  questions,
  sortBy,
  onSortChange,
  onExportAll,
  showCredits,
  onShowCreditsChange,
}: ResultsToolbarProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");

  const RESULTS_VIEW_OPTIONS = useMemo(() => [
    { mode: "table" as const, icon: Table2, label: tc("table") },
    { mode: "cards" as const, icon: LayoutGrid, label: tc("cards") },
    { mode: "split" as const, icon: PanelLeft, label: tc("split") },
  ], [tc]);

  const SORT_OPTIONS: { value: ResultsSortBy; label: string }[] = useMemo(() => [
    { value: "default", label: tc("defaultSort") },
    { value: "title-asc", label: tc("aToZ") },
    { value: "title-desc", label: tc("zToA") },
    { value: "confidence-high", label: t("confidenceHighLow") },
    { value: "confidence-low", label: t("confidenceLowHigh") },
  ], [t, tc]);

  const handleSearchChange = useCallback(
    (q: string) => {
      onFiltersChange((prev) => ({ ...prev, searchQuery: q }));
    },
    [onFiltersChange]
  );

  const handleConfidenceChange = useCallback(
    (r: [number, number]) => {
      onFiltersChange((prev) => ({ ...prev, confidenceRange: r }));
    },
    [onFiltersChange]
  );

  const handleStatusChange = useCallback(
    (s: Set<string>) => {
      onFiltersChange((prev) => ({ ...prev, statusFilters: s }));
    },
    [onFiltersChange]
  );

  const currentSortOption = SORT_OPTIONS.find((o) => o.value === sortBy);

  return (
    <div className="sticky top-0 z-20 mb-6 rounded-xl border-b bg-card/95">
      {/* Top row: View toggle + Search + Sort + Export */}
      <div className="flex flex-col sm:flex-row gap-3 p-4">
        {/* View mode toggle - icon-only matching shared toolbar */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-0.5 p-0.5 bg-muted/50 dark:bg-muted/30 rounded-lg border border-border/60">
            {RESULTS_VIEW_OPTIONS.map((option) => {
              const isActive = viewMode === option.mode;
              const Icon = option.icon;
              return (
                <button
                  key={option.mode}
                  onClick={() => onViewModeChange(option.mode)}
                  className={cn(
                    "relative z-10 flex items-center justify-center p-1.5 rounded-md transition-colors",
                    isActive
                      ? "text-primary bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  )}
                  title={option.label}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <SearchInput
          key={searchQueryResetKey}
          value={filters.searchQuery}
          onChange={handleSearchChange}
          placeholder={t("searchPapersPlaceholder")}
        />

        {/* Sort dropdown */}
        <div className="flex items-center gap-2 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {currentSortOption?.label}
                </span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SORT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => onSortChange(option.value)}
                  className={cn(sortBy === option.value && "bg-muted")}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Columns dropdown — table view only */}
          {viewMode === "table" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
                  aria-label={tc("columns")}
                >
                  <Columns3 className="h-3.5 w-3.5" />
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onShowCreditsChange(!showCredits);
                  }}
                  data-column-toggle="credits"
                  data-column-visible={showCredits ? "true" : "false"}
                  className="gap-2"
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5",
                      showCredits ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {tc("credits")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Export button */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={onExportAll}
            disabled={filteredCount === 0}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tc("export")}</span>
          </Button>
        </div>
      </div>

      {/* Bottom row: Filters + count */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
        <ConfidenceFilter
          range={filters.confidenceRange}
          onChange={handleConfidenceChange}
        />
        <StatusFilter
          selected={filters.statusFilters}
          onChange={handleStatusChange}
        />
        <Badge variant="outline" className="ml-auto">
          {t("filteredOfTotal", { filtered: filteredCount, total: totalCount })}
        </Badge>
      </div>
    </div>
  );
}
