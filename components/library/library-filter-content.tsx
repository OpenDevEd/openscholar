"use client";

import { useMemo } from "react";
import { subMonths, subWeeks, subYears } from "date-fns";
import { Clock, FolderOpen, LibraryBig, SlidersHorizontal, Star } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterSection } from "@/components/shared/filter-section";
import { DateRangePicker, type DatePreset } from "@/components/shared/date-range-picker";
import { YearRangePicker } from "@/components/year-range-picker";
import { RatingRangePicker } from "@/components/rating-range-picker";
import { MIN_YEAR } from "@/lib/constants";
import type { LibrarySortCombined } from "@/lib/library/search-params";
import { cn } from "@/lib/utils";

/**
 * Combined sort options for the library sort dropdown.
 * Each value is "field:direction" to match the URL param format.
 */
const LIBRARY_SORT_OPTIONS: Array<{
  value: LibrarySortCombined;
  labelKey: string;
}> = [
  { value: "savedAt:desc", labelKey: "sortSavedAtDesc" },
  { value: "savedAt:asc", labelKey: "sortSavedAtAsc" },
  { value: "rating:desc", labelKey: "sortRatingDesc" },
  { value: "rating:asc", labelKey: "sortRatingAsc" },
  { value: "publicationYear:desc", labelKey: "sortPublicationYearDesc" },
  { value: "publicationYear:asc", labelKey: "sortPublicationYearAsc" },
  { value: "citedByCount:desc", labelKey: "sortCitationsDesc" },
  { value: "citedByCount:asc", labelKey: "sortCitationsAsc" },
  { value: "title:asc", labelKey: "sortTitleAsc" },
  { value: "title:desc", labelKey: "sortTitleDesc" },
];

interface LibraryFilterContentProps {
  ratingRange: [number, number];
  onRatingRangeChange: (range: [number, number]) => void;
  isRatingActive: boolean;
  savedDateRange: DateRange | undefined;
  onSavedDateRangeChange: (range: DateRange | undefined) => void;
  isSavedDateActive: boolean;
  yearRange: [number, number];
  onYearRangeChange: (range: [number, number]) => void;
  isYearActive: boolean;
  collectionId: string | null;
  onCollectionChange: (id: string | null) => void;
  collections:
    | Array<{ _id: string; name: string; itemCount: number }>
    | undefined;
  onManageCollections: () => void;
  sort: LibrarySortCombined;
  onSortChange: (value: LibrarySortCombined) => void;
  isMobile: boolean;
}

export function LibraryFilterContent({
  ratingRange,
  onRatingRangeChange,
  isRatingActive,
  savedDateRange,
  onSavedDateRangeChange,
  isSavedDateActive,
  yearRange,
  onYearRangeChange,
  isYearActive,
  collectionId,
  onCollectionChange,
  collections,
  onManageCollections,
  sort,
  onSortChange,
  isMobile,
}: LibraryFilterContentProps) {
  const t = useTranslations("libraryPage");
  const tf = useTranslations("searchFilters");

  const isSortActive = sort !== "savedAt:desc";
  const isCollectionActive = collectionId !== null;

  // Date presets for the "date saved" filter
  const savedDatePresets: DatePreset[] = useMemo(
    () => [
      {
        key: "week",
        label: t("filterLastWeek"),
        getRange: () => ({ from: subWeeks(new Date(), 1), to: new Date() }),
      },
      {
        key: "month",
        label: t("filterLastMonth"),
        getRange: () => ({ from: subMonths(new Date(), 1), to: new Date() }),
      },
      {
        key: "year",
        label: t("filterLastYear"),
        getRange: () => ({ from: subYears(new Date(), 1), to: new Date() }),
      },
    ],
    [t],
  );

  return (
    <div className={cn("space-y-4 p-4", !isMobile && "pt-15")}>
      {/* Date Saved */}
      <FilterSection
        title={t("filterDateSaved")}
        icon={LibraryBig}
        isActive={isSavedDateActive}
        onClear={
          isSavedDateActive
            ? () => onSavedDateRangeChange(undefined)
            : undefined
        }
      >
        <DateRangePicker
          value={savedDateRange}
          onValueChange={onSavedDateRangeChange}
          presets={savedDatePresets}
        />
      </FilterSection>

      {/* Publication Timeframe */}
      <FilterSection
        title={tf("publicationTimeframe")}
        icon={Clock}
        isActive={isYearActive}
        onClear={
          isYearActive
            ? () => onYearRangeChange([MIN_YEAR, new Date().getFullYear()])
            : undefined
        }
      >
        <YearRangePicker
          yearRange={yearRange}
          onYearRangeChange={onYearRangeChange}
          isActive={isYearActive}
        />
      </FilterSection>

      {/* Rating */}
      <FilterSection
        title={t("ratingFilter")}
        icon={Star}
        isActive={isRatingActive}
        onClear={
          isRatingActive
            ? () => onRatingRangeChange([1, 5])
            : undefined
        }
      >
        <RatingRangePicker
          ratingRange={ratingRange}
          onRatingRangeChange={onRatingRangeChange}
          minValue={1}
        />
      </FilterSection>

      {/* Collection */}
      <FilterSection
        title={t("filterCollection")}
        icon={FolderOpen}
        isActive={isCollectionActive}
        onClear={
          isCollectionActive ? () => onCollectionChange(null) : undefined
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onCollectionChange(null)}
              className={cn(
                "inline-flex items-center rounded-xl border px-3 py-2 text-sm transition-colors",
                collectionId === null
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "border-border/60 bg-background/70 text-muted-foreground hover:text-foreground",
              )}
            >
              {t("allCollections")}
            </button>

            {collections?.map((collection) => {
              const active = collectionId === collection._id;
              return (
                <button
                  key={collection._id}
                  type="button"
                  onClick={() => onCollectionChange(collection._id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors",
                    active
                      ? "border-primary/30 bg-primary/10 text-foreground"
                      : "border-border/60 bg-background/70 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="max-w-[150px] truncate">
                    {collection.name}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {collection.itemCount}
                  </span>
                </button>
              );
            })}
          </div>

          {!collections?.length && (
            <p className="text-sm text-muted-foreground">
              {t("noCollections")}
            </p>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onManageCollections}
            className="w-full"
          >
            {t("manageCollections")}
          </Button>
        </div>
      </FilterSection>

      {/* Sort */}
      <FilterSection
        title={t("sortBy")}
        icon={SlidersHorizontal}
        isActive={isSortActive}
        onClear={
          isSortActive
            ? () => onSortChange("savedAt:desc")
            : undefined
        }
      >
        <Select
          value={sort}
          onValueChange={(value) =>
            onSortChange(value as LibrarySortCombined)
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIBRARY_SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterSection>
    </div>
  );
}
