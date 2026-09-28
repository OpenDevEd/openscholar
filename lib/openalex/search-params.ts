/**
 * Pure builder for the OpenAlex Works API query-string that chat and
 * extraction run. The search, filter and sort come from the stored
 * OpenAlex request the results page made (lib/openalex/works-query.ts);
 * this adds only the page size and the fields the paper mapper reads.
 * No fetch, no env, no Convex deps.
 */

/**
 * An OpenAlex works request: its query-string values, or an OQL query with the
 * filters inside it, which is sent as a POST body because it outgrows a URL.
 */
export type OpenAlexWorksQuery = { search?: string; filter?: string; oql?: string };

const OPENALEX_MAX_PER_PAGE = 200;

/**
 * Exact list of top-level OpenAlex Work fields that
 * `mapOpenAlexWorkToPaperData` reads. Threaded into every Works-search
 * request as `select=` so OpenAlex sends back ~10 KB per work instead
 * of ~80 KB. Adding a new field to the mapper requires adding it here
 * too, otherwise OpenAlex strips it from the response and the mapper
 * silently sees `undefined`.
 */
export const OPENALEX_WORK_SELECT_FIELDS = [
  "id",
  "display_name",
  "doi",
  "publication_year",
  "abstract_inverted_index",
  "authorships",
  "open_access",
  "cited_by_count",
  "primary_location",
  "type",
] as const;

export function buildOpenAlexSearchParams({
  openAlexQuery,
  limit,
}: {
  openAlexQuery: OpenAlexWorksQuery & { sort: string };
  /**
   * Per-request page size: how many papers the user chose to pull. Clamped
   * to OpenAlex's 200-item single-page ceiling; lifting requires cursor
   * pagination (ticketed as P8).
   */
  limit?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (openAlexQuery.search) params.set("search", openAlexQuery.search);
  if (openAlexQuery.filter) params.set("filter", openAlexQuery.filter);
  params.set("sort", openAlexQuery.sort);

  if (limit !== undefined && limit < 1) {
    // A zero/negative limit means "fetch nothing" — a legitimate user
    // signal (CountChip allows paperCount=0). Callers MUST short-circuit
    // the fetch upstream for that case; reaching here is a bug. We throw
    // rather than silently fall back to 200, which used to turn "zero
    // selected" into "up to 200 fetched" and burn API quota.
    throw new Error(
      `buildOpenAlexSearchParams: limit must be >= 1 (received ${limit}); callers should skip the fetch for zero-paper sources`,
    );
  }
  const perPage =
    limit !== undefined
      ? Math.min(OPENALEX_MAX_PER_PAGE, Math.floor(limit))
      : OPENALEX_MAX_PER_PAGE;
  params.set("per-page", String(perPage));

  params.set("select", OPENALEX_WORK_SELECT_FIELDS.join(","));

  return params;
}
