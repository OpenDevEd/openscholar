"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  CalendarIcon,
  SortAsc,
  Clock,
  Target,
  Star,
  Globe,
  Quote,
  Network,
  FileText,
  Focus,
  Shapes,
  Globe2,
  LockOpen,
  Library,
} from "lucide-react";
import {
  cn,
  isDateFilterActive,
  isRatingFilterActive,
  isCountryFilterActive,
  isCitesFilterActive,
  isCitedByFilterActive,
  isRelatedToFilterActive,
  isReviewFilterActive,
  DEFAULT_FILTERS,
} from "@/lib/utils";
import { countActiveFilters } from "@/lib/filters";
import type { SearchField } from "@/lib/types";
import { SEARCH_FIELDS } from "@/lib/types";
import { sortOptions } from "@/lib/constants";
import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { RatingRangePicker } from "./rating-range-picker";
import { PublicationTimeframeFilter } from "./shared/publication-timeframe-filter";
import { CountryRegionPicker } from "./country-region-picker";
import { CountryFocusPicker } from "./country-focus-picker";
import { WorkIdFilter } from "./work-id-filter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReviewFilter } from "./review-filter";
import { ResearchAreaFilter } from "./research-area-filter";
import { useTranslations } from "next-intl";
import { FilterSection } from "@/components/shared/filter-section";
import { OptionPicker } from "@/components/shared/option-picker";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SDGS, WORK_TYPES } from "@/lib/openalex/vocabulary";

interface SearchSidebarProps {
  isMobile?: boolean;
  mode?: "sidebar" | "page";
}

// Date Filter Component
const DateFilterPanel = React.memo(function DateFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { dateRange, filterType, isYearRangeEnabled, yearRange } =
    useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const isDateActive = isDateFilterActive(
    dateRange,
    yearRange,
    filterType,
    isYearRangeEnabled,
  );

  const handleFilterTypeChange = React.useCallback(
    (type: "date" | "year") => {
      updateFilter({ filterType: type });
    },
    [updateFilter],
  );

  const handleClearDateRange = React.useCallback(() => {
    updateFilter({ dateRange: undefined });
  }, [updateFilter]);

  const handleClearYearRange = React.useCallback(() => {
    const defaultRange = DEFAULT_FILTERS.yearRange();
    updateFilter({
      yearRange: defaultRange,
      isYearRangeEnabled: DEFAULT_FILTERS.isYearRangeEnabled,
    });
  }, [updateFilter]);

  const handleClearFilter = React.useCallback(() => {
    if (filterType === "date") {
      handleClearDateRange();
    } else {
      handleClearYearRange();
    }
  }, [filterType, handleClearDateRange, handleClearYearRange]);

  return (
    <FilterSection
      title={tf("publicationTimeframe")}
      icon={Clock}
      isActive={isDateActive}
      onClear={isDateActive ? handleClearFilter : undefined}
    >
      <PublicationTimeframeFilter
        filterType={filterType}
        onFilterTypeChange={handleFilterTypeChange}
        yearRange={yearRange}
        onYearRangeChange={(range) => updateFilter({ yearRange: range })}
        isYearEnabled={isYearRangeEnabled}
        onYearToggleEnabled={(enabled) =>
          updateFilter({ isYearRangeEnabled: enabled })
        }
        dateRange={dateRange}
        onDateRangeChange={(range) => updateFilter({ dateRange: range })}
        isActive={isDateActive}
      />
    </FilterSection>
  );
});

// Rating Filter Component
const RatingFilterPanel = React.memo(function RatingFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { ratingRange, onlyRatedPapers } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isRatingActive = isRatingFilterActive(ratingRange, onlyRatedPapers);

  const handleClearRatingFilter = React.useCallback(() => {
    updateFilter({
      ratingRange: DEFAULT_FILTERS.ratingRange,
      onlyRatedPapers: DEFAULT_FILTERS.onlyRatedPapers,
    });
  }, [updateFilter]);

  return (
    <FilterSection
      title={tf("ratingFilter")}
      icon={Star}
      isActive={isRatingActive}
      onClear={isRatingActive ? handleClearRatingFilter : undefined}
    >
      <RatingRangePicker
        ratingRange={ratingRange}
        onRatingRangeChange={(range) => updateFilter({ ratingRange: range })}
        minValue={0}
        onlyRatedPapers={onlyRatedPapers}
        onOnlyRatedChange={(checked) =>
          updateFilter({ onlyRatedPapers: checked })
        }
        showOnlyRatedToggle
        showActiveIndicator
      />
    </FilterSection>
  );
});

// Institution Location Filter Component
const InstitutionLocationFilterPanel = React.memo(
  function InstitutionLocationFilterPanel() {
    const tf = useTranslations("searchFilters");
    const { selectedRegions } = useCurrentSearchFormState();
    const updateFilter = useUpdateSearchFilter();
    const isCountryActive = isCountryFilterActive(selectedRegions);

    const handleClearFilter = React.useCallback(() => {
      updateFilter({ selectedRegions: DEFAULT_FILTERS.selectedRegions });
    }, [updateFilter]);

    return (
      <FilterSection
        title={tf("institutionLocation")}
        icon={Globe}
        isActive={isCountryActive}
        onClear={isCountryActive ? handleClearFilter : undefined}
      >
        <CountryRegionPicker />
      </FilterSection>
    );
  },
);

// Country Focus Filter Component
const CountryFocusFilterPanel = React.memo(
  function CountryFocusFilterPanel() {
    const tf = useTranslations("searchFilters");
    const { selectedCountryFocus } = useCurrentSearchFormState();
    const updateFilter = useUpdateSearchFilter();

    const isCountryFocusFilterActive =
      selectedCountryFocus && selectedCountryFocus.length > 0;

    const handleClearFilter = React.useCallback(() => {
      updateFilter({
        selectedCountryFocus: DEFAULT_FILTERS.selectedCountryFocus,
      });
    }, [updateFilter]);

    return (
      <FilterSection
        title={tf("countryFocus")}
        icon={Focus}
        isActive={isCountryFocusFilterActive}
        onClear={isCountryFocusFilterActive ? handleClearFilter : undefined}
      >
        <CountryFocusPicker />
      </FilterSection>
    );
  },
);

// Search Field Component - now a dropdown select
const SearchFieldPanel = React.memo(function SearchFieldPanel() {
  const tf = useTranslations("searchFilters");
  const ta = useTranslations("accessibility");
  const { currentSearchField } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const handleSearchFieldChange = React.useCallback(
    (field: string) => {
      updateFilter({ currentSearchField: field as SearchField });
    },
    [updateFilter],
  );

  const handleClearFilter = React.useCallback(() => {
    updateFilter({ currentSearchField: DEFAULT_FILTERS.field });
  }, [updateFilter]);

  const FIELD_KEY_MAP: Record<string, string> = {
    title_and_abstract: "searchFieldTitleAndAbstract",
    title: "searchFieldTitle",
    abstract: "searchFieldAbstract",
    fulltext: "searchFieldFulltext",
    display_name: "searchFieldDisplayName",
  };
  const currentFieldLabel =
    (currentSearchField && FIELD_KEY_MAP[currentSearchField]
      ? tf(FIELD_KEY_MAP[currentSearchField] as never)
      : null) || tf("titleAndAbstract");

  const isSearchFieldActive = currentSearchField !== DEFAULT_FILTERS.field;

  return (
    <FilterSection
      title={tf("searchScope")}
      icon={Target}
      isActive={isSearchFieldActive}
      onClear={isSearchFieldActive ? handleClearFilter : undefined}
    >
      <Select
        value={currentSearchField}
        onValueChange={handleSearchFieldChange}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={ta("selectSearchScope")}>
            {currentFieldLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SEARCH_FIELDS.map((field) => (
            <SelectItem key={field.value} value={field.value}>
              {FIELD_KEY_MAP[field.value]
                ? tf(FIELD_KEY_MAP[field.value] as never)
                : field.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterSection>
  );
});

// Sort Options Component - now a dropdown select
const SortOptionsPanel = React.memo(function SortOptionsPanel() {
  const tf = useTranslations("searchFilters");
  const ta = useTranslations("accessibility");
  const { sortBy } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const handleSortChange = React.useCallback(
    (sort: string) => {
      updateFilter({ sortBy: sort });
    },
    [updateFilter],
  );

  const handleClearFilter = React.useCallback(() => {
    updateFilter({ sortBy: DEFAULT_FILTERS.sortBy });
  }, [updateFilter]);

  const SORT_KEY_MAP: Record<string, string> = {
    "relevance_score:desc": "sortRelevance",
    "cited_by_count:desc": "sortCitationsDesc",
    "cited_by_count:asc": "sortCitationsAsc",
    "publication_date:desc": "sortDateDesc",
    "publication_date:asc": "sortDateAsc",
    "display_name:desc": "sortTitleDesc",
    "display_name:asc": "sortTitleAsc",
  };
  const currentSortLabel =
    (sortBy && SORT_KEY_MAP[sortBy]
      ? tf(SORT_KEY_MAP[sortBy] as never)
      : null) || tf("sortRelevanceDefault");

  const isSortActive = sortBy !== DEFAULT_FILTERS.sortBy;

  return (
    <FilterSection
      title={tf("sortResultsBy")}
      icon={SortAsc}
      isActive={isSortActive}
      onClear={isSortActive ? handleClearFilter : undefined}
    >
      <Select value={sortBy} onValueChange={handleSortChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={ta("selectSortOrder")}>
            {currentSortLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {SORT_KEY_MAP[option.value]
                ? tf(SORT_KEY_MAP[option.value] as never)
                : option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterSection>
  );
});

// Cites Filter Component
const CitesFilterPanel = React.memo(function CitesFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { citesItemId } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isCitesActive = isCitesFilterActive(citesItemId);

  const handleClearCitesFilter = React.useCallback(() => {
    updateFilter({ citesItemId: DEFAULT_FILTERS.citesItemId });
  }, [updateFilter]);

  return (
    <FilterSection
      title={tf("citationFilter")}
      icon={Quote}
      isActive={isCitesActive}
      onClear={isCitesActive ? handleClearCitesFilter : undefined}
    >
      <WorkIdFilter type="cites" />
    </FilterSection>
  );
});

// Cited By Filter Component
const CitedByFilterPanel = React.memo(function CitedByFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { citedByItemId } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isCitedByActive = isCitedByFilterActive(citedByItemId);

  const handleClearCitedByFilter = React.useCallback(() => {
    updateFilter({ citedByItemId: DEFAULT_FILTERS.citedByItemId });
  }, [updateFilter]);

  return (
    <FilterSection
      title={tf("citedByFilter")}
      icon={Quote}
      isActive={isCitedByActive}
      onClear={isCitedByActive ? handleClearCitedByFilter : undefined}
    >
      <WorkIdFilter type="cited_by" />
    </FilterSection>
  );
});

// Related To Filter Component
const RelatedToFilterPanel = React.memo(function RelatedToFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { relatedToItemId } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isRelatedToActive = isRelatedToFilterActive(relatedToItemId);

  const handleClearRelatedToFilter = React.useCallback(() => {
    updateFilter({ relatedToItemId: DEFAULT_FILTERS.relatedToItemId });
  }, [updateFilter]);

  return (
    <FilterSection
      title={tf("relatedWorksFilter")}
      icon={Network}
      isActive={isRelatedToActive}
      onClear={isRelatedToActive ? handleClearRelatedToFilter : undefined}
    >
      <WorkIdFilter type="related" />
    </FilterSection>
  );
});

// Review Filter Component
const ReviewFilterPanel = React.memo(function ReviewFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { reviewFilter } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isReviewActive = isReviewFilterActive(reviewFilter);

  const handleClearReviewFilter = React.useCallback(() => {
    updateFilter({ reviewFilter: DEFAULT_FILTERS.reviewFilter });
  }, [updateFilter]);

  return (
    <FilterSection
      title={tf("reviewFilter")}
      icon={FileText}
      isActive={isReviewActive}
      onClear={isReviewActive ? handleClearReviewFilter : undefined}
    >
      <ReviewFilter />
    </FilterSection>
  );
});

const toggled = (list: readonly string[], id: string) =>
  list.includes(id) ? list.filter((one) => one !== id) : [...list, id];

const WorkTypeFilterPanel = React.memo(function WorkTypeFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { workTypes } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isActive = workTypes.length > 0;
  return (
    <FilterSection
      title={tf("publicationType")}
      icon={Library}
      isActive={isActive}
      onClear={isActive ? () => updateFilter({ workTypes: [] }) : undefined}
    >
      <OptionPicker
        label={tf("publicationType")}
        placeholder={tf("anyPublicationType")}
        selectedText={tf("nSelected", { count: workTypes.length })}
        searchPlaceholder={tf("searchPublicationTypes")}
        emptyText={tf("nothingFound")}
        removeLabel={(name) => tf("removeChoice", { name })}
        options={WORK_TYPES}
        selected={workTypes}
        names={Object.fromEntries(WORK_TYPES.map((type) => [type.id, type.name]))}
        onToggle={(id) => updateFilter({ workTypes: toggled(workTypes, id) })}
      />
    </FilterSection>
  );
});

const ResearchAreaFilterPanel = React.memo(function ResearchAreaFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { researchAreas } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isActive = researchAreas.length > 0;
  return (
    <FilterSection
      title={tf("researchAreas")}
      icon={Shapes}
      isActive={isActive}
      onClear={isActive ? () => updateFilter({ researchAreas: [] }) : undefined}
    >
      <ResearchAreaFilter
        selected={researchAreas}
        onChange={(ids) => updateFilter({ researchAreas: ids })}
      />
    </FilterSection>
  );
});

const SdgFilterPanel = React.memo(function SdgFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { sdgs } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isActive = sdgs.length > 0;
  return (
    <FilterSection
      title={tf("sdgs")}
      icon={Globe2}
      isActive={isActive}
      onClear={isActive ? () => updateFilter({ sdgs: [] }) : undefined}
    >
      <OptionPicker
        label={tf("sdgs")}
        placeholder={tf("anySdg")}
        selectedText={tf("nSelected", { count: sdgs.length })}
        searchPlaceholder={tf("searchSdgs")}
        emptyText={tf("nothingFound")}
        removeLabel={(name) => tf("removeChoice", { name })}
        options={SDGS}
        selected={sdgs}
        names={Object.fromEntries(SDGS.map((goal) => [goal.id, goal.name]))}
        onToggle={(id) => updateFilter({ sdgs: toggled(sdgs, id) })}
      />
    </FilterSection>
  );
});

const OpenAccessFilterPanel = React.memo(function OpenAccessFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { openAccessOnly } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  return (
    <FilterSection
      title={tf("openAccess")}
      icon={LockOpen}
      isActive={openAccessOnly}
      onClear={openAccessOnly ? () => updateFilter({ openAccessOnly: false }) : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor="open-access-filter" className="text-sm font-medium">
            {tf("onlyOpenAccess")}
          </Label>
          <p className="text-xs text-muted-foreground">{tf("onlyOpenAccessHint")}</p>
        </div>
        <Switch
          id="open-access-filter"
          checked={openAccessOnly}
          onCheckedChange={(checked) => updateFilter({ openAccessOnly: checked })}
        />
      </div>
    </FilterSection>
  );
});

// Sidebar Content Component - extracted and memoized
interface SidebarContentProps {
  hideHeader?: boolean;
  isMobileSheet?: boolean;
  activeFiltersCount: number;
  isCitesActive: boolean;
  isCitedByActive: boolean;
  isRelatedToActive: boolean;
  onClearAllFilters: () => void;
  /** Panels to leave out where they cannot apply, such as an import. */
  hidePanels?: readonly ("rating" | "sort")[];
}

export const SidebarContent = React.memo(function SidebarContent({
  hideHeader = false,
  isMobileSheet = false,
  activeFiltersCount,
  isCitesActive,
  isCitedByActive,
  isRelatedToActive,
  onClearAllFilters,
  hidePanels = [],
}: SidebarContentProps) {
  const tf = useTranslations("searchFilters");
  const tc = useTranslations("common");
  return (
    <div className={cn("space-y-4", isMobileSheet ? "p-4" : "p-4 pt-15")}>
      {/* Simple Header - hidden when using panel mode with external header */}
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {tc("filters")}
          </h2>
          {activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearAllFilters}
              className="text-xs h-7 px-3 text-muted-foreground hover:text-foreground"
            >
              {tf("clearAllCount", { count: activeFiltersCount })}
            </Button>
          )}
        </div>
      )}

      {/* ID Filters - Show at top when active */}
      {isCitesActive && <CitesFilterPanel />}
      {isCitedByActive && <CitedByFilterPanel />}
      {isRelatedToActive && <RelatedToFilterPanel />}

      {/* Date Filter */}
      <DateFilterPanel />

      {/* Rating Filter */}
      {!hidePanels.includes("rating") && <RatingFilterPanel />}

      {/* Institution Location Filter */}
      <InstitutionLocationFilterPanel />

      {/* Country focus Filter */}
      <CountryFocusFilterPanel />

      {/* Search Field - Dropdown */}
      <SearchFieldPanel />

      {/* Sort Options - Dropdown */}
      {!hidePanels.includes("sort") && <SortOptionsPanel />}

      {/* Review Filter */}
      <ReviewFilterPanel />

      <WorkTypeFilterPanel />
      <ResearchAreaFilterPanel />
      <SdgFilterPanel />
      <OpenAccessFilterPanel />

      {/* Cites Filter (when not active) */}
      {!isCitesActive && <CitesFilterPanel />}

      {/* Cited By Filter (when not active) */}
      {!isCitedByActive && <CitedByFilterPanel />}

      {/* Related To Filter (when not active) */}
      {!isRelatedToActive && <RelatedToFilterPanel />}
    </div>
  );
});

export function SearchSidebar({
  isMobile = false,
  mode = "sidebar",
}: SearchSidebarProps) {
  const {
    currentSearchField,
    sortBy,
    selectedRegions,
    selectedCountryFocus,
    ratingRange,
    onlyRatedPapers,
    citesItemId,
    citedByItemId,
    relatedToItemId,
    yearRange,
    isYearRangeEnabled,
    reviewFilter,
    dateRange,
    filterType,
    researchAreas,
    sdgs,
    openAccessOnly,
    workTypes,
  } = useCurrentSearchFormState();

  const updateFilter = useUpdateSearchFilter();

  const isCitesActive = isCitesFilterActive(citesItemId);
  const isCitedByActive = isCitedByFilterActive(citedByItemId);
  const isRelatedToActive = isRelatedToFilterActive(relatedToItemId);

  const handleClearAllFilters = React.useCallback(() => {
    const defaultYearRange = DEFAULT_FILTERS.yearRange();
    updateFilter({
      currentSearchField: DEFAULT_FILTERS.field,
      sortBy: DEFAULT_FILTERS.sortBy,
      dateRange: DEFAULT_FILTERS.dateRange,
      yearRange: defaultYearRange,
      isYearRangeEnabled: DEFAULT_FILTERS.isYearRangeEnabled,
      ratingRange: DEFAULT_FILTERS.ratingRange,
      onlyRatedPapers: DEFAULT_FILTERS.onlyRatedPapers,
      selectedRegions: DEFAULT_FILTERS.selectedRegions,
      selectedCountryFocus: DEFAULT_FILTERS.selectedCountryFocus,
      citesItemId: DEFAULT_FILTERS.citesItemId,
      citedByItemId: DEFAULT_FILTERS.citedByItemId,
      relatedToItemId: DEFAULT_FILTERS.relatedToItemId,
      reviewFilter: DEFAULT_FILTERS.reviewFilter,
      researchAreas: [],
      sdgs: [],
      openAccessOnly: false,
      workTypes: [],
    });
  }, [updateFilter]);

  const activeFiltersCount = countActiveFilters({
    field: currentSearchField,
    sortBy,
    yearRange,
    dateRange,
    filterType,
    isYearRangeEnabled,
    selectedRegions,
    selectedCountryFocus,
    ratingRange,
    onlyRatedPapers,
    citesItemId,
    citedByItemId,
    relatedToItemId,
    reviewFilter,
    researchAreas,
    sdgs,
    openAccessOnly,
    workTypes,
  });

  if (mode === "page") {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <SidebarContent
          hideHeader
          isMobileSheet={isMobile}
          activeFiltersCount={activeFiltersCount}
          isCitesActive={isCitesActive}
          isCitedByActive={isCitedByActive}
          isRelatedToActive={isRelatedToActive}
          onClearAllFilters={handleClearAllFilters}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-80 rounded-2xl overflow-hidden",
        "bg-background/95 dark:bg-background/90",
        "border border-border/50",
        "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]",
      )}
    >
      <SidebarContent
        activeFiltersCount={activeFiltersCount}
        isCitesActive={isCitesActive}
        isCitedByActive={isCitedByActive}
        isRelatedToActive={isRelatedToActive}
        onClearAllFilters={handleClearAllFilters}
      />
    </div>
  );
}
