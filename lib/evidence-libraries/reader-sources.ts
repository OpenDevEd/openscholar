// An Evidence Library's records as a source for screening and extraction (plans/evidence-library-sources): the rows
// a library lists for a person (convex/evidenceLibraries/library.ts), and what a library search's address filters by.
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

/** A library the person reads: signed in to, opened a hand-off from, or has a role on. */
export type ReaderLibrary = FunctionReturnType<typeof api.evidenceLibraries.readers.list>[number];
/** What one library lists for the person, or why it couldn't. */
export type LibraryContents = FunctionReturnType<typeof api.evidenceLibraries.library.sources>[number];
/** One source in the list: all of a library, a collection, a search or records, with how many records it holds now. */
export type LibraryRow = NonNullable<LibraryContents["rows"]>[number];
/** A library's records as screening and extraction read them. */
export type LibrarySet = { kind: "evidenceLibrary"; libraryId: LibraryRow["libraryId"]; source: LibraryRow["source"] };

/** A source the form holds outside the libraries' lists: one pasted, picked before, or run again, with its library. */
export type HeldRow = { library: Pick<ReaderLibrary, "libraryId" | "name" | "address" | "faviconUrl">; row: LibraryRow };

/**
 * Most records one change to a community collection takes. Here, with nothing heavy beside it, rather than in the
 * client that sends the change (convex/evidenceLibraries/sourceClient.ts), whose zod would load into every
 * screening query that counts against it.
 */
export const LIBRARY_CHANGE_MAX = 500;

/** One key per source, whichever list it came from. */
export const rowKey = (row: Pick<LibraryRow, "libraryId" | "source">) => `${row.libraryId}:${JSON.stringify(row.source)}`;
export const setOfRow = (row: LibraryRow): LibrarySet => ({ kind: "evidenceLibrary", libraryId: row.libraryId, source: row.source });
/** A search or a list of records is frozen to its keys when the job starts; a collection is read as it stands then too. */
export const isFrozen = (row: LibraryRow) => row.what === "search" || row.what === "records";

/**
 * The search page's parameters that decide which records a search finds (new-el RESULT_PARAMS), and the order it
 * shows them in (`sort`), each with the kind of chip it shows as.
 */
export const FILTER_KINDS = ["range", "institution", "country", "author", "collections", "topics", "type", "study", "sort"] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];
/** The library's orders by their keys (new-el SORT_OPTIONS); relevance, its default, shows no chip. */
export const SORTS = ["desc", "asc", "mostCited", "leastCited", "authorAZ", "authorZA", "titleAZ", "titleZA"] as const;

/** A record type as the library names it: journalArticle is "Journal article". */
export const typeName = (type: string) => type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])/g, (_, c: string) => ` ${c.toLowerCase()}`);

/** A search's filters and order, without its words, one chip each. A sort is its key, which the form names. */
export function filtersOf(search: string): Array<{ kind: FilterKind; value: string }> {
  const query = new URLSearchParams(search);
  return FILTER_KINDS.flatMap((kind) =>
    query
      .getAll(kind)
      .flatMap((value) => value.split(","))
      .filter((value) => value && (kind !== "sort" || (SORTS as readonly string[]).includes(value)))
      .map((value) => ({ kind, value: kind === "type" ? typeName(value) : value })),
  );
}

/** The yes or no questions a library's hand-off brought, as screening asks them: what each asks, or its name. */
export const screeningQuestionsOf = (fields: Array<{ label: string; type: string; description: string }>) => fields.filter((field) => field.type === "boolean").map((field) => field.description || field.label);
