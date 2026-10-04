"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { Table2, LayoutGrid, PanelLeft, ArrowUpDown, Columns3, Check, ListFilter } from "@/components/icons";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { ConfidenceFilterFields } from "./confidence-filter";
import { StatusFilterFields } from "./status-filter";
import { cn } from "@/lib/utils";
import type { FilterState } from "@/lib/extraction/filtering";

// The job page's results controls, in the page bar's slots like history and
// bookmarks: the view switch as tabs, search, filters and sort as filters, and
// the column picker beside the other actions.

export type ResultsSortBy =
  | "default"
  | "title-asc"
  | "title-desc"
  | "confidence-high"
  | "confidence-low";

export type ResultsViewMode = "table" | "cards" | "split";

export function ResultsViewSwitch({ value, onChange }: { value: ResultsViewMode; onChange: (mode: ResultsViewMode) => void }) {
  const tc = useTranslations("common");
  const ta = useTranslations("accessibility");
  return (
    <IconSwitch
      label={ta("viewOptions")}
      value={value}
      onChange={onChange}
      options={[
        { value: "table", icon: Table2, label: tc("table") },
        { value: "cards", icon: LayoutGrid, label: tc("cards") },
        { value: "split", icon: PanelLeft, label: tc("split") },
      ]}
    />
  );
}

/** Search and sort, as siblings so the page bar or card toolbar can lay them out. */
export function ResultsFilters({ filters, searchQueryResetKey = 0, onFiltersChange, sortBy, onSortChange }: {
  filters: FilterState;
  searchQueryResetKey?: number;
  onFiltersChange: Dispatch<SetStateAction<FilterState>>;
  sortBy: ResultsSortBy;
  onSortChange: (sort: ResultsSortBy) => void;
}) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const tl = useTranslations("libraryPage");
  const sortOptions: { value: ResultsSortBy; label: string }[] = [
    { value: "default", label: tc("defaultSort") },
    { value: "title-asc", label: tc("aToZ") },
    { value: "title-desc", label: tc("zToA") },
    { value: "confidence-high", label: t("confidenceHighLow") },
    { value: "confidence-low", label: t("confidenceLowHigh") },
  ];
  return (
    <>
      <SearchInput
        key={searchQueryResetKey}
        value={filters.searchQuery}
        onChange={(searchQuery) => onFiltersChange((prev) => ({ ...prev, searchQuery }))}
        label={t("searchPapersPlaceholder")}
        placeholder={t("searchPlaceholder")}
        className="w-56"
      />
      <Select value={sortBy} onValueChange={(value) => onSortChange(value as ResultsSortBy)}>
        <SelectTrigger size="sm" aria-label={tl("sortBy")} className={cn("w-40", LIST_FILTER)}>
          <ArrowUpDown className="size-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

/** Confidence and status in one menu, an icon button beside the other bar actions. */
export function ResultsFilterMenu({ filters, onFiltersChange }: {
  filters: FilterState;
  onFiltersChange: Dispatch<SetStateAction<FilterState>>;
}) {
  const tc = useTranslations("common");
  const pdfEnabled = useFeatureFlag("extraction.pdf");
  const { confidenceRange, statusFilters } = filters;
  const rangeActive = confidenceRange[0] !== 0 || confidenceRange[1] !== 100;
  const active = statusFilters.size + (rangeActive ? 1 : 0);

  // A saved "has PDF" filter can outlive the PDF feature; drop it so it never hides results.
  useEffect(() => {
    if (pdfEnabled || !statusFilters.has("has-pdf")) return;
    onFiltersChange((prev) => {
      const next = new Set(prev.statusFilters);
      next.delete("has-pdf");
      return { ...prev, statusFilters: next };
    });
  }, [onFiltersChange, pdfEnabled, statusFilters]);

  return (
    <Popover>
      <TooltipHint label={tc("filters")}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("size-8", active ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : "text-muted-foreground hover:text-foreground")}
            aria-label={active ? `${tc("filters")} (${active})` : tc("filters")}
          >
            {/* A tinted button says a filter is on, without a dot or a wider button. */}
            <ListFilter className="size-4" />
          </Button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent align="end" className="w-80 space-y-5">
        <ConfidenceFilterFields
          range={confidenceRange}
          onChange={(range) => onFiltersChange((prev) => ({ ...prev, confidenceRange: range }))}
        />
        <StatusFilterFields
          selected={statusFilters}
          onChange={(selected) => onFiltersChange((prev) => ({ ...prev, statusFilters: selected }))}
        />
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => onFiltersChange((prev) => ({ ...prev, confidenceRange: [0, 100], statusFilters: new Set() }))}
          >
            {tc("clearAll")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Which optional columns the table shows. */
export function ResultsColumnsMenu({ showCredits, onShowCreditsChange }: { showCredits: boolean; onShowCreditsChange: (next: boolean) => void }) {
  const tc = useTranslations("common");
  return (
    <DropdownMenu>
      <TooltipHint label={tc("columns")}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" aria-label={tc("columns")}>
            <Columns3 className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </TooltipHint>
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
  );
}
