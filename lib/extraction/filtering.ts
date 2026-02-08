import type { Doc } from "@/convex/_generated/dataModel";
import { getReviewState, isReviewed } from "./reviews";

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
  results: Array<Doc<"extractionResults">>;
}

export interface Question {
  key: string;
  question: string;
  type: 'boolean' | 'string' | 'array' | 'number';
  description?: string;
}

export interface PreprocessedPaperData {
  avgConfidence: number;
  searchableText: string;
}

/**
 * Pre-calculate expensive values once when papers change
 * Reduces O(n*m) filtering to O(n) preprocessing + O(n) filtering
 */
export function preprocessPapers(papers: PaperWithResults[]): Map<string, PreprocessedPaperData> {
  return new Map(
    papers.map(paper => {
      const avgConfidence = paper.results.length > 0
        ? paper.results.reduce((sum, r) => sum + (r.confidence || 0), 0) / paper.results.length
        : 0;

      const searchableText = [
        paper.title,
        ...paper.results.map((r) => String((r as any).correctedAnswer ?? r.answer)),
        ...paper.results.map(r => r.reasoning || ''),
        ...paper.results.flatMap((r) => {
          const citations = (r as any).citations;
          if (!Array.isArray(citations)) return [];
          return citations
            .map((citation: any) =>
              typeof citation?.quote === "string" ? citation.quote : ""
            )
            .filter(Boolean);
        }),
      ].join(' ').toLowerCase();

      return [paper._id, { avgConfidence, searchableText }];
    })
  );
}

/**
 * Filters papers based on the provided filter state
 * Uses preprocessed data for O(1) lookups instead of recalculating expensive values
 */
export function filterPapers(
  papers: PaperWithResults[],
  filters: FilterState,
  questions: Question[],
  preprocessedData: Map<string, PreprocessedPaperData>
): PaperWithResults[] {
  return papers.filter(paper => {
    const data = preprocessedData.get(paper._id);
    if (!data) return false;

    // Search filter - now O(1) lookup from preprocessed data
    if (filters.searchQuery && filters.searchQuery.trim()) {
      const query = filters.searchQuery.toLowerCase();
      if (!data.searchableText.includes(query)) return false;
    }

    // Confidence filter - now O(1) lookup from preprocessed data
    const minConfidence = filters.confidenceRange[0] / 100;
    const maxConfidence = filters.confidenceRange[1] / 100;

    if (data.avgConfidence < minConfidence || data.avgConfidence > maxConfidence) {
      return false;
    }

    // Status filters - use preprocessed avgConfidence
    if (filters.statusFilters.size > 0) {
      const hasMatch = [...filters.statusFilters].some(filter => {
        if (filter === 'has-pdf') return !!paper.pdfUrl || !!paper.storageId;
        if (filter === 'abstract-only') return !paper.pdfContentUsed;
        if (filter === 'open-access') return paper.isOpenAccess;
        if (filter === 'has-errors') {
          return paper.status === 'download_failed' || paper.status === 'indexing_failed' || paper.status === 'failed';
        }
        if (filter === 'high-confidence') return data.avgConfidence >= 0.8;
        if (filter === 'low-confidence') return data.avgConfidence < 0.5;
        if (filter === 'reviewed') return paper.results.some((result) => isReviewed(result));
        if (filter === 'needs-followup') {
          return paper.results.some((result) => getReviewState(result) === "needs_followup");
        }
        return false;
      });
      if (!hasMatch) return false;
    }

    // Question-specific filters
    for (const [questionKey, value] of filters.questionFilters) {
      const result = paper.results.find(r => r.questionKey === questionKey);
      if (!result || result.answer !== value) return false;
    }

    return true;
  });
}

/**
 * Calculates average confidence for a paper
 */
export function getAvgConfidence(paper: PaperWithResults): number {
  if (paper.results.length === 0) return 0;
  return paper.results.reduce((sum, r) => sum + (r.confidence || 0), 0) / paper.results.length;
}

/**
 * Highlights matching text with mark tags
 */
export function highlightText(text: string, query: string): string {
  if (!query || !query.trim()) return text;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return text.replace(regex, '<mark class="bg-yellow-200/50 dark:bg-yellow-500/30 rounded px-0.5">$1</mark>');
}

/**
 * Escapes special regex characters
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Gets result for a specific question from a paper
 */
export function getResult(paper: PaperWithResults, questionKey: string): Doc<"extractionResults"> | undefined {
  return paper.results.find(r => r.questionKey === questionKey);
}
