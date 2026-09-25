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
  clearedFilterUpdates,
} from "@/lib/utils";
import { countActiveFilters } from "@/lib/filters";
import { SidebarContent } from "./search-sidebar";

export function SearchFilterSidebar() {
  const isMobile = useIsMobile();

  const formState = useCurrentSearchFormState();
  const { citesItemId, citedByItemId, relatedToItemId } = formState;
  const updateFilter = useUpdateSearchFilter();

  // Compute active filter states for conditional rendering
  const isCitesActive = isCitesFilterActive(citesItemId);
  const isCitedByActive = isCitedByFilterActive(citedByItemId);
  const isRelatedToActive = isRelatedToFilterActive(relatedToItemId);

  // Clear all filters
  const handleClearAllFilters = React.useCallback(() => {
    updateFilter(clearedFilterUpdates());
  }, [updateFilter]);

  // Active filter count
  const activeFiltersCount = countActiveFilters({ ...formState, field: formState.currentSearchField });

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
