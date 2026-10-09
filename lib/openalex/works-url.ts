import { buildUrl } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { SearchParameters } from "@sickrin/openalex-sdk/dist/src/types/work";
import { openAlexUrl } from "./request-url";
import { SEMANTIC_PARAMETER, SIMILAR_PARAMETER } from "./semantic";

const encoded = (value: unknown): unknown =>
  typeof value === "string" ? encodeURIComponent(value)
  : Array.isArray(value) ? value.map(encoded)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, encoded(inner)]))
  : value;

/**
 * Search parameters with the search text and filter values URL-encoded. The SDK pastes
 * them into its URLs as they are, so a search for "C#" or "R&D" would cut the URL short
 * and drop the key with it. OpenAlex decodes them before reading the filter.
 */
export function withEncodedValues<T extends { search?: string; filter?: object }>(parameters: T): T {
  return { ...parameters, search: encoded(parameters.search), filter: encoded(parameters.filter) } as T;
}

/**
 * A works search URL with OpenScholar's key, from the SDK's search parameters, and a question asked
 * by meaning, which the SDK does not know, as `search.semantic`.
 */
export function worksUrl(parameters: SearchParameters & { semantic?: string; similar?: string }, extra: Record<string, string | undefined> = {}) {
  const { search, searchField, filter, groupBy, sortBy } = withEncodedValues(parameters);
  const asked = { ...extra, [SEMANTIC_PARAMETER]: parameters.semantic, [SIMILAR_PARAMETER]: parameters.similar };
  return openAlexUrl(buildUrl("", "works", search, searchField, filter, groupBy, sortBy), asked);
}
