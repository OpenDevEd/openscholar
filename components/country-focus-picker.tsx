"use client";

import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Focus, X } from "lucide-react";
import { cn, isCountryFocusActive, DEFAULT_FILTERS } from "@/lib/utils";
import { COUNTRIES, getCountryCodesForRegions } from "@/lib/constants";
import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { CountrySelector } from "./country-selector";
import { updateCurrentSearchFilters } from "@/lib/search-actions";

export function CountryFocusPicker() {
  const {
    selectedCountryFocus,
  } = useCurrentSearchFormState();
  
  const updateFilter = useUpdateSearchFilter();

  // Computed filter active state
  const isCountryFocusFilterActive = isCountryFocusActive(selectedCountryFocus);

  const handleSelectionChange = async (regions: string[]) => {
    updateFilter({ selectedCountryFocus: regions });
    
    // Always update search filters when selection changes
    await updateCurrentSearchFilters();
  };

  const handleClearFilter = async () => {
    updateFilter({ selectedCountryFocus: DEFAULT_FILTERS.selectedCountryFocus });
    await updateCurrentSearchFilters();
  };

  // Get country names for display and search enhancement
  const getCountryNames = () => {
    const countryNames: string[] = [];
    const countryData = getCountryCodesForRegions(selectedCountryFocus);
    
    countryData.countries.forEach(code => {
      if (COUNTRIES[code] && !countryNames.includes(COUNTRIES[code])) {
        countryNames.push(COUNTRIES[code]);
      }
    });
    
    return countryNames;
  };

  const countryNames = getCountryNames();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Focus className="h-4 w-4 text-purple-500" />
          Country focus
        </div>
        {isCountryFocusFilterActive && (
          <Badge variant="outline" className="text-xs border-purple-500 text-purple-600 dark:text-purple-400">
            Active
          </Badge>
        )}
      </div>

      <div className={cn(
        "rounded-2xl border-2 p-4 transition-all duration-300",
        isCountryFocusFilterActive 
          ? "border-purple-500 bg-purple-50 dark:bg-purple-950/50 shadow-lg" 
          : "border-border bg-background"
      )}>
        <CountrySelector
          selectedRegions={selectedCountryFocus}
          onSelectionChange={handleSelectionChange}
          placeholder="Add country focus to search"
          description="Choose countries to add to your search query"
          showCountryNames={true}
          bypassLimit={true}
        />

        {/* Enhanced search preview */}
        {countryNames.length > 0 && (
          <div className="mt-4 p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800">
            <div className="flex items-start gap-2">
              <Focus className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-purple-900 dark:text-purple-100 mb-1">
                  Search Focus Active
                </p>
                <p className="text-xs text-purple-700 dark:text-purple-300 mb-2">
                  Search results will be enhanced to focus on papers mentioning:
                </p>
                <div className="flex flex-wrap gap-1">
                  {countryNames.slice(0, 10).map((countryName, index) => (
                    <span 
                      key={index}
                      className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-2 py-1 rounded-md"
                    >
                      {countryName}
                    </span>
                  ))}
                  {countryNames.length > 10 && (
                    <span className="text-xs text-purple-600 dark:text-purple-400 px-2 py-1">
                      +{countryNames.length - 10} more
                    </span>
                  )}
                </div>
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">
                  This enhances your search behind the scenes without changing your query text.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Info about the difference */}
      {(isCountryFocusFilterActive || selectedCountryFocus.length > 0) && (
                  <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
            <strong>Tip:</strong> Country focus enhances your search to include papers about these countries, 
            while Institution location filters by author affiliations. Use both for comprehensive results!
          </div>
      )}
    </div>
  );
} 