"use client";

import React, { useMemo } from 'react';
import { Focus } from "lucide-react";
import { isCountryFocusActive } from "@/lib/utils";
import { COUNTRIES, getCountryCodesForRegions } from "@/lib/constants";
import { CountrySelector } from "./country-selector";
import { useCountryFilter } from "@/hooks/use-country-filter";

export function CountryFocusPicker() {
  const { selectedValues, handleSelectionChange } = useCountryFilter('selectedCountryFocus');

  // Computed filter active state
  const isCountryFocusFilterActive = isCountryFocusActive(selectedValues);

  // Get country names for display and search enhancement
  const countryNames = useMemo(() => {
    const names: string[] = [];
    const countryData = getCountryCodesForRegions(selectedValues);
    
    countryData.countries.forEach(code => {
      if (COUNTRIES[code] && !names.includes(COUNTRIES[code])) {
        names.push(COUNTRIES[code]);
      }
    });
    
    return names;
  }, [selectedValues]);

  return (
    <div className="space-y-3">
      <CountrySelector
        selectedRegions={selectedValues}
        onSelectionChange={handleSelectionChange}
        placeholder="Add country focus to search"
        description="Choose countries to add to your search query"
        showCountryNames={true}
        bypassLimit={true}
      />

      {/* Enhanced search preview */}
      {countryNames.length > 0 && (
        <div className="p-3 bg-sidebar-accent/50 rounded-lg border border-border/40">
          <div className="flex items-start gap-2">
            <Focus className="h-4 w-4 text-sidebar-primary mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground mb-1">
                Search Focus Active
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                Search results will be enhanced to focus on papers mentioning:
              </p>
              <div className="flex flex-wrap gap-1">
                {countryNames.slice(0, 10).map((countryName, index) => (
                  <span 
                    key={index}
                    className="text-xs bg-sidebar-accent text-sidebar-primary px-2 py-1 rounded-md border border-border/40"
                  >
                    {countryName}
                  </span>
                ))}
                {countryNames.length > 10 && (
                  <span className="text-xs text-muted-foreground px-2 py-1">
                    +{countryNames.length - 10} more
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                This enhances your search behind the scenes without changing your query text.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Info about the difference */}
      {(isCountryFocusFilterActive || selectedValues.length > 0) && (
        <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
          <strong>Tip:</strong> Country focus enhances your search to include papers about these countries, 
          while Institution location filters by author affiliations. Use both for comprehensive results!
        </div>
      )}
    </div>
  );
} 