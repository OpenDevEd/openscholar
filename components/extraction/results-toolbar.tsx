"use client";

import { useCallback, useMemo, Dispatch, SetStateAction } from "react";
import {
  Table2,
  LayoutGrid,
  PanelLeft,
  ArrowUpDown,
  Download,
  Columns3,
  Check,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LIST_FILTER } from "@/components/evidence-libraries/list-controls";
import { IconSwitch } from "@/components/view-mode-toggle";
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
  const ta = useTranslations("accessibility");
  const tl = useTranslations("libraryPage");

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

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-3 md:px-6">
      <IconSwitch
        label={ta("viewOptions")}
        value={viewMode}
        onChange={onViewModeChange}
        options={RESULTS_VIEW_OPTIONS.map(({ mode, icon, label }) => ({ value: mode, icon, label }))}
      />
      <SearchInput
        key={searchQueryResetKey}
        value={filters.searchQuery}
        onChange={handleSearchChange}
        placeholder={t("searchPapersPlaceholder")}
        className="order-first w-full sm:order-none sm:w-auto sm:min-w-48 sm:flex-1"
      />
      <ConfidenceFilter range={filters.confidenceRange} onChange={handleConfidenceChange} />
      <StatusFilter selected={filters.statusFilters} onChange={handleStatusChange} />
      {filteredCount < totalCount ? (
        <span className="text-xs tabular-nums text-muted-foreground">
          {t("filteredOfTotal", { filtered: filteredCount, total: totalCount })}
        </span>
      ) : null}
      <div className="flex items-center gap-2 sm:ml-auto">
        <Select value={sortBy} onValueChange={(value) => onSortChange(value as ResultsSortBy)}>
          <SelectTrigger size="sm" aria-label={tl("sortBy")} className={cn("w-40", LIST_FILTER)}>
            <ArrowUpDown className="size-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {viewMode === "table" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" aria-label={tc("columns")} title={tc("columns")}>
                <Columns3 className="size-4" />
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
                <Check className={cn("size-3.5", showCredits ? "opacity-100" : "opacity-0")} />
                {tc("credits")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={onExportAll} disabled={filteredCount === 0}>
          <Download className="size-3.5" />
          {tc("export")}
        </Button>
      </div>
    </div>
  );
}
