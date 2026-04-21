const OPENALEX_WORK_ID_RE = /W\d{5,}/;

export function extractOpenalexId(raw: string): string | null {
  const match = raw.match(OPENALEX_WORK_ID_RE);
  return match ? match[0] : null;
}

export function extractOpenalexRef(
  metadata: Record<string, string>,
): string | null {
  const raw = metadata.openalexId ?? metadata.paperId;
  if (!raw) return null;
  return extractOpenalexId(raw) ?? raw;
}
