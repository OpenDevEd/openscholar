/**
 * OpenAlex's autocomplete for what a search is filtered by ID: authors, funders, journals
 * (sources) and institutions. The page asks from the Next server (./lookup.ts) and the
 * assistant from Convex (convex/paperSets/openalex.ts); both read the answer here.
 */

import type { SearchSource } from "../search/source";

export type LookupEntity = "authors" | "funders" | "sources" | "institutions";
/** A record found by its name; an institution carries its ROR ID (https://ror.org/…) when asked for and it has one. */
export type LookupOption = { id: string; name: string; detail?: string; ror?: string };

/** The IDs each kind of record has, such as S… on OpenAlex and OSV… on our index for a source. */
export const LOOKUP_ID: Record<LookupEntity, RegExp> = { authors: /^(?:A|OSA)\d+$/, funders: /^F\d+$/, sources: /^(?:S|OSV)\d+$/, institutions: /^I\d+$/ };

/** Only records with papers: OpenAlex keeps empty duplicates beside some, such as a second "Research square". */
export const autocompleteParameters = (query: string, entity: LookupEntity, source: SearchSource): Record<string, string> =>
  // Our index filters its authors and institutions by works, but refuses it on funders and sources.
  source === "openscholar" && (entity === "funders" || entity === "sources") ? { q: query } : { q: query, filter: "works_count:>0" };

/** `ror` keeps an institution's ROR ID, which autocomplete gives as its `external_id`; the assistant's answers leave it out. */
export function autocompleteOptions(body: unknown, { ror = false } = {}): LookupOption[] {
  const results = (body as { results?: unknown } | null)?.results;
  return (Array.isArray(results) ? results : []).flatMap((result: { id?: unknown; display_name?: unknown; hint?: unknown; external_id?: unknown }) =>
    typeof result.id === "string" && typeof result.display_name === "string" && result.display_name
      ? [{
          id: result.id.split("/").at(-1)!,
          name: result.display_name,
          ...(typeof result.hint === "string" && result.hint ? { detail: result.hint } : {}),
          ...(ror && typeof result.external_id === "string" && result.external_id.startsWith("https://ror.org/") ? { ror: result.external_id } : {}),
        }]
      : [],
  );
}

const SOURCE_TYPES: Record<string, string> = {
  journal: "Journal", repository: "Repository", conference: "Conference",
  "book series": "Book series", "ebook platform": "Ebook platform",
};

/** The request that reads the sources' types, which autocomplete leaves out. */
export const sourceTypesParameters = (ids: readonly string[]) => ({ filter: `openalex_id:${ids.join("|")}`, select: "id,type", "per-page": "100" });

/**
 * Each source's type before its publisher, so a repository named like a journal, such as
 * "SSRN Electronic Journal", shows as one.
 */
export function withSourceTypes(options: LookupOption[], body: unknown): LookupOption[] {
  const types = new Map<string, string>();
  const results = (body as { results?: unknown } | null)?.results;
  for (const result of Array.isArray(results) ? results : []) {
    if (typeof result?.id === "string" && typeof result.type === "string") types.set(result.id.split("/").at(-1)!, SOURCE_TYPES[result.type] ?? result.type);
  }
  return options.map((option) => {
    const type = types.get(option.id);
    const detail = [type, option.detail].filter(Boolean).join(", ");
    return { id: option.id, name: option.name, ...(detail ? { detail } : {}) };
  });
}
