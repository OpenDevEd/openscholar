import { toast } from 'sonner';
import { useKeywordExpansionStore } from './store';

export interface KeywordValidationResult {
  /** Whether the validation passed (no missing keywords) */
  isValid: boolean;
  /** The expanded query if validation passed */
  expandedQuery: string;
  /** Array of warning messages if validation failed */
  warnings: string[];
}

/**
 * Validates keyword expansion for a query and shows toast warnings for missing keywords.
 * Returns validation result indicating whether operations should proceed.
 * 
 * @param query - The query to validate and expand
 * @returns KeywordValidationResult with isValid flag and expanded query or warnings
 */
export function validateAndExpandKeywords(query: string): KeywordValidationResult {
  const { expandQuery } = useKeywordExpansionStore.getState();
  const { expandedQuery, warnings } = expandQuery(query);
  
  if (warnings.length > 0) {
    // Show warning toasts for missing keywords
    warnings.forEach(warning => toast.warning(warning));
    
    return {
      isValid: false,
      expandedQuery: query, // Return original query
      warnings
    };
  }
  
  return {
    isValid: true,
    expandedQuery,
    warnings: []
  };
}

/**
 * Validates keyword expansion silently without showing toast warnings.
 * Use this for UI previews where you don't want to show toast notifications.
 * 
 * @param query - The query to validate and expand
 * @returns KeywordValidationResult with isValid flag and expanded query or warnings
 */
export function validateAndExpandKeywordsSilently(query: string): KeywordValidationResult {
  const { expandQuery } = useKeywordExpansionStore.getState();
  const { expandedQuery, warnings } = expandQuery(query);
  
  return {
    isValid: warnings.length === 0,
    expandedQuery: warnings.length === 0 ? expandedQuery : query,
    warnings
  };
}

/**
 * Validates keyword expansion and throws an error if validation fails.
 * Use this for functions that need to abort completely on keyword validation failure.
 * 
 * @param query - The query to validate and expand
 * @returns The expanded query if validation passes
 * @throws Error if validation fails
 */
export function validateAndExpandKeywordsOrThrow(query: string): string {
  const result = validateAndExpandKeywords(query);
  
  if (!result.isValid) {
    throw new Error(`Keyword validation failed: ${result.warnings.join('; ')}`);
  }
  
  return result.expandedQuery;
} 