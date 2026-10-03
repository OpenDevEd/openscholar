"use client";

import React, { useMemo } from 'react';
import { Focus } from "@/components/icons";
import { useTranslations, useLocale } from "next-intl";
import { isCountryFocusActive } from "@/lib/utils";
import { COUNTRIES, getCountryCodesForRegions } from "@/lib/constants";
import { CountrySelector } from "./country-selector";
import { useCountryFilter } from "@/hooks/use-country-filter";
import { getRegionDisplayName } from "@/lib/i18n/region-names";

export function CountryFocusPicker() {
  const locale = useLocale();
  const tf = useTranslations("searchFilters");
  const { selectedValues, handleSelectionChange } = useCountryFilter('selectedCountryFocus');

  // Computed filter active state
  const isCountryFocusFilterActive = isCountryFocusActive(selectedValues);

  // Get country names for display and search enhancement (localized)
  const countryNames = useMemo(() => {
    const names: string[] = [];
    const countryData = getCountryCodesForRegions(selectedValues);

    countryData.countries.forEach((code) => {
      if (COUNTRIES[code]) {
        const name = getRegionDisplayName(code, locale, (k) => (tf as (key: string) => string)(k));
        if (!names.includes(name)) {
          names.push(name);
        }
      }
    });

    return names;
  }, [selectedValues, locale, tf]);

  return (
    <div className="space-y-3">
      <CountrySelector
        selectedRegions={selectedValues}
        onSelectionChange={handleSelectionChange}
        placeholder={tf("addCountryFocus")}
        description={tf("chooseCountriesToAdd")}
        showCountryNames={true}
        bypassLimit={true}
      />

      {/* Enhanced search preview */}
      {countryNames.length > 0 && (
        <div className="p-3 bg-sidebar-accent/50 rounded-lg border border-border-subtle">
          <div className="flex items-start gap-2">
            <Focus className="h-4 w-4 text-sidebar-primary mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground mb-1">
                {tf("searchFocusActive")}
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                {tf("searchFocusDescription")}
              </p>
              <div className="flex flex-wrap gap-1">
                {countryNames.slice(0, 10).map((countryName) => (
                  <span 
                    key={countryName}
                    className="text-xs bg-sidebar-accent text-sidebar-primary px-2 py-1 rounded-md border border-border-subtle"
                  >
                    {countryName}
                  </span>
                ))}
                {countryNames.length > 10 && (
                  <span className="text-xs text-muted-foreground px-2 py-1">
                    {tf("nMore", { count: countryNames.length - 10 })}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {tf("enhancesSearchBehindScenes")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Info about the difference */}
      {(isCountryFocusFilterActive || selectedValues.length > 0) && (
        <div className="text-xs text-muted-foreground bg-inset p-3 rounded-lg">
          {tf("countryFocusTip")}
        </div>
      )}
    </div>
  );
} 