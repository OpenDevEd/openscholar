import type { Id } from "@/convex/_generated/dataModel";
import type { CitationLocation, CitationStatus } from "@/lib/extraction/citations";
import { extractionFeatureFlags } from "./feature-flags";

export type CitationPanelPayload = {
  paperId: Id<"extractionPapers">;
  paperTitle: string | null;
  citations: CitationLocation[];
  citationStatus?: CitationStatus;
  answerText: string | null;
  questionText: string | null;
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
}): CitationPanelPayload | null {
  if (!extractionFeatureFlags.pdf) {
    return null;
  }

  if (!params.citations.length) {
    return null;
  }

  return {
    paperId: params.paperId,
    paperTitle: params.paperTitle,
    citations: params.citations,
    citationStatus: params.citationStatus,
    answerText: normalizeAnswerText(params.answer),
    questionText: params.questionText,
  };
}
