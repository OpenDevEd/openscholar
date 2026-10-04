import type { Id } from "@/convex/_generated/dataModel";
import type { CitationLocation, CitationStatus } from "@/lib/extraction/citations";

export type CitationPanelPayload = {
  paperId: Id<"extractionPapers">;
  paperTitle: string | null;
  citations: CitationLocation[];
  citationStatus?: CitationStatus;
  answerText: string | null;
  questionText: string | null;
  abstract?: string;
};

function normalizeAnswerText(answer: unknown): string | null {
  if (answer === null || answer === undefined) {
    return null;
  }

  if (Array.isArray(answer)) {
    const strings = answer.filter((item): item is string => typeof item === "string");
    if (!strings.length) return null;
    return strings.sort((a, b) => b.length - a.length)[0] || null;
  }

  if (typeof answer === "boolean") {
    return answer ? "Yes" : "No";
  }

  if (typeof answer === "number") {
    return Number.isFinite(answer) ? String(answer) : null;
  }

  if (typeof answer === "string") {
    return answer;
  }

  return null;
}

export function buildCitationPanelPayload(params: {
  paperId: Id<"extractionPapers">;
  paperTitle: string | null;
  citations: CitationLocation[];
  citationStatus?: CitationStatus;
  answer: unknown;
  questionText: string | null;
  pdfEnabled?: boolean;
  abstract?: string;
}): CitationPanelPayload | null {
  const citations = params.citations.filter(citation => params.pdfEnabled !== false || citation.source === "abstract");
  if (!citations.length) {
    return null;
  }

  return {
    paperId: params.paperId,
    paperTitle: params.paperTitle,
    citations,
    abstract: params.abstract,
    citationStatus: params.citationStatus,
    answerText: normalizeAnswerText(params.answer),
    questionText: params.questionText,
  };
}
