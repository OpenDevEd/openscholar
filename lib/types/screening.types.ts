/**
 * A simplified screening question entry for search history.
 */
export interface ScreeningQuestionEntry {
  question: string;
}

/**
 * Screening responses for papers in search history
 * Key: PaperID, Value: Record of Question -> boolean | null
 */
export type ScreeningResponses = Record<string, Record<string, boolean | null>>;
