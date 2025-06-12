import React from 'react';
import { useSearchFormStore } from "@/lib/store";
import { updateCurrentSearchFilters } from "@/lib/search-actions";
import { CountrySelector } from "./country-selector";

export function CountryRegionPicker() {
  const {
    selectedRegions,
    isCountryFilterActive,
    setSelectedRegions,
    setIsCountryFilterActive,
    clearCountryFilter
  } = useSearchFormStore();

  const handleSelectionChange = async (regions: string[]) => {
    setSelectedRegions(regions);
    setIsCountryFilterActive(regions.length > 0);
    
    // Always update search filters when selection changes
    await updateCurrentSearchFilters();
  };

  const handleClearFilter = async () => {
    clearCountryFilter();
    await updateCurrentSearchFilters();
  };

  return (
    <CountrySelector
      selectedRegions={selectedRegions}
      onSelectionChange={handleSelectionChange}
      placeholder="Filter by institution location"
      description="Choose regions to filter papers by author affiliations"
      showCountryNames={false}
    />
  );
} 