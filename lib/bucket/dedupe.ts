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

export function buildDedupeKey(args: DedupeKeyInput): string {
  const normalizedOa = normalizeOpenalexId(args.openalexId);
  if (normalizedOa) {
    return `openalex:${normalizedOa}`;
  }
  const normalizedDoi = normalizeDoi(args.doi);
  if (normalizedDoi) {
    return `doi:${normalizedDoi}`;
  }
  if (args.title && args.title.trim()) {
    const titleKey = normalizeTitle(args.title);
    const yearKey = args.year ? String(args.year) : "";
    return `title:${titleKey}#${yearKey}`;
  }
  throw new Error(
    "buildDedupeKey requires at least one of openalexId, doi, or title",
  );
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
