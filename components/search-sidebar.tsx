"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  SortAsc,
  Clock,
  Target,
  Star,
  Globe,
  Quote,
  Network,
  Shapes,
  Globe2,
  Library,
  ListFilter,
  Languages,
  Building2,
  HandCoins,
  Award,
} from "@/components/icons";
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
import type { SearchField } from "@/lib/types";
import { SEARCH_FIELDS } from "@/lib/types";
import { getFieldLabel, type FilterT } from "@/lib/filters";
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
import { ResearchAreaFilter } from "./research-area-filter";
import { FunderFilter } from "./funder-filter";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { FilterSection } from "@/components/shared/filter-section";
import { OptionPicker } from "@/components/shared/option-picker";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { INSTITUTION_TYPES, SDGS, WORK_LANGUAGES, WORK_TYPES } from "@/lib/openalex/vocabulary";


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

// Both country filters in one card: where the authors' institutions are, and
// which countries the work is about.
const CountryFilterPanel = React.memo(function CountryFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { selectedRegions, selectedCountryFocus } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isActive =
    isCountryFilterActive(selectedRegions) ||
    Boolean(selectedCountryFocus && selectedCountryFocus.length > 0);

  const handleClearFilter = React.useCallback(() => {
    updateFilter({
      selectedRegions: DEFAULT_FILTERS.selectedRegions,
      selectedCountryFocus: DEFAULT_FILTERS.selectedCountryFocus,
    });
  }, [updateFilter]);

  return (
    <FilterSection
      title={tf("countries")}
      icon={Globe}
      isActive={isActive}
      onClear={isActive ? handleClearFilter : undefined}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{tf("institutionLocation")}</Label>
          <CountryRegionPicker />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{tf("countryFocus")}</Label>
          <CountryFocusPicker />
        </div>
      </div>
    </FilterSection>
  );
});

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
            {getFieldLabel(currentSearchField, tf as FilterT)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SEARCH_FIELDS.map((field) => (
            <SelectItem key={field.value} value={field.value}>
              {getFieldLabel(field.value, tf as FilterT)}
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

/** A labelled switch like the review filter's, for the Only show card. */
function SwitchRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="space-y-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

const OnlyShowFilterPanel = React.memo(function OnlyShowFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { openAccessOnly, hasAbstract, includeRetracted, reviewFilter } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isActive = openAccessOnly || hasAbstract || includeRetracted || isReviewFilterActive(reviewFilter);
  return (
    <FilterSection
      title={tf("onlyShow")}
      icon={ListFilter}
      isActive={isActive}
      onClear={
        isActive
          ? () => updateFilter({ openAccessOnly: false, hasAbstract: false, includeRetracted: false, reviewFilter: DEFAULT_FILTERS.reviewFilter })
          : undefined
      }
    >
      <div className="space-y-3">
        <SwitchRow
          id="open-access-filter"
          label={tf("openAccessWorks")}
          hint={tf("onlyOpenAccessHint")}
          checked={openAccessOnly}
          onCheckedChange={(checked) => updateFilter({ openAccessOnly: checked })}
        />
        <SwitchRow
          id="abstract-filter"
          label={tf("worksWithAbstract")}
          hint={tf("worksWithAbstractHint")}
          checked={hasAbstract}
          onCheckedChange={(checked) => updateFilter({ hasAbstract: checked })}
        />
        <SwitchRow
          id="review-filter"
          label={tf("reviews")}
          hint={tf("reviewFilterDescription")}
          checked={reviewFilter}
          onCheckedChange={(checked) => updateFilter({ reviewFilter: checked })}
        />
        <SwitchRow
          id="retracted-filter"
          label={tf("notRetracted")}
          hint={tf("notRetractedHint")}
          checked={!includeRetracted}
          onCheckedChange={(checked) => updateFilter({ includeRetracted: !checked })}
        />
      </div>
    </FilterSection>
  );
});

const WorkLanguageFilterPanel = React.memo(function WorkLanguageFilterPanel() {
  const tf = useTranslations("searchFilters");
  const locale = useLocale();
  const { workLanguages } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isActive = workLanguages.length > 0;
  const names = new Intl.DisplayNames([locale], { type: "language" });
  const options = WORK_LANGUAGES.map((code) => ({ id: code, name: names.of(code) ?? code }));
  return (
    <FilterSection
      title={tf("writtenIn")}
      icon={Languages}
      isActive={isActive}
      onClear={isActive ? () => updateFilter({ workLanguages: [] }) : undefined}
    >
      <OptionPicker
        label={tf("writtenIn")}
        placeholder={tf("anyLanguage")}
        selectedText={tf("nSelected", { count: workLanguages.length })}
        searchPlaceholder={tf("searchLanguages")}
        emptyText={tf("nothingFound")}
        removeLabel={(name) => tf("removeChoice", { name })}
        options={options}
        selected={workLanguages}
        names={Object.fromEntries(options.map((option) => [option.id, option.name]))}
        onToggle={(id) => updateFilter({ workLanguages: toggled(workLanguages, id) })}
      />
    </FilterSection>
  );
});

const InstitutionTypeFilterPanel = React.memo(function InstitutionTypeFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { institutionTypes } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isActive = institutionTypes.length > 0;
  return (
    <FilterSection
      title={tf("institutionType")}
      icon={Building2}
      isActive={isActive}
      onClear={isActive ? () => updateFilter({ institutionTypes: [] }) : undefined}
    >
      <OptionPicker
        label={tf("institutionType")}
        placeholder={tf("anyInstitutionType")}
        selectedText={tf("nSelected", { count: institutionTypes.length })}
        searchPlaceholder={tf("searchInstitutionTypes")}
        emptyText={tf("nothingFound")}
        removeLabel={(name) => tf("removeChoice", { name })}
        options={INSTITUTION_TYPES}
        selected={institutionTypes}
        names={Object.fromEntries(INSTITUTION_TYPES.map((type) => [type.id, type.name]))}
        onToggle={(id) => updateFilter({ institutionTypes: toggled(institutionTypes, id) })}
      />
    </FilterSection>
  );
});

const FunderFilterPanel = React.memo(function FunderFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { funders } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isActive = funders.length > 0;
  return (
    <FilterSection
      title={tf("funders")}
      icon={HandCoins}
      isActive={isActive}
      onClear={isActive ? () => updateFilter({ funders: [] }) : undefined}
    >
      <FunderFilter selected={funders} onChange={(ids) => updateFilter({ funders: ids })} />
    </FilterSection>
  );
});

const MinCitationsFilterPanel = React.memo(function MinCitationsFilterPanel() {
  const tf = useTranslations("searchFilters");
  const { minCitations } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  // Typing is kept here and applied on Enter or leaving the field, so each digit is not a search.
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? (minCitations ? String(minCitations) : "");
  const apply = () => {
    if (draft === null) return;
    const value = Number.parseInt(draft, 10);
    updateFilter({ minCitations: Number.isFinite(value) && value > 0 ? value : null });
    setDraft(null);
  };
  return (
    <FilterSection
      title={tf("minCitations")}
      icon={Award}
      isActive={Boolean(minCitations)}
      onClear={minCitations ? () => updateFilter({ minCitations: null }) : undefined}
    >
      <Input
        type="number"
        min={1}
        inputMode="numeric"
        aria-label={tf("minCitations")}
        placeholder={tf("anyNumber")}
        value={shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === "Enter") apply();
        }}
      />
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

      {/* Institution location and country focus */}
      <CountryFilterPanel />

      {/* Rating Filter */}
      {!hidePanels.includes("rating") && <RatingFilterPanel />}

      <OnlyShowFilterPanel />

      {/* Search Field - Dropdown */}
      <SearchFieldPanel />

      {/* Sort Options - Dropdown */}
      {!hidePanels.includes("sort") && <SortOptionsPanel />}

      <WorkTypeFilterPanel />
      <WorkLanguageFilterPanel />
      <ResearchAreaFilterPanel />
      <SdgFilterPanel />
      <InstitutionTypeFilterPanel />
      <FunderFilterPanel />
      <MinCitationsFilterPanel />

      {/* Cites Filter (when not active) */}
      {!isCitesActive && <CitesFilterPanel />}

      {/* Cited By Filter (when not active) */}
      {!isCitedByActive && <CitedByFilterPanel />}

      {/* Related To Filter (when not active) */}
      {!isRelatedToActive && <RelatedToFilterPanel />}
    </div>
  );
});
