/**
 * Extraction Types - Frontend
 * Type definitions for the data extraction UI
 */

export type ExtractionQuestionType = "string" | "boolean" | "number" | "array";

export type ExtractionSourceType = "history" | "zotero" | "manual" | "mixed";

export interface ExtractionQuestion {
  key: string;
  question: string;
  type: ExtractionQuestionType;
  description?: string;
}

export interface ExtractionJob {
  _id: string;
  name: string;
  status: ExtractionJobStatus;
  totalPapers: number;
  processedPapers: number;
  failedPapers: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export type ExtractionJobStatus =
  | "pending"
  | "downloading_pdfs"
  | "indexing"
  | "extracting"
  | "completed"
  | "failed"
  | "cancelled";

export interface ExtractionPaper {
  _id: string;
  title: string;
  status: ExtractionPaperStatus;
  openalexId: string;
  doi?: string;
  publicationYear?: number;
  errorMessage?: string;
}

export type ExtractionPaperStatus =
  | "pending"
  | "downloading"
  | "download_failed"
  | "indexing"
  | "indexing_failed"
  | "extracting"
  | "completed"
  | "failed";

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
}

export interface ExtractionJobDetails {
  job: ExtractionJob;
  questions: ExtractionQuestion[];
  papers: ExtractionPaper[];
  progress: {
    total: number;
    processed: number;
    failed: number;
    percentage: number;
  };
}
