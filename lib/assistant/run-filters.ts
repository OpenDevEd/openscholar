import type { FilterParams } from "@/lib/filters";

/**
 * Settings that make one chip between them: a year or date range with the switches that say
 * which one is on, and a rating range with "rated papers only". They differ or match together,
 * so a line never keeps a range without the switch its chip needs.
 */
const GROUPS: Array<Array<keyof FilterParams>> = [
  ["yearRange", "dateRange", "filterType", "isYearRangeEnabled"],
  ["ratingRange", "onlyRatedPapers"],
];

/** Switches that make no chip of their own: they only say which range is on. */
const SWITCHES = new Set<keyof FilterParams>(["filterType", "isYearRangeEnabled"]);

type Search = FilterParams & { query: string };

/**
 * What tells a run of searches apart, for a line each: whether they all ran the same query, and
 * each one's settings that aren't the same in all of them. A setting every search shares says
 * nothing about one of them, so it's left to the search's card. None for a search that differs
 * only by leaving out what the others set.
 */
export function differences(searches: Search[]): { sameQuery: boolean; filters: Array<FilterParams | undefined> } {
  const keys = [...new Set(searches.flatMap((search) => Object.keys(search) as Array<keyof Search>))].filter((key) => key !== "query");
  const grouped = new Set(GROUPS.flat());
  const groups = [...GROUPS, ...keys.filter((key) => !grouped.has(key as keyof FilterParams)).map((key) => [key as keyof FilterParams])];
  const shown = (group: Array<keyof FilterParams>) => searches.map((search) => JSON.stringify(group.map((key) => search[key] ?? null)));
  const differing = groups.filter((group) => new Set(shown(group)).size > 1).flat();
  return {
    sameQuery: new Set(searches.map((search) => search.query.trim())).size === 1,
    filters: searches.map((search) => {
      const own = differing.filter((key) => !unset(search[key]));
      return own.some((key) => !SWITCHES.has(key)) ? (Object.fromEntries(own.map((key) => [key, search[key]])) as FilterParams) : undefined;
    }),
  };
}

/** A setting left at nothing: no chip comes of it. */
const unset = (value: unknown) => value === undefined || value === null || value === false || value === "" || (Array.isArray(value) && !value.length);
