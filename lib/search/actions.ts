/**
 * Search Actions
 * 
 * Explicit actions for search operations.
 * These are the only places that write to the history store.
 */

import { shortWorkId } from '../openalex/work-id';
import { useSearchHistoryStore } from '../store';
import type { SearchFilters, SearchField, SearchResult, QuestionHistoryEntry } from '../types';
import { searchResultToParams } from '../search-params/converters';
import { buildResultsUrl, DEFAULT_SEARCH_PARAMS } from '../search-params';

export interface SubmitSearchResult {
  id: string;
  url: string;
}

/**
 * Submit a new search from the home page
 * 
 * Creates a new history entry and returns a URL to navigate to.
 * Call router.push(result.url) after this.
 */
export function submitNewSearch(
  query: string,
  filters: SearchFilters,
  researchQuestion?: string
): SubmitSearchResult {
  const { addSearchResult } = useSearchHistoryStore.getState();
  
  // Build question history entry if provided
  const questionHistory = researchQuestion ? [{
    question: researchQuestion,
    timestamp: new Date().toISOString(),
  } as QuestionHistoryEntry] : undefined;
  
  // Build the entry directly with all required fields
  const entry = {
    query,
    field: filters.searchField,
    count: 0,
    sortBy: filters.sortBy || DEFAULT_SEARCH_PARAMS.sort,
    filterType: filters.filterType || 'year' as const,
    yearRange: filters.yearRange,
    isYearRangeEnabled: filters.isYearRangeEnabled,
    dateRange: filters.dateRange,
    ratingRange: filters.ratingRange,
    onlyRatedPapers: filters.onlyRatedPapers,
    selectedRegions: filters.selectedRegions || [],
    selectedCountryFocus: filters.selectedCountryFocus || [],
    citesItemId: filters.citesItemId || '',
    citedByItemId: filters.citedByItemId || '',
    relatedToItemId: filters.relatedToItemId || '',
    reviewFilter: filters.reviewFilter || false,
    questionHistory,
  };
  
  const id = addSearchResult(entry);
  
  // Build URL using centralized utility
  const params = searchResultToParams({ ...entry, id } as SearchResult);
  
  return {
    id,
    url: buildResultsUrl(id, params),
  };
}

/**
 * Restore a search from history
 * 
 * Returns a URL to navigate to for viewing an existing search.
 */
export function restoreFromHistory(entry: SearchResult): string {
  const params = searchResultToParams(entry);
  return buildResultsUrl(entry.id, params);
}

/**
 * Create a "cites", "cited by", or "related" search from an existing paper
 * 
 * Creates a new history entry and returns a URL.
 */
/** The most papers a search for the works nearest them takes, as the OpenScholar API does. */
export const MAX_SIMILAR_PAPERS = 100;

/**
 * Starts a search for the works nearest these papers by meaning, closest first (the OpenScholar
 * API's similar_to), each by its short id, at most MAX_SIMILAR_PAPERS of them.
 */
export function createSimilarSearch(paperIds: readonly string[]): SubmitSearchResult {
  const { addSearchResult } = useSearchHistoryStore.getState();
  const similarTo = [...new Set(paperIds.map((id) => shortWorkId(id) ?? id))].slice(0, MAX_SIMILAR_PAPERS);
  const entry = {
    query: '',
    field: 'title_and_abstract' as SearchField,
    count: 0,
    sortBy: 'relevance_score:desc',
    filterType: 'year' as const,
    selectedRegions: [] as string[],
    selectedCountryFocus: [] as string[],
    citesItemId: '',
    citedByItemId: '',
    relatedToItemId: '',
    similarTo,
    reviewFilter: false,
  };
  const id = addSearchResult(entry);
  return { id, url: buildResultsUrl(id, searchResultToParams({ ...entry, id } as SearchResult)) };
}

export function createCitationSearch(
  paperId: string,
  type: 'cites' | 'citedBy' | 'related' | 'similar',
  currentSearchField?: SearchField
): SubmitSearchResult {
  if (type === 'similar') return createSimilarSearch([paperId]);
  const { addSearchResult } = useSearchHistoryStore.getState();
  
  // Build entry with all required fields
  const entry = {
    query: '',
    field: currentSearchField || 'title_and_abstract' as SearchField,
    count: 0,
    sortBy: 'cited_by_count:desc', // Default to most cited for citation/related searches
    filterType: 'year' as const,
    selectedRegions: [] as string[],
    selectedCountryFocus: [] as string[],
    citesItemId: type === 'cites' ? paperId : '',
    citedByItemId: type === 'citedBy' ? paperId : '',
    relatedToItemId: type === 'related' ? paperId : '',
    reviewFilter: false,
  };
  
  const id = addSearchResult(entry);
  
  // Build URL using centralized utility
  const params = searchResultToParams({ ...entry, id } as SearchResult);
  
  return {
    id,
    url: buildResultsUrl(id, params),
  };
}
