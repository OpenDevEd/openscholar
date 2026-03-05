"use client";

import React from "react";
import { FilterSidebar } from "@/components/shared/filter-sidebar";
import {
  useLibrarySidebarStore,
  getLibrarySidebarDimensions,
} from "@/lib/store";
import { useIsMobile } from "@/lib/hooks";
import type {
  LibrarySortBy,
  LibrarySortOrder,
} from "@/lib/library/search-params";
import { LibraryFilterContent } from "./library-filter-content";

interface LibraryFilterSidebarProps {
  minRating: number | undefined;
  maxRating: number | undefined;
  onRatingChange: (min: number | undefined, max: number | undefined) => void;
  savedFrom: string | null;
  savedTo: string | null;
  onSavedRangeChange: (from: string | null, to: string | null) => void;
  yearFrom: number | null;
  yearTo: number | null;
  onYearRangeChange: (from: number | null, to: number | null) => void;
  collectionId: string | null;
  onCollectionChange: (id: string | null) => void;
  collections:
    | Array<{ _id: string; name: string; itemCount: number }>
    | undefined;
  onManageCollections: () => void;
  sortBy: LibrarySortBy;
  sortOrder: LibrarySortOrder;
  onSortByChange: (value: LibrarySortBy) => void;
  onSortOrderChange: (value: LibrarySortOrder) => void;
  activeFilterCount: number;
  onClearAll: () => void;
}

export function LibraryFilterSidebar(props: LibraryFilterSidebarProps) {
  const isMobile = useIsMobile();

  const filterContent = (
    <LibraryFilterContent
      minRating={props.minRating}
      maxRating={props.maxRating}
      onRatingChange={props.onRatingChange}
      savedFrom={props.savedFrom}
      savedTo={props.savedTo}
      onSavedRangeChange={props.onSavedRangeChange}
      yearFrom={props.yearFrom}
      yearTo={props.yearTo}
      onYearRangeChange={props.onYearRangeChange}
      collectionId={props.collectionId}
      onCollectionChange={props.onCollectionChange}
      collections={props.collections}
      onManageCollections={props.onManageCollections}
      sortBy={props.sortBy}
      sortOrder={props.sortOrder}
      onSortByChange={props.onSortByChange}
      onSortOrderChange={props.onSortOrderChange}
      isMobile={isMobile}
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
      useStore={useLibrarySidebarStore}
      getDimensions={getLibrarySidebarDimensions}
      activeFilterCount={props.activeFilterCount}
      onClearAll={props.onClearAll}
    >
      {filterContent}
    </FilterSidebar>
  );
}
