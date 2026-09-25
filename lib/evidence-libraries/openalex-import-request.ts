import { prepareOpenAlexSearch } from "@/lib/search-utils";
import { createSearchParameters } from "@/lib/utils";
import type { SearchFilters } from "@/lib/types";

export type TopicLevel = "field" | "subfield" | "topic";

/** Filters an import has that the search page does not. */
export type OpenAlexImportExtras = {
  /** All at one level: OpenAlex ORs values of one filter and ANDs different filters. */
  topicLevel: TopicLevel;
  /** Bare OpenAlex ids: "33", "3304", "T13958". */
  topicIds: string[];
  /** SDG numbers, "1" to "17". */
  sdgs: string[];
  openAccessOnly: boolean;
  /** Provider filters on sources configured outside the search workspace. */
  additionalFilters?: Record<string, string>;
};

/**
 * What OpenAlex is asked for an import. Saved as it is, so the library asks
 * the same thing on every update whatever the search code later becomes.
 */
export type OpenAlexImportRequest = {
  search?: string;
  filter: Record<string, unknown>;
};

export const EMPTY_IMPORT_EXTRAS: OpenAlexImportExtras = {
  topicLevel: "subfield",
  topicIds: [],
  sdgs: [],
  openAccessOnly: false,
};

/** The import-only filters in the form `SearchFilters.extraApiFilters` takes. */
export function importExtraApiFilters(extras: OpenAlexImportExtras): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...extras.additionalFilters };
  if (extras.topicIds.length) {
    const ids = extras.topicIds.join("|");
    filter.topics =
      extras.topicLevel === "topic" ? { id: ids } : { [extras.topicLevel]: { id: ids } };
  }
  if (extras.sdgs.length) {
    filter.sustainable_development_goals = {
      id: extras.sdgs.map((goal) => `https://metadata.un.org/sdg/${goal}`).join("|"),
    };
  }
  if (extras.openAccessOnly) filter.open_access = { is_oa: true };
  return filter;
}

export function buildOpenAlexImportRequest(
  query: string,
  filters: SearchFilters,
  extras: OpenAlexImportExtras,
): OpenAlexImportRequest | null {
  const prepared = prepareOpenAlexSearch({
    query,
    filters: { ...filters, extraApiFilters: importExtraApiFilters(extras) },
  });
  if (prepared.finalApiQuery === null) return null;
  const parameters = createSearchParameters(prepared.finalApiQuery, {
    ...prepared.effectiveFilters,
    citesItemId: prepared.effectiveCitesItemId ?? prepared.effectiveFilters.citesItemId,
    relatedToItemId:
      prepared.effectiveRelatedToItemId ?? prepared.effectiveFilters.relatedToItemId,
  });
  return {
    ...(parameters.search ? { search: parameters.search } : {}),
    filter: parameters.filter ?? {},
  };
}
