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
  answer: string | boolean | number | string[];
  confidence?: number;
  reasoning?: string;
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
