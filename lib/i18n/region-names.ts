/**
 * Localized display names for countries and regions using Intl.DisplayNames.
 * Supports ISO 3166-1 country codes (e.g. US, FR) and UN M49 region codes.
 */

import { toBcp47Locale } from "./locale-map";
import { COUNTRIES } from "@/lib/constants";

/**
 * Map internal region IDs (lowercase with underscores) to UN M49 codes.
 * Intl.DisplayNames supports both ISO 3166-1 and UN M49 codes for type "region".
 */
const REGION_ID_TO_UN_M49: Record<string, string> = {
  // Continents
  africa: "002",
  americas: "019",
  asia: "142",
  europe: "150",
  oceania: "009",
  antarctica: "010",

  // Africa sub-regions
  eastern_africa: "014",
  middle_africa: "017",
  northern_africa: "015",
  southern_africa: "018",
  western_africa: "011",

  // Americas sub-regions
  caribbean: "029",
  central_america: "013",
  north_america: "021",
  south_america: "005",

  // Asia sub-regions
  central_asia: "143",
  eastern_asia: "030",
  "south-eastern_asia": "035",
  southern_asia: "034",
  western_asia: "145",

  // Europe sub-regions
  eastern_europe: "151",
  northern_europe: "154",
  southern_europe: "039",
  western_europe: "155",

  // Oceania sub-regions
  australia_and_new_zealand: "053",
  melanesia: "054",
  micronesia: "057",
  polynesia: "061",
};

/** Fallback for codes Intl.DisplayNames may not support (e.g. XK for Kosovo) */
const FALLBACK_COUNTRY_NAMES: Record<string, string> = {
  XK: "Kosovo",
  AN: "Netherlands Antilles",
};

/** Translation function type for region names (e.g. from useTranslations("searchFilters")) */
export type RegionNameTranslator = (key: string) => string;

/**
 * Get localized display name for a country code or region ID.
 * @param codeOrRegionId - ISO 3166-1 alpha-2 country code (e.g. "US") or internal region ID (e.g. "eastern_africa")
 * @param locale - next-intl locale (e.g. "en-US", "zh")
 * @param tRegion - Optional next-intl translator for region names (use when Intl fails e.g. "regionNames.eastern_africa")
 * @returns Localized display name, or fallback/raw if not found
 */
export function getRegionDisplayName(
  codeOrRegionId: string,
  locale: string,
  tRegion?: RegionNameTranslator
): string {
  const bcp47 = toBcp47Locale(locale);
  const regionNames = new Intl.DisplayNames([bcp47], { type: "region" });

  // Country code (2-letter uppercase)
  if (codeOrRegionId.length === 2) {
    const code = codeOrRegionId.toUpperCase();
    if (COUNTRIES[code] || FALLBACK_COUNTRY_NAMES[code]) {
      try {
        const name = regionNames.of(code);
        if (name) return name;
      } catch {
        // Intl may not support some codes (e.g. XK)
      }
      return FALLBACK_COUNTRY_NAMES[code] ?? COUNTRIES[code] ?? code;
    }
  }

  // Region ID (lowercase with underscores)
  const lowerId = codeOrRegionId.toLowerCase();
  const unM49 = REGION_ID_TO_UN_M49[lowerId];
  if (unM49) {
    try {
      const name = regionNames.of(unM49);
      // Browsers may return the raw code (e.g. "014") instead of localized name - skip if so
      if (name && name !== unM49 && !/^\d+$/.test(name)) {
        return name;
      }
    } catch {
      // Fall through to fallback
    }

    // Use next-intl translations when Intl fails (e.g. browser returns raw UN M49 code)
    if (tRegion) {
      const translated = tRegion(`regionNames.${lowerId}`);
      if (translated && translated !== `regionNames.${lowerId}`) {
        return translated;
      }
    }
  }

  // Fallback: format region ID as title case (e.g. eastern_africa → Eastern Africa)
  return lowerId
    .split(/[_\-\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
