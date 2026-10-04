import type { SourceCitation } from "./source-evidence";

/** Minimal shape for extraction result fields used by citation helpers. */
interface ExtractionResultLike {
  citations?: unknown[];
  citationStatus?: string;
}

export type CitationEvidence = SourceCitation;

export type CitationStatus =
  | "grounded"
  | "best_effort"
  | "insufficient_evidence"
  | "extraction_error";

type DisplayCitation<T> = T extends SourceCitation ? Omit<T, "quote"> & { text: string; citationStatus?: CitationStatus } : never;
export type CitationLocation = DisplayCitation<SourceCitation>;

function toCitationEvidence(candidate: unknown): CitationEvidence | null {
  if (!candidate || typeof candidate !== "object") return null;

  const c = candidate as Record<string, unknown>;
  const evidenceId =
    typeof c.evidenceId === "string" ? c.evidenceId.trim() : "";
  const page = Number(c.page);
  const charRange = Array.isArray(c.charRange) ? c.charRange : [];
  const start = Number(charRange[0]);
  const end = Number(charRange[1]);
  const quote = typeof c.quote === "string" ? c.quote : "";
  const validated = c.validated === true;

  if (
    !evidenceId ||
    (c.source !== "abstract" && (!Number.isInteger(page) || page < 1)) ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 || end <= start || charRange.length !== 2 ||
    !quote.trim() ||
    !validated
  ) {
    return null;
  }

  const rawRetrieval = c.retrieval;
  const retrieval =
    rawRetrieval && typeof rawRetrieval === "object"
      ? {
          denseScore:
            typeof (rawRetrieval as Record<string, unknown>).denseScore === "number"
              ? ((rawRetrieval as Record<string, unknown>).denseScore as number)
              : undefined,
          lexicalScore:
            typeof (rawRetrieval as Record<string, unknown>).lexicalScore === "number"
              ? ((rawRetrieval as Record<string, unknown>).lexicalScore as number)
              : undefined,
          fusedScore:
            typeof (rawRetrieval as Record<string, unknown>).fusedScore === "number"
              ? ((rawRetrieval as Record<string, unknown>).fusedScore as number)
              : undefined,
          rerankScore:
            typeof (rawRetrieval as Record<string, unknown>).rerankScore === "number"
              ? ((rawRetrieval as Record<string, unknown>).rerankScore as number)
              : undefined,
        }
      : {};

  const shared = {
    evidenceId,
    charRange: [start, end] as [number, number],
    quote,
    retrieval,
    validated: true as const,
  };
  if (c.source === "abstract") return typeof c.paperId === "string" && typeof c.sourceHash === "string" && c.paperId && c.sourceHash && c.page === undefined ? { ...shared, source: "abstract", paperId: c.paperId, sourceHash: c.sourceHash } : null;
  if (c.source !== undefined && c.source !== "pdf") return null;
  return { ...shared, page, ...(c.source === "pdf" ? { source: "pdf" as const } : {}), ...(typeof c.paperId === "string" ? { paperId: c.paperId } : {}), ...(typeof c.sourceHash === "string" ? { sourceHash: c.sourceHash } : {}) };
}

export function getStructuredCitations(result: ExtractionResultLike | null | undefined): CitationEvidence[] {
  if (!result) return [];
  const raw = result.citations;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((candidate) => toCitationEvidence(candidate))
    .filter((citation): citation is CitationEvidence => citation !== null);
}

export function getCitationStatus(result: ExtractionResultLike | null | undefined): CitationStatus | undefined {
  const status = result?.citationStatus;
  if (
    status === "grounded" ||
    status === "best_effort" ||
    status === "insufficient_evidence" ||
    status === "extraction_error"
  ) {
    return status;
  }
  return undefined;
}

export function getPrimaryCitation(result: ExtractionResultLike | null | undefined, pdfEnabled = true): CitationLocation | null {
  return getAllCitationLocations(result, pdfEnabled)[0] ?? null;
}

export function getAllCitationLocations(result: ExtractionResultLike | null | undefined, pdfEnabled = true): CitationLocation[] {
  const citationStatus = getCitationStatus(result);
  return getStructuredCitations(result).filter(citation => pdfEnabled || citation.source === "abstract").map(({ quote, ...citation }) => ({ ...citation, text: quote, citationStatus }));
}
