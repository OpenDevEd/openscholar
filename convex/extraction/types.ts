/**
 * Extraction Types
 * Type definitions for the data extraction system (Elicit-style)
 */

import { v } from "convex/values";

export const extractionQuestionSchema = v.object({
  key: v.string(),
  question: v.string(),
  type: v.union(
    v.literal("string"),
    v.literal("boolean"),
    v.literal("number"),
    v.literal("array")
  ),
  description: v.optional(v.string()),
});

export type ExtractionQuestionType =
  | "string"
  | "boolean"
  | "number"
  | "array";

export interface ExtractionQuestionInput {
  key: string;
  question: string;
  type: ExtractionQuestionType;
  description?: string;
}

export interface PaperData {
  openalexId: string;
  title: string;
  doi?: string;
  publicationYear?: number;
  abstract?: string;
  authors?: string[];
  pdfUrl?: string;
  storageId?: string;
  isOpenAccess?: boolean;
  citedByCount?: number;
  venueName?: string;
  workType?: string;
}

export interface ExtractionResult {
  questionKey: string;
  answer: string | boolean | number | string[] | null;
  confidence?: number;
  reasoning?: string;
  citations: Array<{
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
  }>;
  citationStatus:
    | "grounded"
    | "best_effort"
    | "insufficient_evidence"
    | "extraction_error";
  retrievalDiagnostics?: {
    denseCandidates: number;
    lexicalCandidates: number;
    fusedCandidates: number;
    rerankedCandidates: number;
    validatedCitations: number;
    strictNull: boolean;
  };
  model?: string;
  provider?: string;
}

export interface SearchFilters {
  query: string;
  field?: string;
  yearRange?: [number, number];
  dateRange?: { from?: string; to?: string };
  filterType?: "date" | "year";
  isYearRangeEnabled?: boolean;
  sortBy?: string;
  selectedRegions?: string[];
  selectedCountryFocus?: string[];
  ratingRange?: [number, number];
  onlyRatedPapers?: boolean;
  citesItemId?: string;
  citedByItemId?: string;
  relatedToItemId?: string;
  reviewFilter?: boolean;
  language?: string;
}
