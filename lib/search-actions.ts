import { toast } from 'sonner';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useUIStore, useSearchHistoryStore, useRatingsStore } from './store';
import { getEffectiveSearchId, createSearchParameters, generateFilename, downloadWithMetadata, getRatingOrNull } from './utils';
import { createSearchStateFromStore } from './search-utils';
import { validateAndExpandKeywords, validateAndExpandKeywordsSilently } from './keyword-validation';
import type { SearchField, SearchFilters } from './types';
import { searchResultToParams, buildResultsUrl } from './search-params';

// Utility function to extract query from FormData
const extractQueryFromFormData = (formData: FormData): string => {
  return formData.get('query') as string || '';
};

// Update current search with new query (SWR will handle data fetching)
export const updateCurrentSearch = async (
  formData: FormData,
  filters: SearchFilters,
) => {
  const { updateSearchResult, getSearchResult, addQueryToHistory } = useSearchHistoryStore.getState();
  
  // Get effective search ID from URL
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null;
  const effectiveSearchId = getEffectiveSearchId(pathname, undefined);
  
  if (!effectiveSearchId) {
    toast.error('No active search', {
      description: 'Please perform a search before updating.'
    });
    throw new Error('No current search ID to update');
  }
  
  // Get current search to preserve the existing count
  const currentSearch = getSearchResult(effectiveSearchId);
  const existingCount = currentSearch?.count || 0;

  const normalizedQuery = extractQueryFromFormData(formData);
  
  // Validate query only - don't perform search
  const validation = validateAndExpandKeywords(normalizedQuery);
  
  // If validation failed, don't update history item
  if (!validation.isValid) {
    return { searchId: effectiveSearchId };
  }
  
  // Check if the query has actually changed
  const currentQuery = currentSearch?.query || '';
  const hasQueryChanged = normalizedQuery !== currentQuery;
  
  if (hasQueryChanged) {
    // Add the new query to the history and update the current query
    addQueryToHistory(effectiveSearchId, normalizedQuery);

    // Update other filters if they've changed
    const searchState = createSearchStateFromStore(
      normalizedQuery,
      filters,
      existingCount, // Preserve existing count instead of setting to 0
      undefined // No research question when updating existing search
    );

         // Update only the non-query fields (the query was already updated by addQueryToHistory)
     const { query, ...otherUpdates } = searchState;
     updateSearchResult(effectiveSearchId, otherUpdates);
  } else {
    // Query hasn't changed, just update other fields
    const searchState = createSearchStateFromStore(
      normalizedQuery,
      filters,
      existingCount, // Preserve existing count instead of setting to 0
      undefined // No research question when updating existing search
    );
    
    updateSearchResult(effectiveSearchId, searchState);
  }

  return { searchId: effectiveSearchId };
};

// Update current search with new filters and refresh results
// NOTE: With URL-based state, this is now mostly a no-op since
// SWR automatically refetches when URL params change.
// Kept for backwards compatibility.
export const updateCurrentSearchFilters = async () => {
  // URL params now handle state - SWR auto-refetches on param change
  // This function is kept for backwards compatibility but does nothing
  return;
};

export const createSearchMetadata = (
  query: string,
  searchField: SearchField,
  dateRange?: DateRange,
  yearRange?: [number, number]
) => {
  // Create unified filters object for metadata
  const filters: SearchFilters = {
    searchField,
    sortBy: 'relevance_score:desc',
    filterType: 'year',
    dateRange,
    yearRange,
    isYearRangeEnabled: false, // Default for metadata
    ratingRange: undefined,
    onlyRatedPapers: undefined,
    selectedRegions: [],
    selectedCountryFocus: [],
    citesItemId: '',
    citedByItemId: '',
    relatedToItemId: '',
    reviewFilter: false,
  };
  
  // Use the centralized utility function to create search parameters
  const searchParams = createSearchParameters(query, filters);

  return {
    search: {
      query: query,
      field: searchField,
      date_range: dateRange ? {
        from: dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : null,
        to: dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : null
      } : null,
      year_range: yearRange ? {
        from: yearRange[0],
        to: yearRange[1]
      } : null,
      timestamp: new Date().toISOString(),
      sdk_version: "1.1.6",
      parameters: searchParams
    }
  };
};

export const getEssentialInfo = (item: any) => {
  const { ratings } = useRatingsStore.getState();
  return {
    id: item.id,
    title: item.title,
    authors: item.authorships?.map((a: { author: { display_name: string } }) => a.author.display_name).join(', ') || '',
    year: item.publication_year,
    abstract: item.abstract || '',
    rating: getRatingOrNull(ratings, item.id)
  };
};

export const downloadItem = async (item: any, format: 'json' | 'csv', searchState?: any) => {
  try {
    const { ratings } = useRatingsStore.getState();
    
    if (!searchState) {
      toast.error('Download failed', {
        description: 'Search information not available for download.'
      });
      return;
    }
    
    // Expand keywords for export
    const { expandedQuery } = validateAndExpandKeywordsSilently(searchState.query);
    
    const filename = generateFilename(item.title, '', format);
    const itemWithRating = {
      ...item,
      rating: getRatingOrNull(ratings, item.id)
    };
    const metadata = createSearchMetadata(expandedQuery, searchState.field, searchState.dateRange, searchState.yearRange);
    await downloadWithMetadata(itemWithRating, filename, format, metadata);
  } catch (error) {
    console.error('Error downloading item:', error);
    toast.error('Download failed', {
      description: 'Could not download the item. Please try again.'
    });
  }
};

export const downloadEssentialItem = async (item: any, format: 'json' | 'csv', searchState?: any) => {
  try {
    if (!searchState) {
      toast.error('Download failed', {
        description: 'Search information not available for download.'
      });
      return;
    }
    
    // Expand keywords for export
    const { expandedQuery } = validateAndExpandKeywordsSilently(searchState.query);
    
    const essentialInfo = getEssentialInfo(item);
    const filename = generateFilename(item.title, 'essential', format);
    const metadata = createSearchMetadata(expandedQuery, searchState.field, searchState.dateRange, searchState.yearRange);
    await downloadWithMetadata(essentialInfo, filename, format, metadata);
  } catch (error) {
    console.error('Error downloading essential item:', error);
    toast.error('Download failed', {
      description: 'Could not download the essential information. Please try again.'
    });
  }
};

export const downloadAll = async (format: 'json' | 'csv', onlyEssential: boolean = false, searchState?: any, results?: any[]) => {
  try {
    const { ratings } = useRatingsStore.getState();
    
    if (!searchState || !results) {
      toast.error('Download failed', {
        description: 'Search results not available for download.'
      });
      return;
    }

    // Expand keywords for export
    const { expandedQuery } = validateAndExpandKeywordsSilently(searchState.query);
    
    const filename = generateFilename('search_results', onlyEssential ? 'essential' : '', format);
    const dataToDownload = onlyEssential 
      ? results.map(getEssentialInfo)
      : results.map(item => ({
          ...item,
          rating: getRatingOrNull(ratings, item.id)
        }));
    
    const metadata = createSearchMetadata(expandedQuery, searchState.field, searchState.dateRange, searchState.yearRange);
    await downloadWithMetadata(dataToDownload, filename, format, metadata);
  } catch (error) {
    console.error('Error downloading all results:', error);
    toast.error('Download failed', {
      description: 'Could not download the results. Please try again.'
    });
  }
};

export const openFocusMode = (isMobile?: boolean, initialIndex: number = 0) => {
  const { setIsDialogOpen, setIsFocusModeOpen, setFocusModeIndex } = useUIStore.getState();
  
  // If isMobile is provided, use it; otherwise fall back to window check for backward compatibility
  const isDesktop = isMobile !== undefined ? !isMobile : window.matchMedia("(min-width: 768px)").matches;
  if (!isDesktop) {
    setIsDialogOpen(false);
  }
  setFocusModeIndex(initialIndex);
  setIsFocusModeOpen(true);
};

/**
 * Selects a query from history and navigates to results page
 * Updates the search history if the query is different from current
 * Can be used from home page or results page
 */
export const selectQueryFromHistory = async (
  searchId: string,
  selectedQuery: string,
  router: any // Next.js router
) => {
  const { getSearchResult, addQueryToHistory } = useSearchHistoryStore.getState();
  
  // Get the current search result
  const currentSearch = getSearchResult(searchId);
  if (!currentSearch) {
    toast.error('Search not found', {
      description: 'The requested search could not be found in your history.'
    });
    return;
  }
  
  const currentQuery = currentSearch.query;
  
  // Check if the selected query is different from current
  if (selectedQuery !== currentQuery) {
    // Add the selected query to history and update current query
    addQueryToHistory(searchId, selectedQuery);
    
    toast.success('Query updated', {
      description: `Switched to: "${selectedQuery}"`
    });
  }
  
  // Build URL params from the search result (with the new query if changed)
  const searchResultWithQuery = selectedQuery !== currentQuery 
    ? { ...currentSearch, query: selectedQuery }
    : currentSearch;
  
  const urlParams = searchResultToParams(searchResultWithQuery);
  
  // Navigate to the results page with the search ID and URL params
  router.push(buildResultsUrl(searchId, urlParams));
}; 