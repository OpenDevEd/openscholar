import { countActiveFilters, type FilterParams } from "@/lib/filters";

/**
 * Settings that make one chip between them: a year or date range with the switches that say
 * which one is on, and a rating range with "rated papers only". They differ or match together,
 * so a line never keeps a range without the switch its chip needs.
 */
const GROUPS: Array<Array<keyof FilterParams>> = [
  ["yearRange", "dateRange", "filterType", "isYearRangeEnabled"],
  ["ratingRange", "onlyRatedPapers"],
];
/** Settings whose order means something: a range's two ends. Every other list is a set of picks. */
const RANGES = new Set<keyof FilterParams>(["yearRange", "ratingRange"]);

type Search = FilterParams & { query: string };

/** A setting as it's compared: a list of picks in any order is the same list. */
const compared = (key: keyof FilterParams, value: unknown) => (Array.isArray(value) && !RANGES.has(key) ? [...value].map(String).sort() : (value ?? null));

/**
 * What tells a run of searches apart, for a line each: whether they all ran the same query, and
 * each one's settings that aren't the same in all of them. A setting every search shares says
 * nothing about one of them, so it's left to the search's card. None for a search whose own
 * differing settings make no chip: it leaves out what the others set, or keeps a default.
 */
export function differences(searches: Search[]): { sameQuery: boolean; filters: Array<FilterParams | undefined> } {
  const keys = [...new Set(searches.flatMap((search) => Object.keys(search) as Array<keyof Search>))].filter((key): key is keyof FilterParams => key !== "query");
  const grouped = new Set(GROUPS.flat());
  const groups = [...GROUPS, ...keys.filter((key) => !grouped.has(key)).map((key) => [key])];
  const shown = (group: Array<keyof FilterParams>) => searches.map((search) => JSON.stringify(group.map((key) => compared(key, search[key]))));
  const differing = groups.filter((group) => new Set(shown(group)).size > 1).flat();
  return {
    sameQuery: new Set(searches.map((search) => search.query.trim())).size === 1,
    filters: searches.map((search) => {
      const own = Object.fromEntries(differing.map((key) => [key, search[key]])) as FilterParams;
      // The chips' own builder says whether any would show.
      return countActiveFilters(own) > 0 ? own : undefined;
    }),
  };
}
