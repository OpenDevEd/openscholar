"use client";

import { FilterCountControl } from "@/components/shared/filter-count-control";
import React from "react";
import { SEMANTIC_FIELD } from "@/lib/search/source";
import { useSearchSource } from "@/lib/search/use-search-source";
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
import { DEFAULT_FILTERS } from "@/lib/utils";
import { SidebarContent } from "./search-sidebar";

export function SearchFilterSidebar() {
  const isMobile = useIsMobile();
  const source = useSearchSource();

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
  const activeFiltersCount = countActiveFilters({ ...formState, field: formState.currentSearchField === SEMANTIC_FIELD && source === "openalex" ? DEFAULT_FILTERS.field : formState.currentSearchField });

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
        {/* The sidebar's count and Clear all, which the filters' own tab has no corner for. */}
        {activeFiltersCount > 0 && (
          <div className="sticky top-0 z-10 mb-3 flex justify-end">
            <div className="rounded-lg border border-border-subtle bg-card p-1 shadow-sm">
              <FilterCountControl count={activeFiltersCount} onClearAll={handleClearAllFilters} orientation="row" />
            </div>
          </div>
        )}
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
