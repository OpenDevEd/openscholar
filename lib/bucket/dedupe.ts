const DOI_PREFIX = "https://doi.org/";
const OPENALEX_PREFIX = "https://openalex.org/";

function normalizeOpenalexId(openalexId?: string): string | null {
  if (!openalexId) return null;
  const trimmed = openalexId.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(OPENALEX_PREFIX)) {
    const rest = trimmed.slice(OPENALEX_PREFIX.length);
    return rest || null;
  }
  return trimmed;
}

function normalizeDoi(doi?: string): string | null {
  if (!doi) return null;
  const trimmed = doi.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(DOI_PREFIX, "");
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export type DedupeKeyInput = {
  openalexId?: string;
  doi?: string;
  title?: string;
  year?: number;
};

/** Every identifier a paper is matched to another by, strongest first: its OpenAlex work, its DOI, its title and year. */
export function dedupeKeys(args: DedupeKeyInput): string[] {
  const work = normalizeOpenalexId(args.openalexId);
  const doi = normalizeDoi(args.doi);
  const title = args.title?.trim() ? `title:${normalizeTitle(args.title)}#${args.year ? String(args.year) : ""}` : null;
  return [work ? `openalex:${work}` : null, doi ? `doi:${doi}` : null, title].filter((key): key is string => key !== null);
}

/** A paper's strongest identifier, which the bucket keys it by. */
export function buildDedupeKey(args: DedupeKeyInput): string {
  const [key] = dedupeKeys(args);
  if (!key) throw new Error("buildDedupeKey requires at least one of openalexId, doi, or title");
  return key;
}

/**
 * Whether two papers' identifiers (`dedupeKeys`) say they are one paper: the strongest identifier both have agrees.
 * A copy that shares only a DOI with another is that paper; two papers with one title and year but different DOIs are two.
 */
export function samePaper(a: string[], b: string[]): boolean {
  for (const kind of ["openalex:", "doi:", "title:"]) {
    const ours = a.find((key) => key.startsWith(kind));
    const theirs = b.find((key) => key.startsWith(kind));
    if (ours && theirs) return ours === theirs;
  }
  return false;
}

/**
 * Dedupe bucket items by their precomputed `bucketKey`.
 *
 * The client store already keys rows by `bucketKey`, so a correct
 * server-side dedupe must honor the same identity. Rebuilding a key
 * from bibliographic fields (openalexId/doi/title/year) collapses
 * saved-search placeholders that share a query title but differ in
 * filters (yearRange, regions, reviewOnly), because those placeholders
 * carry no openalexId/doi/year — their identity lives in `bucketKey =
 * history:${savedSearchId}` and in `searchFilters`, neither of which
 * the bibliographic builder sees.
 *
 * Insertion order is preserved — first occurrence wins.
 */
export function dedupeBucketItems<T extends { bucketKey: string }>(
  items: ReadonlyArray<T>,
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    if (seen.has(item.bucketKey)) continue;
    seen.add(item.bucketKey);
    deduped.push(item);
  }
  return deduped;
}
