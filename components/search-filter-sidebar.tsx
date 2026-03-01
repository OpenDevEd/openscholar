"use client";

import React from "react";
import { FilterSidebar } from "@/components/shared/filter-sidebar";
import { useFilterSidebarStore, getFilterSidebarDimensions } from "@/lib/store";
import {
  useIsMobile,
  useCurrentSearchFormState,
  useUpdateSearchFilter,
} from "@/lib/hooks";
import {
  isCitesFilterActive,
  isCitedByFilterActive,
  isRelatedToFilterActive,
  DEFAULT_FILTERS,
} from "@/lib/utils";
import { countActiveFilters } from "@/lib/filters";
import { SidebarContent } from "./search-sidebar";

export function SearchFilterSidebar() {
  const isMobile = useIsMobile();

  // Filter state -- moved from SearchSidebar
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
  } = useCurrentSearchFormState();

  const updateFilter = useUpdateSearchFilter();

  // Compute active filter states for conditional rendering
  const isCitesActive = isCitesFilterActive(citesItemId);
  const isCitedByActive = isCitedByFilterActive(citedByItemId);
  const isRelatedToActive = isRelatedToFilterActive(relatedToItemId);

  // Clear all filters
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
    });
  }, [updateFilter]);

  // Active filter count
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
  });

  // The filter content rendered by both desktop and mobile paths
  const filterContent = (
    <SidebarContent
      hideHeader
      isMobileSheet={isMobile}
      activeFiltersCount={activeFiltersCount}
      isCitesActive={isCitesActive}
      isCitedByActive={isCitedByActive}
      isRelatedToActive={isRelatedToActive}
      onClearAllFilters={handleClearAllFilters}
    />
  );

  // Mobile: render raw filter content (SidebarLayout handles the tab chrome)
  // FilterSidebar returns null on mobile, so we must bypass it
  if (isMobile) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        {filterContent}
      </div>
    );
  }

  // Desktop: wrap in FilterSidebar for glassmorphic chrome + collapse animation
  return (
    <FilterSidebar
      useStore={useFilterSidebarStore}
      getDimensions={getFilterSidebarDimensions}
      activeFilterCount={activeFiltersCount}
      onClearAll={handleClearAllFilters}
    >
      {filterContent}
    </FilterSidebar>
  );
}
