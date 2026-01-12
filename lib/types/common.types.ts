/**
 * Common Types
 * Shared utility types used across the application
 */

/**
 * Review status for systematic reviews
 */
export type ReviewStatus = 'draft' | 'in_progress' | 'completed' | 'paused' | 'cancelled';

/**
 * Step in the systematic review workflow
 */
export type ReviewStep = 
  | 'research_question' 
  | 'search_terms' 
  | 'screening_questions' 
  | 'data_extraction_questions' 
  | 'search_execution'
  | 'screening'
  | 'data_extraction'
  | 'completed';

/**
 * Search term with enabled state
 */
export interface SearchTerm {
  term: string;
  enabled: boolean;
}

/**
 * Search term data (supports legacy string format)
 */
export type SearchTermData = SearchTerm | string;

/**
 * Type guard for SearchTerm object
 */
export function isSearchTermObject(item: SearchTermData): item is SearchTerm {
  return typeof item === 'object' && item !== null && 'term' in item && 'enabled' in item;
}

/**
 * Type guard for string SearchTerm
 */
export function isSearchTermString(item: SearchTermData): item is string {
  return typeof item === 'string';
}

/**
 * Normalize search terms from any format to SearchTerm[]
 */
export function normalizeSearchTerms(data: SearchTermData[] | null | undefined): SearchTerm[] {
  if (!data) return [];
  
  return data.map(item => {
    if (typeof item === 'string') {
      return { term: item, enabled: true };
    }
    return item;
  });
}

/**
 * Create a new search term
 */
export function createSearchTerm(term: string, enabled: boolean = true): SearchTerm {
  return { term, enabled };
}

/**
 * Validate a search term
 */
export function validateSearchTerm(term: SearchTerm): boolean {
  return !!(term.term && typeof term.term === 'string' && typeof term.enabled === 'boolean');
}
