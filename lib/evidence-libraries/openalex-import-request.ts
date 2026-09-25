import { prepareOpenAlexSearch } from "@/lib/search-utils";
import { createSearchParameters } from "@/lib/utils";
import type { SearchFilters } from "@/lib/types";

export type TopicLevel = "domain" | "field" | "subfield" | "topic";

/** Catalog ids carry their level: "fields/33", "subfields/3304", "T13958". */
export function topicLevelOf(id: string): TopicLevel {
  return id.startsWith("T") ? "topic" : (id.split("/")[0].slice(0, -1) as TopicLevel);
}

/** Filters an import has that the search page does not. */
export type OpenAlexImportExtras = {
  /**
   * Catalog ids of any level. OpenAlex ORs values of one filter and ANDs
   * different filters, so areas of one level widen and levels narrow.
   */
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
  topicIds: [],
  sdgs: [],
  openAccessOnly: false,
};

/** The import-only filters in the form `SearchFilters.extraApiFilters` takes. */
export function importExtraApiFilters(extras: OpenAlexImportExtras): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...extras.additionalFilters };
  if (extras.topicIds.length) {
    const topics: Record<string, unknown> = {};
    for (const id of extras.topicIds) {
      const level = topicLevelOf(id);
      const bare = id.split("/").at(-1)!;
      if (level === "topic") topics.id = topics.id ? `${topics.id}|${bare}` : bare;
      else {
        const previous = (topics[level] as { id: string } | undefined)?.id;
        topics[level] = { id: previous ? `${previous}|${bare}` : bare };
      }
    }
    filter.topics = topics;
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
