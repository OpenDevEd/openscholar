/** Bibliographic identifiers, never labels, define cross-library identity. */
export function normalizeDoi(value: string | null): string | null {
  if (!value) return null;
  const doi = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim().toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}
export function publicationGroupKey(libraryId: string, itemKey: string, doi: string | null, openalexId: string | null, linkedDois: string[]) {
  if (doi) return `doi:${doi}`;
  if (openalexId) return linkedDois.length === 1 ? `doi:${linkedDois[0]}` : `openalex:${openalexId}`;
  return `record:${libraryId}:${itemKey}`;
}
