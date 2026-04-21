import type { Doc } from "@/convex/_generated/dataModel";
import type { ExtractionResultWithReview } from "./types";

export interface FilterState {
  searchQuery: string;
  confidenceRange: [number, number];
  statusFilters: Set<string>;
  questionFilters: Map<string, any>;
}

export const defaultFilters: FilterState = {
  searchQuery: '',
  confidenceRange: [0, 100],
  statusFilters: new Set(),
  questionFilters: new Map(),
};

export interface PaperWithResults extends Doc<"extractionPapers"> {
  results: Array<ExtractionResultWithReview>;
}

export interface Question {
  key: string;
  question: string;
  type: 'boolean' | 'string' | 'array' | 'number';
  description?: string;
}

/**
 * Calculates average confidence for a paper
 */
export function getAvgConfidence(paper: PaperWithResults): number {
  if (paper.results.length === 0) return 0;
  return paper.results.reduce((sum, r) => sum + (r.confidence || 0), 0) / paper.results.length;
}
