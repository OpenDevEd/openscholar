/**
 * What a pasted Evidence Library address points at, as a source of records (plans/evidence-library-sources):
 * the search page (`/lib`) as a search with its filters and sort, or with nothing set the whole library, or
 * with only one collection set that collection; a record's page (`/lib/<key>`) as that record; a reader's
 * collection (`/profile/<reader>?collectionId=<id>`) as that collection, with a search inside it when one is set.
 */
export type LibrarySource =
  | { readerCollection: string }
  | { libraryCollection: string }
  | { library: true }
  | { search: string; readerCollection?: string }
  | { records: string[] };

/** Why an address is no source: not a web address, a reader's profile without a collection, a page that holds no records, or no record's address. */
export type SourceAddressError = "notAddress" | "profile" | "unknownPage" | "notFound";
/** Most records a library source gives at once: what a frozen search holds, as a complete export does (new-el LIBRARY_EXPORT_RECORD_CAP). */
export const LIBRARY_SOURCE_MAX = 20_000;

export type SourceAddress = { origin: string; source: LibrarySource } | { error: SourceAddressError };

/** The search page's parameters that decide its results, as new-el's `RESULT_PARAMS` lists them. */
const RESULT_PARAMS = ["search", "scope", "range", "institution", "country", "author", "collections", "topics", "type", "study"];
/** What the library's own search keeps: its results, and their order. */
const KEPT_PARAMS = [...RESULT_PARAMS, "sort"];
const RECORD_KEY = /^[A-Z0-9]{8}$/;
const LOCALE = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/;

/** The search the page's address makes, without the page it was on or where the reader came from. */
function searchOf(params: URLSearchParams) {
  const kept = new URLSearchParams();
  for (const [name, value] of params) if (KEPT_PARAMS.includes(name) && value) kept.append(name, value);
  return kept;
}

const hasResults = (params: URLSearchParams) => RESULT_PARAMS.some((name) => params.get(name));

export function parseSourceAddress(address: string): SourceAddress {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address.trim()) ? address.trim() : `https://${address.trim()}`);
  } catch {
    return { error: "notAddress" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "notAddress" };
  const parts = url.pathname.split("/").filter(Boolean);
  // The library's pages may carry the reader's language first.
  if (parts.length && LOCALE.test(parts[0]!) && (parts[1] === "lib" || parts[1] === "profile")) parts.shift();
  const search = searchOf(url.searchParams);
  const origin = url.origin;
  if (parts[0] === "lib" && parts.length === 2) {
    return RECORD_KEY.test(parts[1]!) ? { origin, source: { records: [parts[1]!] } } : { error: "notFound" };
  }
  if ((parts[0] === "lib" && parts.length === 1) || parts.length === 0) {
    const collections = search.getAll("collections").flatMap((value) => value.split(",")).filter(Boolean);
    const onlyCollection = collections.length === 1 && RESULT_PARAMS.every((name) => name === "collections" || !search.get(name));
    if (onlyCollection) return { origin, source: { libraryCollection: collections[0]! } };
    return hasResults(search) ? { origin, source: { search: search.toString() } } : { origin, source: { library: true } };
  }
  if (parts[0] === "profile" && parts.length === 2) {
    const collectionId = url.searchParams.get("collectionId");
    // A reader's bookmarks are theirs alone.
    if (!collectionId) return { error: "profile" };
    return hasResults(search) ? { origin, source: { search: search.toString(), readerCollection: collectionId } } : { origin, source: { readerCollection: collectionId } };
  }
  return { error: "unknownPage" };
}
