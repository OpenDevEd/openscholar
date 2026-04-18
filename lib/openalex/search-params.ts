/**
 * Pure builder for the OpenAlex Works API query-string. Takes the
 * history-style `SearchFilters` object used by
 * `internal.extraction.actions.fetchPapersFromHistory` and returns a
 * fully-populated `URLSearchParams`. No fetch, no env, no Convex deps —
 * lifted out of the action so the wire format can be unit-tested
 * independently of the action runtime.
 *
 * See https://docs.openalex.org/how-to-use-the-api/get-lists-of-entities
 * for the filter/sort grammar.
 */

export type OpenAlexSearchFilters = {
  query: string;
  field?: string;
  yearRange?: [number, number];
  dateRange?: { from?: string; to?: string };
  sortBy?: string;
  selectedRegions?: string[];
  selectedCountryFocus?: string[];
  reviewFilter?: boolean;
  searchField?: string;
  citesItemId?: string;
  citedByItemId?: string;
  relatedToItemId?: string;
  /**
   * Per-request page size. When the caller (today: the P7 CountChip
   * via `searchFilters.limit`) knows how many papers the user chose to
   * pull, thread it in here so OpenAlex returns exactly that many in
   * one request. Clamped to OpenAlex's 200-item single-page ceiling;
   * lifting requires cursor pagination (ticketed as P8).
   */
  limit?: number;
};

const OPENALEX_MAX_PER_PAGE = 200;

const OPENALEX_ID_PREFIX = "https://openalex.org/";

function qualifyOpenAlexId(id: string): string {
  return id.startsWith(OPENALEX_ID_PREFIX) ? id : `${OPENALEX_ID_PREFIX}${id}`;
}

function searchFieldFilter(
  searchField: string | undefined,
  query: string,
): string | null {
  switch (searchField) {
    case "title_and_abstract":
      return `title_and_abstract.search:${query}`;
    case "title":
      return `title.search:${query}`;
    case "abstract":
      return `abstract.search:${query}`;
    case "fulltext":
      return `fulltext.search:${query}`;
    case "display_name":
      return `display_name.search:${query}`;
    default:
      return null;
  }
}

export function buildOpenAlexSearchParams(
  filters: OpenAlexSearchFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  const filterParts: string[] = [];

  if (filters.query) {
    const fieldFilter = searchFieldFilter(filters.searchField, filters.query);
    if (fieldFilter) {
      filterParts.push(fieldFilter);
    } else {
      params.set("search", filters.query);
    }
  }

  // yearRange is only applied when neither dateRange bound is set —
  // dateRange takes precedence because it's strictly more precise.
  if (
    filters.yearRange &&
    !filters.dateRange?.from &&
    !filters.dateRange?.to
  ) {
    filterParts.push(
      `publication_year:${filters.yearRange[0]}-${filters.yearRange[1]}`,
    );
  }
  if (filters.dateRange?.from) {
    filterParts.push(`from_publication_date:${filters.dateRange.from}`);
  }
  if (filters.dateRange?.to) {
    filterParts.push(`to_publication_date:${filters.dateRange.to}`);
  }

  if (filters.reviewFilter) {
    filterParts.push("type:review");
  }

  if (filters.selectedCountryFocus && filters.selectedCountryFocus.length > 0) {
    filterParts.push(`countries:${filters.selectedCountryFocus.join("|")}`);
  }
  if (filters.selectedRegions && filters.selectedRegions.length > 0) {
    filterParts.push(`regions:${filters.selectedRegions.join("|")}`);
  }

  if (filters.citesItemId) {
    filterParts.push(`cites:${qualifyOpenAlexId(filters.citesItemId)}`);
  }
  if (filters.citedByItemId) {
    filterParts.push(`cited_by:${qualifyOpenAlexId(filters.citedByItemId)}`);
  }
  if (filters.relatedToItemId) {
    filterParts.push(`related_to:${qualifyOpenAlexId(filters.relatedToItemId)}`);
  }

  if (filterParts.length > 0) {
    params.set("filter", filterParts.join(","));
  }

  if (filters.sortBy) {
    const [field, order] = filters.sortBy.split(":");
    params.set("sort", `${field}:${order || "desc"}`);
  }

  if (filters.limit !== undefined && filters.limit < 1) {
    // A zero/negative limit means "fetch nothing" — a legitimate user
    // signal (CountChip allows paperCount=0). Callers MUST short-circuit
    // the fetch upstream for that case; reaching here is a bug. We throw
    // rather than silently fall back to 200, which used to turn "zero
    // selected" into "up to 200 fetched" and burn API quota.
    throw new Error(
      `buildOpenAlexSearchParams: limit must be >= 1 (received ${filters.limit}); callers should skip the fetch for zero-paper sources`,
    );
  }
  const perPage =
    filters.limit !== undefined
      ? Math.min(OPENALEX_MAX_PER_PAGE, Math.floor(filters.limit))
      : OPENALEX_MAX_PER_PAGE;
  params.set("per-page", String(perPage));

  return params;
}
