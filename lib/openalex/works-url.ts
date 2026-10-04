import { buildUrl } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { SearchParameters } from "@sickrin/openalex-sdk/dist/src/types/work";
import { openAlexUrl } from "./request-url";

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

/** A works search URL with OpenScholar's key, from the SDK's search parameters. */
export function worksUrl(parameters: SearchParameters, extra: Record<string, string | undefined> = {}) {
  const { search, searchField, filter, groupBy, sortBy } = withEncodedValues(parameters);
  return openAlexUrl(buildUrl("", "works", search, searchField, filter, groupBy, sortBy), extra);
}
