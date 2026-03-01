"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Star,
  ArrowUp,
  ArrowDown,
  Calendar,
  Hash,
  LayoutList,
  LayoutGrid,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FilterSection } from "@/components/shared/filter-section";
import { cn } from "@/lib/utils";
import type {
  LibrarySortBy,
  LibrarySortOrder,
  LibrarySavedPreset,
  LibraryViewMode,
} from "@/lib/library/search-params";

interface LibraryFiltersProps {
  minRating: number | undefined;
  onMinRatingChange: (rating: number | undefined) => void;
  sortBy: LibrarySortBy;
  onSortByChange: (sortBy: LibrarySortBy) => void;
  sortOrder: LibrarySortOrder;
  onSortOrderChange: (sortOrder: LibrarySortOrder) => void;
  sortDisabled: boolean;
  savedPreset: LibrarySavedPreset | null;
  onSavedPresetChange: (preset: LibrarySavedPreset | null) => void;
  yearFrom: number | null;
  yearTo: number | null;
  onYearFromChange: (year: number | null) => void;
  onYearToChange: (year: number | null) => void;
  viewMode: LibraryViewMode;
  onViewModeChange: (mode: LibraryViewMode) => void;
  collectionId: string | null;
  onCollectionChange: (id: string | null) => void;
  collections: Array<{ _id: string; name: string; itemCount: number }> | undefined;
  onManageCollections: () => void;
}

export function LibraryFilters({
  minRating,
  onMinRatingChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  sortDisabled,
  savedPreset,
  onSavedPresetChange,
  yearFrom,
  yearTo,
  onYearFromChange,
  onYearToChange,
  viewMode,
  onViewModeChange,
  collectionId,
  onCollectionChange,
  collections,
  onManageCollections,
}: LibraryFiltersProps) {
  const t = useTranslations("libraryPage");

  // Local year range state (commit on blur, like the search page year range picker)
  const [localYearFrom, setLocalYearFrom] = useState(yearFrom?.toString() ?? "");
  const [localYearTo, setLocalYearTo] = useState(yearTo?.toString() ?? "");
  const yearFromRef = useRef<HTMLInputElement>(null);
  const yearToRef = useRef<HTMLInputElement>(null);

  // Keep local state in sync with URL params when they change externally
  useEffect(() => {
    if (document.activeElement !== yearFromRef.current) {
      setLocalYearFrom(yearFrom?.toString() ?? "");
    }
  }, [yearFrom]);

  useEffect(() => {
    if (document.activeElement !== yearToRef.current) {
      setLocalYearTo(yearTo?.toString() ?? "");
    }
  }, [yearTo]);

  const commitYearFrom = (value: string) => {
    const parsed = value ? parseInt(value, 10) : null;
    if (parsed !== null && (parsed < 1900 || parsed > 2100 || isNaN(parsed))) {
      setLocalYearFrom(yearFrom?.toString() ?? "");
      return;
    }
    onYearFromChange(parsed);
  };

  const commitYearTo = (value: string) => {
    const parsed = value ? parseInt(value, 10) : null;
    if (parsed !== null && (parsed < 1900 || parsed > 2100 || isNaN(parsed))) {
      setLocalYearTo(yearTo?.toString() ?? "");
      return;
    }
    onYearToChange(parsed);
  };

  const handleStarClick = (starValue: number) => {
    if (minRating === starValue) {
      onMinRatingChange(undefined);
    } else {
      onMinRatingChange(starValue);
    }
  };

  const toggleSortOrder = () => {
    onSortOrderChange(sortOrder === "asc" ? "desc" : "asc");
  };

  const sortOptions: { value: LibrarySortBy; label: string }[] = [
    { value: "savedAt", label: t("sortDateSaved") },
    { value: "rating", label: t("sortRating") },
    { value: "publicationYear", label: t("sortPublicationYear") },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: Filter sections */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {/* Rating filter */}
        <FilterSection
          title={t("ratingFilter")}
          icon={Star}
          isActive={minRating !== undefined}
          onClear={minRating !== undefined ? () => onMinRatingChange(undefined) : undefined}
        >
          <div className="flex items-center gap-1" role="group" aria-label={t("ratingFilter")}>
            {[1, 2, 3, 4, 5].map((starValue) => {
              const isActive = minRating !== undefined && starValue <= minRating;
              const isSelected = minRating === starValue;
              return (
                <Tooltip key={starValue} delayDuration={300}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => handleStarClick(starValue)}
                      className={cn(
                        "p-0.5 rounded transition-colors hover:scale-110",
                        isSelected && "ring-1 ring-primary/30 rounded-sm",
                      )}
                      aria-label={
                        isSelected
                          ? t("clearRatingFilter")
                          : `${starValue}+`
                      }
                    >
                      <Star
                        className={cn(
                          "h-4 w-4 transition-colors",
                          isActive
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/40 hover:text-amber-300",
                        )}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {isSelected ? t("clearRatingFilter") : `${starValue}+`}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </FilterSection>

        {/* Date saved presets */}
        <FilterSection
          title={t("filterDateSaved")}
          icon={Calendar}
          isActive={savedPreset !== null}
          onClear={savedPreset !== null ? () => onSavedPresetChange(null) : undefined}
        >
          <div className="flex items-center gap-1">
            {(["week", "month", "year"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onSavedPresetChange(savedPreset === preset ? null : preset)}
                className={cn(
                  "text-xs px-2.5 py-1.5 rounded-md transition-colors",
                  savedPreset === preset
                    ? "text-primary bg-background shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                )}
              >
                {t(
                  preset === "week"
                    ? "filterLastWeek"
                    : preset === "month"
                      ? "filterLastMonth"
                      : "filterLastYear",
                )}
              </button>
            ))}
          </div>
        </FilterSection>

        {/* Year range */}
        <FilterSection
          title={t("filterYearRange")}
          icon={Hash}
          isActive={yearFrom !== null || yearTo !== null}
          onClear={
            yearFrom !== null || yearTo !== null
              ? () => {
                  onYearFromChange(null);
                  onYearToChange(null);
                }
              : undefined
          }
        >
          <div className="flex items-center gap-1.5">
            <Input
              ref={yearFromRef}
              type="number"
              placeholder={t("filterYearFrom")}
              value={localYearFrom}
              onChange={(e) => setLocalYearFrom(e.target.value)}
              onBlur={(e) => commitYearFrom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className="h-7 w-[72px] text-xs"
              min={1900}
              max={2100}
            />
            <span className="text-xs text-muted-foreground">-</span>
            <Input
              ref={yearToRef}
              type="number"
              placeholder={t("filterYearTo")}
              value={localYearTo}
              onChange={(e) => setLocalYearTo(e.target.value)}
              onBlur={(e) => commitYearTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className="h-7 w-[72px] text-xs"
              min={1900}
              max={2100}
            />
          </div>
        </FilterSection>

        {/* Collection filter */}
        <FilterSection
          title={t("filterCollection")}
          icon={FolderOpen}
          isActive={collectionId !== null}
          onClear={collectionId !== null ? () => onCollectionChange(null) : undefined}
        >
          <Select
            value={collectionId ?? ""}
            onValueChange={(v) => onCollectionChange(v || null)}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder={t("allCollections")} />
            </SelectTrigger>
            <SelectContent>
              {collections?.map((c) => (
                <SelectItem key={c._id} value={c._id} className="text-xs">
                  <span className="flex items-center gap-2">
                    {c.name}
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">
                      {c.itemCount}
                    </Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={onManageCollections}
            className="mt-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("manageCollections")}
          </button>
        </FilterSection>
      </div>

      {/* Row 2: Sort controls + View mode toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Sort controls */}
        <div className="flex items-center gap-1.5 ml-auto">
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <span>
                <Select
                  value={sortBy}
                  onValueChange={(v) => onSortByChange(v as LibrarySortBy)}
                  disabled={sortDisabled}
                >
                  <SelectTrigger
                    className={cn(
                      "h-8 w-[160px] text-xs",
                      sortDisabled && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <span className="text-muted-foreground mr-1">{t("sortBy")}:</span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sortOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            </TooltipTrigger>
            {sortDisabled && (
              <TooltipContent side="bottom" className="text-xs">
                {t("sortDisabledInSearch")}
              </TooltipContent>
            )}
          </Tooltip>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={toggleSortOrder}
                disabled={sortDisabled}
                className={cn(
                  "shrink-0",
                  sortDisabled && "opacity-50 cursor-not-allowed",
                )}
                aria-label={sortOrder === "asc" ? t("sortAscending") : t("sortDescending")}
              >
                {sortOrder === "asc" ? (
                  <ArrowUp className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {sortOrder === "asc" ? t("sortAscending") : t("sortDescending")}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* View mode toggle - aligned styling with search page pattern */}
        <div className="flex items-center gap-0.5 p-0.5 bg-muted/50 dark:bg-muted/30 rounded-lg border border-border/60">
          <button
            type="button"
            onClick={() => onViewModeChange("list")}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              viewMode === "list"
                ? "text-primary bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50",
            )}
            title={t("viewList")}
          >
            <LayoutList className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("grid")}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              viewMode === "grid"
                ? "text-primary bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50",
            )}
            title={t("viewGrid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
