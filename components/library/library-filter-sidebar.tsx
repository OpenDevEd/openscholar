"use client";

import React from "react";
import { FilterSidebar } from "@/components/shared/filter-sidebar";
import {
  useLibrarySidebarStore,
  getLibrarySidebarDimensions,
} from "@/lib/store";
import { useIsMobile } from "@/lib/hooks";
import { LibraryFilterContent } from "./library-filter-content";

interface LibraryFilterSidebarProps {
  rawSearch: string;
  onSearchChange: (value: string) => void;
  minRating: number | undefined;
  onMinRatingChange: (rating: number | undefined) => void;
  savedPreset: string | null;
  onSavedPresetChange: (preset: string | null) => void;
  yearFrom: number | null;
  yearTo: number | null;
  onYearFromChange: (year: number | null) => void;
  onYearToChange: (year: number | null) => void;
  collectionId: string | null;
  onCollectionChange: (id: string | null) => void;
  collections:
    | Array<{ _id: string; name: string; itemCount: number }>
    | undefined;
  onManageCollections: () => void;
  activeFilterCount: number;
  onClearAll: () => void;
}

export function LibraryFilterSidebar(props: LibraryFilterSidebarProps) {
  const isMobile = useIsMobile();

  const filterContent = (
    <LibraryFilterContent
      rawSearch={props.rawSearch}
      onSearchChange={props.onSearchChange}
      minRating={props.minRating}
      onMinRatingChange={props.onMinRatingChange}
      savedPreset={props.savedPreset}
      onSavedPresetChange={props.onSavedPresetChange}
      yearFrom={props.yearFrom}
      yearTo={props.yearTo}
      onYearFromChange={props.onYearFromChange}
      onYearToChange={props.onYearToChange}
      collectionId={props.collectionId}
      onCollectionChange={props.onCollectionChange}
      collections={props.collections}
      onManageCollections={props.onManageCollections}
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
