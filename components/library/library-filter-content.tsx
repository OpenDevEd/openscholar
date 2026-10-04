"use client";

import { useMemo, useState } from "react";
import { subMonths, subWeeks, subYears } from "date-fns";
import { Check, Clock, FolderOpen, LibraryBig, Search, Settings, SlidersHorizontal, Star } from "@/components/icons";
import type { DateRange } from "react-day-picker";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { FilterSection } from "@/components/shared/filter-section";
import { PageStepper } from "@/components/shared/page-stepper";
import { DateRangePicker, type DatePreset } from "@/components/shared/date-range-picker";
import { PublicationTimeframeFilter } from "@/components/shared/publication-timeframe-filter";
import { RatingRangePicker } from "@/components/rating-range-picker";
import { MIN_YEAR } from "@/lib/constants";
import type { LibrarySortCombined } from "@/lib/library/search-params";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
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
  publicationDateRange: DateRange | undefined;
  onPublicationDateRangeChange: (range: DateRange | undefined) => void;
  isPublicationDateActive: boolean;
  collectionId: string | null;
  onCollectionChange: (id: string | null) => void;
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
  publicationDateRange,
  onPublicationDateRangeChange,
  isPublicationDateActive,
  collectionId,
  onCollectionChange,
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

      {/* Publication Timeframe — same component as search */}
      <PublicationTimeframeSection
        yearRange={yearRange}
        onYearRangeChange={onYearRangeChange}
        isYearActive={isYearActive}
        publicationDateRange={publicationDateRange}
        onPublicationDateRangeChange={onPublicationDateRangeChange}
        isPublicationDateActive={isPublicationDateActive}
      />

      {/* Rating */}
      <FilterSection
        title={t("ratingFilter")}
        icon={Star}
        isActive={isRatingActive}
        onClear={
          isRatingActive
            ? () => onRatingRangeChange([0, 5])
            : undefined
        }
      >
        <RatingRangePicker
          ratingRange={ratingRange}
          onRatingRangeChange={onRatingRangeChange}
          minValue={0}
        />
      </FilterSection>

      {/* Collection */}
      <CollectionFilterSection
        collectionId={collectionId}
        onCollectionChange={onCollectionChange}
        onManageCollections={onManageCollections}
        isCollectionActive={isCollectionActive}
      />

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

// ---------------------------------------------------------------------------
// Collection filter — vertical scrollable list with inline search
// ---------------------------------------------------------------------------
// Publication Timeframe — wraps the shared component with local filter type state
// ---------------------------------------------------------------------------

function PublicationTimeframeSection({
  yearRange,
  onYearRangeChange,
  isYearActive,
  publicationDateRange,
  onPublicationDateRangeChange,
  isPublicationDateActive,
}: {
  yearRange: [number, number];
  onYearRangeChange: (range: [number, number]) => void;
  isYearActive: boolean;
  publicationDateRange: DateRange | undefined;
  onPublicationDateRangeChange: (range: DateRange | undefined) => void;
  isPublicationDateActive: boolean;
}) {
  const tf = useTranslations("searchFilters");
  const [filterType, setFilterType] = useState<"year" | "date">("year");

  const isActive = isYearActive || isPublicationDateActive;

  const handleClear = () => {
    if (filterType === "date") {
      onPublicationDateRangeChange(undefined);
    } else {
      onYearRangeChange([MIN_YEAR, new Date().getFullYear()]);
    }
  };

  return (
    <FilterSection
      title={tf("publicationTimeframe")}
      icon={Clock}
      isActive={isActive}
      onClear={isActive ? handleClear : undefined}
    >
      <PublicationTimeframeFilter
        filterType={filterType}
        onFilterTypeChange={setFilterType}
        yearRange={yearRange}
        onYearRangeChange={onYearRangeChange}
        isYearEnabled={isYearActive}
        onYearToggleEnabled={(enabled) => {
          if (!enabled) {
            onYearRangeChange([MIN_YEAR, new Date().getFullYear()]);
          }
        }}
        dateRange={publicationDateRange}
        onDateRangeChange={onPublicationDateRangeChange}
        isActive={isActive}
      />
    </FilterSection>
  );
}

// ---------------------------------------------------------------------------
// Collection filter — paginated vertical list with inline search
// ---------------------------------------------------------------------------

const PAGE_SIZE = 6;
const SEARCH_THRESHOLD = 8;
/**
 * A row and the gap under it, measured: a paged list keeps a full first page's height (its
 * collections and "All"), so a shorter page doesn't move the pager or what's below.
 */
const ROW_PX = 38;
const FULL_PAGE_PX = (PAGE_SIZE + 1) * ROW_PX - 2;

function CollectionFilterSection({
  collectionId,
  onCollectionChange,
  onManageCollections,
  isCollectionActive,
}: {
  collectionId: string | null;
  onCollectionChange: (id: string | null) => void;
  onManageCollections: () => void;
  isCollectionActive: boolean;
}) {
  const t = useTranslations("libraryPage");
  const [searchQuery, setSearchQuery] = useState("");
  const search = useDebouncedValue(searchQuery.trim(), 300);
  const { data: totalCollections } = useProtectedQuery(api.library.collections.countCollections, {});
  const collections = useCursorPage(api.library.collections.listCollections, { search: search || undefined }, PAGE_SIZE);

  const showSearch = (totalCollections ?? 0) >= SEARCH_THRESHOLD;
  const hasSearch = search.length > 0;
  const showPagination = collections.hasPages;

  return (
    <FilterSection
      title={t("filterCollection")}
      icon={FolderOpen}
      isActive={isCollectionActive}
      onClear={
        isCollectionActive ? () => onCollectionChange(null) : undefined
      }
      headerAction={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onManageCollections}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      }
    >
      <div className="space-y-2">
        {/* Inline search (only when 8+ collections) */}
        {showSearch && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("searchCollections")}
              className="h-8 pl-8 text-sm"
            />
          </div>
        )}

        {/* Vertical list */}
        <div
          className={cn("space-y-0.5", collections.isStale && "pointer-events-none opacity-60")}
          style={showPagination ? { minHeight: FULL_PAGE_PX } : undefined}
        >
          {/* "All" row — first on page 1, hidden when searching */}
          {!hasSearch && collections.page === 1 && (
            <CollectionRow
              name={t("allCollections")}
              isActive={collectionId === null}
              onClick={() => onCollectionChange(null)}
            />
          )}

          {collections.items.map((collection) => (
            <CollectionRow
              key={collection._id}
              name={collection.name}
              count={collection.itemCount}
              isActive={collectionId === collection._id}
              onClick={() => onCollectionChange(collection._id)}
            />
          ))}

          {/* No search results */}
          {hasSearch && !collections.isLoading && collections.items.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              {t("noCollections")}
            </p>
          )}
        </div>

        {showPagination && (
          <PageStepper
            className="pt-1"
            page={collections.page}
            pageCount={hasSearch || totalCollections === undefined ? undefined : Math.ceil(totalCollections / PAGE_SIZE)}
            canPrevious={collections.canPrevious}
            canNext={collections.canNext}
            onPrevious={collections.previous}
            onNext={collections.next}
          />
        )}

        {/* Empty state */}
        {totalCollections === 0 && (
          <div className="text-center py-3">
            <FolderOpen className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              {t("noCollections")}
            </p>
          </div>
        )}
      </div>
    </FilterSection>
  );
}

/** Single row in the collection list */
function CollectionRow({
  name,
  count,
  isActive,
  onClick,
}: {
  name: string;
  count?: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 w-full rounded-lg px-2.5 py-2 text-sm transition-colors text-left",
        isActive
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {isActive ? (
        <Check className="h-3.5 w-3.5 text-primary shrink-0" />
      ) : (
        <FolderOpen className="h-3.5 w-3.5 shrink-0 opacity-50" />
      )}
      <span className="truncate flex-1">{name}</span>
      {count !== undefined && (
        <span className="text-2xs tabular-nums text-muted-foreground shrink-0">
          {count}
        </span>
      )}
    </button>
  );
}
