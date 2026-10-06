import type { expandShortcuts } from './query-shortcuts';

/** Expands a query's shortcuts: from the browser's store, or the account's records on the server. */
export type ExpandShortcuts = (query: string) => ReturnType<typeof expandShortcuts>;

export interface KeywordValidationResult {
  /** Whether the validation passed (no missing keywords) */
  isValid: boolean;
  /** The expanded query if validation passed */
  expandedQuery: string;
  /** Array of warning messages if validation failed */
  warnings: string[];
}

export interface ValidateAndExpandKeywordsOptions {
  /** Returns localized message for a key (e.g. validation.bookmarkNotFound) */
  getMessage?: (key: string, params?: Record<string, string>) => string;
  /** Optional callback for warning messages */
  onWarning?: (message: string) => void;
}

/**
 * Validates keyword expansion for a query and returns warning messages for missing keywords.
 * Returns validation result indicating whether operations should proceed.
 */
export function validateAndExpandKeywords(
  query: string,
  expand: ExpandShortcuts,
  options?: ValidateAndExpandKeywordsOptions
): KeywordValidationResult {
  const { getMessage, onWarning } = options ?? {};

  // Any query is a search, an empty one included: the results are paged, so it lists every work the filters leave.
  if (query.trim().length === 0) {
    return {
      isValid: true,
      expandedQuery: query,
      warnings: [],
    };
  }

  const { expandedQuery, warnings } = expand(query);

  if (warnings.length > 0) {
    const resolveWarning = (w: { key: string; params?: Record<string, string> }) =>
      getMessage?.(w.key, w.params) ?? `Bookmark "${w.params?.keyword ?? ''}" not found`;
    const resolvedWarnings = warnings.map(resolveWarning);
    resolvedWarnings.forEach((msg) => onWarning?.(msg));

    return {
      isValid: false,
      expandedQuery: query, // Return original query
      warnings: resolvedWarnings,
    };
  }

  return {
    isValid: true,
    expandedQuery,
    warnings: [],
  };
}

/**
 * Validates keyword expansion silently without showing warning notifications.
 * Use this for UI previews where you don't want to show notifications.
 */
export function validateAndExpandKeywordsSilently(query: string, expand: ExpandShortcuts): KeywordValidationResult {
  // Allow empty queries - they are valid for browsing all papers
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return {
      isValid: true,
      expandedQuery: query,
      warnings: [],
    };
  }

  const { expandedQuery, warnings } = expand(query);
  const resolvedWarnings = warnings.map(
    (w) => `Bookmark "${w.params?.keyword ?? ''}" not found`
  );

  return {
    isValid: warnings.length === 0,
    expandedQuery: warnings.length === 0 ? expandedQuery : query,
    warnings: resolvedWarnings,
  };
}
