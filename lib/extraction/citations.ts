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

function toCitationEvidence(candidate: any): CitationEvidence | null {
  if (!candidate || typeof candidate !== "object") return null;

  const evidenceId =
    typeof candidate.evidenceId === "string" ? candidate.evidenceId.trim() : "";
  const page = Number(candidate.page);
  const charRange = Array.isArray(candidate.charRange) ? candidate.charRange : [];
  const start = Number(charRange[0]);
  const end = Number(charRange[1]);
  const quote = typeof candidate.quote === "string" ? candidate.quote.trim() : "";
  const validated = candidate.validated === true;

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

  const retrieval =
    candidate.retrieval && typeof candidate.retrieval === "object"
      ? {
          denseScore:
            typeof candidate.retrieval.denseScore === "number"
              ? candidate.retrieval.denseScore
              : undefined,
          lexicalScore:
            typeof candidate.retrieval.lexicalScore === "number"
              ? candidate.retrieval.lexicalScore
              : undefined,
          fusedScore:
            typeof candidate.retrieval.fusedScore === "number"
              ? candidate.retrieval.fusedScore
              : undefined,
          rerankScore:
            typeof candidate.retrieval.rerankScore === "number"
              ? candidate.retrieval.rerankScore
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

export function getStructuredCitations(result: any): CitationEvidence[] {
  if (!result) return [];
  const raw = (result as { citations?: unknown }).citations;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((candidate) => toCitationEvidence(candidate))
    .filter((citation): citation is CitationEvidence => citation !== null);
}

export function getCitationStatus(result: any): CitationStatus | undefined {
  const status = (result as { citationStatus?: string })?.citationStatus;
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

export function getPrimaryCitation(result: any): CitationLocation | null {
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

export function getAllCitationLocations(result: any): CitationLocation[] {
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
