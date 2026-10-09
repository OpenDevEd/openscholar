import { COUNTRIES, COUNTRY_NAME_CHANGES, getCountryCodesForRegions } from "../constants";

/** The review filter's terms, which a paper's title or abstract must hold: a classic search string's, and OQL's. */
export const REVIEW_TERMS = '(review OR synthesis OR "meta-analysis")';
export const OQL_REVIEW_TERMS = '(review or synthesis or stemmed "meta-analysis")';

/**
 * A country's name as a text search takes it: without commas, its spaces single.
 */
function cleanCountryNameForAPI(countryName: string): string {
  return countryName
    .replace(/,/g, '') // Remove commas entirely
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * The names a country focus looks for in a paper's title and abstract, each once: every country
 * of the regions and countries chosen, by each name it has gone by. None when no focus is set.
 */
export function countryFocusNames(focus: readonly string[] | undefined): string[] {
  if (!focus || focus.length === 0) return [];
  const countryNames: string[] = [];
  const countryData = getCountryCodesForRegions([...focus], true); // Bypass limit for Country focus
  countryData.countries.forEach(code => {
    if (COUNTRIES[code]) {
      for (const name of COUNTRY_NAME_CHANGES[code] ?? [COUNTRIES[code]]) {
        const cleanedName = cleanCountryNameForAPI(name);
        if (!countryNames.includes(cleanedName)) countryNames.push(cleanedName);
      }
    }
  });
  return countryNames;
}

/**
 * What country focus and the review filter ask of a paper's title and abstract beside a question asked
 * by meaning, which goes as typed: a classic search string, or null when neither is on.
 */
export function semanticTextFilter(filters: { readonly selectedCountryFocus?: readonly string[]; readonly reviewFilter?: boolean }): string | null {
  const names = countryFocusNames(filters.selectedCountryFocus);
  const terms = [
    ...(names.length > 0 ? [`(${names.map((name) => `"${name}"`).join(" OR ")})`] : []),
    ...(filters.reviewFilter ? [REVIEW_TERMS] : []),
  ];
  return terms.length > 0 ? terms.join(" AND ") : null;
}
