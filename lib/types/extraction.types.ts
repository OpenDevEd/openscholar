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

export interface ExtractionHistorySource {
  historyId: string;
  searchFilters: Record<string, any>;
}

export interface ExtractionZoteroItem {
  itemKey: string;
  title: string;
  abstract?: string;
  authors: string[];
  year?: number;
  doi?: string;
}

export interface ExtractionZoteroSelection {
  libraryType: "user" | "group";
  groupId?: string;
  zoteroUserId?: string;
  collectionKey?: string;
  includeDescendants?: boolean;
  items: ExtractionZoteroItem[];
}

export interface ExtractionManualItem {
  id: string;
  title: string;
  abstract?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  pdfUrl?: string;
  storageId?: string;
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
  reviewState?: "unreviewed" | "accepted" | "rejected" | "needs_followup";
  reviewNote?: string;
  correctedAnswer?: string | boolean | number | string[] | null;
  reviewedAt?: number;
  reviewedBy?: string;
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

export interface CreateExtractionJobInput {
  name: string;
  sourceType: ExtractionSourceType;
  sourceHistoryId?: string;
  searchFilters?: Record<string, any>;
  sourceHistoryEntries?: ExtractionHistorySource[];
  sourceZoteroSelection?: ExtractionZoteroSelection;
  sourceManualItems?: ExtractionManualItem[];
  questions: ExtractionQuestion[];
}

export interface ExtractionSavedView {
  _id: string;
  jobId: string;
  name: string;
  filters: {
    searchQuery: string;
    confidenceRange: [number, number];
    statusFilters: string[];
  };
  sortBy?: string;
  viewMode?: string;
  selectedQuestionKeys?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ExtractionWorkflowTemplate {
  _id: string;
  name: string;
  description?: string;
  sourceType: ExtractionSourceType;
  questions: ExtractionQuestion[];
  createdAt: number;
  updatedAt: number;
}

export interface ExtractionReportSnapshot {
  _id: string;
  jobId: string;
  name: string;
  scope: {
    filteredPaperIds?: string[];
    selectedQuestionKeys?: string[];
    viewName?: string;
  };
  sections: Array<{
    id: string;
    title: string;
    body: string;
  }>;
  metrics: {
    totalPapers: number;
    answeredRate: number;
    groundedRate: number;
    bestEffortRate: number;
  };
  generatedAt: number;
}

export interface ExtractionRunDiff {
  _id: string;
  jobId: string;
  baselineJobId: string;
  summary: {
    newAnswers: number;
    changedAnswers: number;
    removedAnswers: number;
    confidenceShifts: number;
    newlyInsufficientEvidence: number;
    totalCompared: number;
  };
  changes: Array<{
    openalexId: string;
    title: string;
    questionKey: string;
    changeType:
      | "new"
      | "changed"
      | "removed"
      | "confidence_shift"
      | "newly_insufficient_evidence";
    previousAnswer?: string | boolean | number | string[] | null;
    nextAnswer?: string | boolean | number | string[] | null;
    previousConfidence?: number;
    nextConfidence?: number;
  }>;
  generatedAt: number;
}
