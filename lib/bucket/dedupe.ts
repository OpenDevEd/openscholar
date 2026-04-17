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
