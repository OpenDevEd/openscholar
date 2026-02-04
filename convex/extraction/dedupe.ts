const DOI_PREFIX = "https://doi.org/";

function normalizeDoi(doi?: string) {
  if (!doi) return null;
  const trimmed = doi.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(DOI_PREFIX, "");
}

function normalizeTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildDedupeKey(args: {
  openalexId?: string;
  doi?: string;
  title: string;
  year?: number;
}) {
  if (args.openalexId) {
    return `openalex:${args.openalexId}`;
  }
  const normalizedDoi = normalizeDoi(args.doi);
  if (normalizedDoi) {
    return `doi:${normalizedDoi}`;
  }
  const titleKey = normalizeTitle(args.title);
  const yearKey = args.year ? String(args.year) : "";
  return `title:${titleKey}#${yearKey}`;
}
