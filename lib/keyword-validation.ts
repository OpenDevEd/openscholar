import { appToast } from '@/lib/toast';
import { useKeywordExpansionStore } from './store';

export interface KeywordValidationResult {
  /** Whether the validation passed (no missing keywords) */
  isValid: boolean;
  /** The expanded query if validation passed */
  expandedQuery: string;
  /** Array of warning messages if validation failed */
  warnings: string[];
}

const FALLBACK_SINGLE_CHAR = 'Single character searches are not supported. Please use at least 2 characters.';

export interface ValidateAndExpandKeywordsOptions {
  /** Returns localized message for a key (e.g. validation.singleCharSearch) */
  getMessage?: (key: string, params?: Record<string, string>) => string;
  /** Called to show a warning toast; when provided, used instead of appToast */
  onWarning?: (message: string) => void;
}

/**
 * Validates keyword expansion for a query and shows toast warnings for missing keywords.
 * Returns validation result indicating whether operations should proceed.
 *
 * @param query - The query to validate and expand
 * @param options - Optional getMessage and onWarning for localized warnings
 * @returns KeywordValidationResult with isValid flag and expanded query or warnings
 */
export function validateAndExpandKeywords(
  query: string,
  options?: ValidateAndExpandKeywordsOptions
): KeywordValidationResult {
  const { getMessage, onWarning } = options ?? {};
  const showWarning = onWarning ?? ((msg: string) => appToast.validation.warning(msg));

  // Allow empty queries - they are valid for browsing all papers
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return {
      isValid: true,
      expandedQuery: query,
      warnings: []
    };
  }

  // Check for minimum query length (only for non-empty queries)
  if (trimmedQuery.length === 1) {
    const warning = getMessage?.('singleCharSearch') ?? FALLBACK_SINGLE_CHAR;
    showWarning(warning);
    return {
      isValid: false,
      expandedQuery: query,
      warnings: [warning]
    };
  }

  const { expandQuery } = useKeywordExpansionStore.getState();
  const { expandedQuery, warnings } = expandQuery(query);

  if (warnings.length > 0) {
    const resolveWarning = (w: { key: string; params?: Record<string, string> }) =>
      getMessage?.(w.key, w.params) ?? `Bookmark "${w.params?.keyword ?? ''}" not found`;
    const resolvedWarnings = warnings.map(resolveWarning);
    resolvedWarnings.forEach((msg) => showWarning(msg));

    return {
      isValid: false,
      expandedQuery: query, // Return original query
      warnings: resolvedWarnings
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
  // Allow empty queries - they are valid for browsing all papers
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return {
      isValid: true,
      expandedQuery: query,
      warnings: []
    };
  }
  
  // Check for minimum query length (only for non-empty queries)
  if (trimmedQuery.length === 1) {
    const warning = 'Single character searches are not supported. Please use at least 2 characters.';
    return {
      isValid: false,
      expandedQuery: query,
      warnings: [warning]
    };
  }

  const { expandQuery } = useKeywordExpansionStore.getState();
  const { expandedQuery, warnings } = expandQuery(query);
  const resolvedWarnings = warnings.map(
    (w) => `Bookmark "${w.params?.keyword ?? ''}" not found`
  );

  return {
    isValid: warnings.length === 0,
    expandedQuery: warnings.length === 0 ? expandedQuery : query,
    warnings: resolvedWarnings
  };
} 
