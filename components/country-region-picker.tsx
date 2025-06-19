"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Globe } from "lucide-react";
import { COUNTRIES } from "@/lib/constants";
import { isCountryFilterActive, DEFAULT_FILTERS } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { CountrySelector } from "./country-selector";
import { updateCurrentSearchFilters } from "@/lib/search-actions";

export function CountryRegionPicker() {
  const {
    selectedRegions,
  } = useCurrentSearchFormState();
  
  const updateFilter = useUpdateSearchFilter();

  const addRegion = (region: string) => {
    if (!selectedRegions.includes(region)) {
      updateFilter({ selectedRegions: [...selectedRegions, region] });
    }
  };

  const removeRegion = (region: string) => {
    updateFilter({ selectedRegions: selectedRegions.filter(r => r !== region) });
  };

  const clearCountryFilter = () => {
    updateFilter({ selectedRegions: DEFAULT_FILTERS.selectedRegions });
  };

  const handleSelectionChange = async (regions: string[]) => {
    updateFilter({ selectedRegions: regions });
    
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
      bypassLimit={false}
    />
  );
} 