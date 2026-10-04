/**
 * Pure evidence-policy helpers extracted from convex/extraction/workpoolActions.ts.
 *
 * These functions decide what an LLM extraction is allowed to emit —
 * grounded vs best-effort vs insufficient-evidence — and how abstract-only
 * answers are rated. None of them touch Convex context, so they live in
 * lib/ where both the default-runtime and node-runtime can consume them.
 */

import {
  isGenericArrayEntity,
  splitArrayFragments,
} from "./analysis";
import type { SourceCitation } from "./source-evidence";

export type CitationStatus =
  | "grounded"
  | "best_effort"
  | "insufficient_evidence"
  | "extraction_error";

export type Citation = SourceCitation;

export type RetrievalDiagnostics = {
  denseCandidates: number;
  lexicalCandidates: number;
  fusedCandidates: number;
  rerankedCandidates: number;
  validatedCitations: number;
  strictNull: boolean;
};

export type ExtractionQuestionResult = {
  questionKey: string;
  answer: string | boolean | number | string[] | null;
  confidence?: number;
  modelConfidence?: number;
  reasoning?: string;
  citations: Citation[];
  citationStatus: CitationStatus;
  retrievalDiagnostics: RetrievalDiagnostics;
  pdfContentUsed?: boolean;
};

export type EvidenceUnitDoc = {
  evidenceId: string;
  page: number;
  charRange: [number, number];
  text: string;
  section?: string;
  tokens: string[];
  anchorConfidence: number;
  source: string;
};

export type RetrievalCandidate = {
  unit: EvidenceUnitDoc;
  denseScore?: number;
  lexicalScore?: number;
  fusedScore?: number;
  rerankScore?: number;
};

export type StrictExtractionOutput = {
  answer: string | boolean | number | string[] | null;
  confidence: number;
  reasoning: string;
  supportEvidenceIds: string[];
};

// Confidence-cap + array-normalisation tunables. Kept together so the
// scoring pipeline reads as one unit.
export const BEST_EFFORT_MAX_CITATIONS = 2;
export const BEST_EFFORT_CONFIDENCE_CAP = 0.45;
export const ABSTRACT_ONLY_CONFIDENCE_CAP = 0.7;
export const STRICT_NULL_CONFIDENCE_CAP = 0.3;
export const ARRAY_ANSWER_MAX_ITEMS = 8;
export const ARRAY_GENERIC_PENALTY = 0.15;
export const ARRAY_GENERIC_THRESHOLD = 0.6;

export function dedupeEvidenceIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

export function sanitizeArrayAnswer(
  answer: string[] | string | null | undefined,
): { answer: string[] | null; genericShare: number } {
  if (answer === null || answer === undefined) {
    return { answer: null, genericShare: 0 };
  }

  const values = Array.isArray(answer) ? answer : [answer];
  const normalized = new Set<string>();
  for (const value of values) {
    for (const token of splitArrayFragments(String(value))) {
      normalized.add(token);
    }
  }

  const cleaned = Array.from(normalized)
    .sort()
    .slice(0, ARRAY_ANSWER_MAX_ITEMS);
  if (cleaned.length === 0) {
    return { answer: null, genericShare: 0 };
  }

  const genericCount = cleaned.filter((value) =>
    isGenericArrayEntity(value),
  ).length;
  return {
    answer: cleaned,
    genericShare: genericCount / cleaned.length,
  };
}

export function normalizeExtractionOutputForQuestion(
  questionType: "string" | "boolean" | "number" | "array",
  extracted: StrictExtractionOutput,
): StrictExtractionOutput {
  if (questionType !== "array") {
    return extracted;
  }

  const sanitized = sanitizeArrayAnswer(
    Array.isArray(extracted.answer) || typeof extracted.answer === "string"
      ? (extracted.answer as string[] | string)
      : null,
  );

  const shouldPenalize =
    sanitized.answer !== null && sanitized.genericShare >= ARRAY_GENERIC_THRESHOLD;
  const confidence = shouldPenalize
    ? Math.max(0, extracted.confidence - ARRAY_GENERIC_PENALTY)
    : extracted.confidence;

  return {
    ...extracted,
    answer: sanitized.answer,
    confidence: Math.min(1, confidence),
  };
}

export function validateSupportEvidenceIds(
  supportEvidenceIds: string[],
  evidencePool: RetrievalCandidate[],
): RetrievalCandidate[] {
  const byId = new Map<string, RetrievalCandidate>();
  for (const candidate of evidencePool) {
    byId.set(candidate.unit.evidenceId, candidate);
  }

  const valid: RetrievalCandidate[] = [];
  for (const id of dedupeEvidenceIds(supportEvidenceIds)) {
    const found = byId.get(id);
    if (!found) continue;
    valid.push(found);
  }
  return valid;
}

export function applyEvidencePolicy(params: {
  extracted: StrictExtractionOutput;
  validated: RetrievalCandidate[];
  fallbackCandidates: RetrievalCandidate[];
}): {
  answer: string | boolean | number | string[] | null;
  confidence: number;
  citationStatus: CitationStatus;
  strictNull: boolean;
  selectedCandidates: RetrievalCandidate[];
} {
  if (params.extracted.answer !== null && params.validated.length > 0) {
    return {
      answer: params.extracted.answer,
      confidence: params.extracted.confidence,
      citationStatus: "grounded",
      strictNull: false,
      selectedCandidates: params.validated,
    };
  }

  const hasCandidateFallback = params.fallbackCandidates.length > 0;
  if (params.extracted.answer !== null && hasCandidateFallback) {
    return {
      answer: params.extracted.answer,
      confidence: Math.min(
        params.extracted.confidence,
        BEST_EFFORT_CONFIDENCE_CAP,
      ),
      citationStatus: "best_effort",
      strictNull: false,
      selectedCandidates: params.fallbackCandidates.slice(
        0,
        BEST_EFFORT_MAX_CITATIONS,
      ),
    };
  }

  return {
    answer: null,
    confidence: Math.min(params.extracted.confidence, STRICT_NULL_CONFIDENCE_CAP),
    citationStatus: "insufficient_evidence",
    strictNull: true,
    selectedCandidates: [],
  };
}

export function isUsableAbstract(
  abstract: string | null | undefined,
  minAbstractLength: number,
): boolean {
  return typeof abstract === "string" && abstract.trim().length > minAbstractLength;
}

export function applyAbstractOnlyPolicy(params: {
  extracted: StrictExtractionOutput;
  pdfEnabled: boolean;
  validatedCount: number;
}): {
  answer: string | boolean | number | string[] | null;
  confidence: number;
  citationStatus: CitationStatus;
  strictNull: boolean;
} {
  const pdfDisabled = !params.pdfEnabled;

  if (params.extracted.answer !== null) {
    // Cap the adjusted confidence when PDF evidence was requested but unavailable.
    return {
      answer: params.extracted.answer,
      confidence: pdfDisabled || params.validatedCount > 0
        ? params.extracted.confidence
        : Math.min(params.extracted.confidence, ABSTRACT_ONLY_CONFIDENCE_CAP),
      citationStatus: params.validatedCount > 0 ? "grounded" : "best_effort",
      strictNull: false,
    };
  }

  return {
    answer: null,
    confidence: Math.min(params.extracted.confidence, STRICT_NULL_CONFIDENCE_CAP),
    citationStatus: "insufficient_evidence",
    strictNull: true,
  };
}
