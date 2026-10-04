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

/**
 * Exact list of top-level OpenAlex Work fields that
 * `mapOpenAlexWorkToPaperData` reads. Extraction and chat read searches with
 * it as `select=` (convex/extraction/actions.ts), so OpenAlex sends back ~10 KB
 * per work instead of ~80 KB. Adding a new field to the mapper requires adding it here
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
