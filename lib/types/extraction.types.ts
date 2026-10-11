/**
 * Extraction Types - Frontend
 * Type definitions for the data extraction UI
 */

export type ExtractionQuestionType = "string" | "boolean" | "number" | "array";

export interface ExtractionQuestion {
  key: string;
  question: string;
  type: ExtractionQuestionType;
  description?: string;
}
