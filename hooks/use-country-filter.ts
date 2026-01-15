"use client";

import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
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

  const handleSelectionChange = (regions: string[]) => {
    updateFilter({ [fieldName]: regions });
  };

  const handleClearFilter = () => {
    updateFilter({ [fieldName]: DEFAULT_FILTERS[fieldName] });
  };

  return {
    selectedValues,
    handleSelectionChange,
    handleClearFilter,
  };
}
