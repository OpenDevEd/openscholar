"use client";

import React from "react";
import type { DateRange } from "react-day-picker";
import { FilterSidebar } from "@/components/shared/filter-sidebar";
import {
  useLibrarySidebarStore,
  getLibrarySidebarDimensions,
} from "@/lib/store";
import { useIsMobile } from "@/lib/hooks";
import type { LibrarySortCombined } from "@/lib/library/search-params";
import { LibraryFilterContent } from "./library-filter-content";

interface LibraryFilterSidebarProps {
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
  activeFilterCount: number;
  onClearAll: () => void;
}

export function LibraryFilterSidebar(props: LibraryFilterSidebarProps) {
  const isMobile = useIsMobile();

  const filterContent = (
    <LibraryFilterContent
      ratingRange={props.ratingRange}
      onRatingRangeChange={props.onRatingRangeChange}
      isRatingActive={props.isRatingActive}
      savedDateRange={props.savedDateRange}
      onSavedDateRangeChange={props.onSavedDateRangeChange}
      isSavedDateActive={props.isSavedDateActive}
      yearRange={props.yearRange}
      onYearRangeChange={props.onYearRangeChange}
      isYearActive={props.isYearActive}
      collectionId={props.collectionId}
      onCollectionChange={props.onCollectionChange}
      collections={props.collections}
      onManageCollections={props.onManageCollections}
      sort={props.sort}
      onSortChange={props.onSortChange}
      isMobile={isMobile}
    />
  );

  // Mobile: render raw filter content (SidebarLayout handles the tab chrome)
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
      useStore={useLibrarySidebarStore}
      getDimensions={getLibrarySidebarDimensions}
      activeFilterCount={props.activeFilterCount}
      onClearAll={props.onClearAll}
    >
      {filterContent}
    </FilterSidebar>
  );
}
