"use client";

import React from 'react';
import { CountrySelector } from "./country-selector";
import { useCountryFilter } from "@/hooks/use-country-filter";
import { useTranslations } from "next-intl";

export function CountryRegionPicker() {
  const tf = useTranslations("searchFilters");
  const { selectedValues, handleSelectionChange } = useCountryFilter('selectedRegions');

  return (
    <CountrySelector
      selectedRegions={selectedValues}
      onSelectionChange={handleSelectionChange}
      label={tf("institutionLocation")}
      placeholder={tf("filterByInstitution")}
    />
  );
} 