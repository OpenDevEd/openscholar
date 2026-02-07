"use client";

import { useCallback, Dispatch, SetStateAction } from "react";
import {
  Table2,
  LayoutGrid,
  PanelLeft,
  ArrowUpDown,
  ChevronDown,
  Download,
} from "lucide-react";
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

const RESULTS_VIEW_OPTIONS = [
  { mode: "table" as const, icon: Table2, label: "Table" },
  { mode: "cards" as const, icon: LayoutGrid, label: "Cards" },
  { mode: "split" as const, icon: PanelLeft, label: "Split" },
];

export type ResultsSortBy =
  | "default"
  | "title-asc"
  | "title-desc"
  | "confidence-high"
  | "confidence-low";

const SORT_OPTIONS: { value: ResultsSortBy; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "title-asc", label: "Title A-Z" },
  { value: "title-desc", label: "Title Z-A" },
  { value: "confidence-high", label: "Confidence High-Low" },
  { value: "confidence-low", label: "Confidence Low-High" },
];

interface ResultsToolbarProps {
  filters: FilterState;
  onFiltersChange: Dispatch<SetStateAction<FilterState>>;
  viewMode: "table" | "cards" | "split";
  onViewModeChange: (mode: "table" | "cards" | "split") => void;
  totalCount: number;
  filteredCount: number;
  questions: Question[];
  sortBy: ResultsSortBy;
  onSortChange: (sort: ResultsSortBy) => void;
  onExportAll: () => void;
}

export function ResultsToolbar({
  filters,
  onFiltersChange,
  viewMode,
  onViewModeChange,
  totalCount,
  filteredCount,
  questions,
  sortBy,
  onSortChange,
  onExportAll,
}: ResultsToolbarProps) {
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
    <div className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm border-b rounded-xl mb-6">
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
          value={filters.searchQuery}
          onChange={handleSearchChange}
          placeholder="Search papers, answers, citations..."
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

          {/* Export button */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={onExportAll}
            disabled={filteredCount === 0}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
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
          {filteredCount} of {totalCount} papers
        </Badge>
      </div>
    </div>
  );
}
