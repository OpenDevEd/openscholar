/** Minimal shape for extraction result fields used by citation helpers. */
interface ExtractionResultLike {
  citations?: unknown[];
  citationStatus?: string;
}

export type CitationEvidence = {
  evidenceId: string;
  page: number;
  charRange: [number, number];
  quote: string;
  retrieval: {
    denseScore?: number;
    lexicalScore?: number;
    fusedScore?: number;
    rerankScore?: number;
  };
  validated: true;
};

export type CitationStatus =
  | "grounded"
  | "best_effort"
  | "insufficient_evidence"
  | "extraction_error";

export type CitationLocation = {
  evidenceId: string;
  page: number;
  charRange: [number, number];
  text: string;
  validated: true;
  retrieval: {
    denseScore?: number;
    lexicalScore?: number;
    fusedScore?: number;
    rerankScore?: number;
  };
  citationStatus?: CitationStatus;
};

function toCitationEvidence(candidate: unknown): CitationEvidence | null {
  if (!candidate || typeof candidate !== "object") return null;

  const c = candidate as Record<string, unknown>;
  const evidenceId =
    typeof c.evidenceId === "string" ? c.evidenceId.trim() : "";
  const page = Number(c.page);
  const charRange = Array.isArray(c.charRange) ? c.charRange : [];
  const start = Number(charRange[0]);
  const end = Number(charRange[1]);
  const quote = typeof c.quote === "string" ? c.quote.trim() : "";
  const validated = c.validated === true;

  if (
    !evidenceId ||
    !Number.isFinite(page) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    !quote ||
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

  return {
    evidenceId,
    page,
    charRange: [start, end],
    quote,
    retrieval,
    validated: true,
  };
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
  if (!pdfEnabled) return null;
  const citationStatus = getCitationStatus(result);
  const first = getStructuredCitations(result)[0];
  if (!first) return null;

  return {
    evidenceId: first.evidenceId,
    page: first.page,
    charRange: first.charRange,
    text: first.quote,
    validated: true,
    retrieval: first.retrieval,
    citationStatus,
  };
}

export function getAllCitationLocations(result: ExtractionResultLike | null | undefined, pdfEnabled = true): CitationLocation[] {
  if (!pdfEnabled) return [];
  const citationStatus = getCitationStatus(result);
  return getStructuredCitations(result).map((citation) => ({
    evidenceId: citation.evidenceId,
    page: citation.page,
    charRange: citation.charRange,
    text: citation.quote,
    validated: true,
    retrieval: citation.retrieval,
    citationStatus,
  }));
}
