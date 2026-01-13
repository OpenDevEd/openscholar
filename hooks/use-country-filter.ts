"use client";

import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { updateCurrentSearchFilters } from "@/lib/search-actions";
import { DEFAULT_FILTERS } from "@/lib/utils";

type CountryFilterField = 'selectedRegions' | 'selectedCountryFocus';

/**
 * Shared hook for country filter logic
 * Used by both CountryRegionPicker and CountryFocusPicker
 */
export function useCountryFilter(fieldName: CountryFilterField) {
  const state = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const selectedValues = state[fieldName];

  const handleSelectionChange = async (regions: string[]) => {
    updateFilter({ [fieldName]: regions });
    await updateCurrentSearchFilters();
  };

  const handleClearFilter = async () => {
    updateFilter({ [fieldName]: DEFAULT_FILTERS[fieldName] });
    await updateCurrentSearchFilters();
  };

  return {
    selectedValues,
    handleSelectionChange,
    handleClearFilter,
  };
}
