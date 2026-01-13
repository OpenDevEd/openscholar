"use client";

import React from 'react';
import { CountrySelector } from "./country-selector";
import { useCountryFilter } from "@/hooks/use-country-filter";

export function CountryRegionPicker() {
  const { selectedValues, handleSelectionChange } = useCountryFilter('selectedRegions');

  return (
    <CountrySelector
      selectedRegions={selectedValues}
      onSelectionChange={handleSelectionChange}
      placeholder="Filter by institution location"
      description="Choose regions to filter papers by author affiliations"
      showCountryNames={false}
      bypassLimit={false}
    />
  );
} 