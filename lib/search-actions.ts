import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { startSearch, getSearchResults } from '@/app/actions/openalex';
import { SearchField, getRatingOrNull, generateFilename, downloadWithMetadata, getEffectiveSearchId, createSearchParameters } from './utils';
import { getCountryCodesForRegions, COUNTRIES } from './constants';
import { getSearchResultsWithFilters, createSearchStateFromStore, extractStateFromSearchResult } from './search-utils';
import { useUIStore, useResultsStore, useSearchHistoryStore, useRatingsStore, useSearchFormStore, useKeywordExpansionStore } from './store';
import { toast } from 'sonner';
import { validateAndExpandKeywords, validateAndExpandKeywordsSilently } from './keyword-validation';

// Global search index counter to prevent race conditions
let globalSearchIndex = 0;

// Utility function to extract query from FormData
const extractQueryFromFormData = (formData: FormData): string => {
  const rawQuery = formData.get("query") as string;
  return rawQuery.replace(/\s+/g, ' ').trim(); // Normalize whitespace
};

// Utility function to get store functions for results management
const getResultsStoreFunctions = () => {
  return useResultsStore.getState();
};

// Utility function to check if search is still current
const isSearchCurrent = (searchIndex: number): boolean => {
  return searchIndex === globalSearchIndex;
};

// Utility function to handle search cancellation
const handleSearchCancellation = (searchIndex: number, operation: string) => {
  if (!isSearchCurrent(searchIndex)) {
    console.log(`${operation} ${searchIndex} cancelled - newer search ${globalSearchIndex} in progress`);
    return true;
  }
  return false;
};

// Utility function to update results store with consistent pattern
const updateResultsInStore = (
  searchResult: any,
  searchField: SearchField,
  dateRange?: DateRange,
  yearRange?: [number, number],
  filterType?: "date" | "year",
  isFilterActive?: boolean
) => {
  const {
    setCurrentQuery,
    setCurrentPage,
    setResults,
    setResultsSearchField,
    setResultsDateRange,
    setResultsYearRange
  } = getResultsStoreFunctions();

  setCurrentQuery(searchResult.originalQuery);
  setCurrentPage(1);
  setResults(searchResult.results.results, searchResult.results.meta.count);
  setResultsSearchField(searchField);
  setResultsDateRange((filterType === "date" && isFilterActive) ? dateRange : undefined);
  setResultsYearRange((filterType === "year" && isFilterActive) ? yearRange : undefined);
};

// Utility function to calculate effective date/year ranges based on filter type
const getEffectiveRanges = (dateRange?: DateRange, yearRange?: [number, number], filterType?: "date" | "year", isFilterActive?: boolean) => {
  return {
    effectiveDateRange: (filterType === "date" && isFilterActive) ? dateRange : undefined,
    effectiveYearRange: (filterType === "year" && isFilterActive) ? yearRange : undefined
  };
};

// Utility function to create search state with effective ranges
const createSearchStateWithEffectiveRanges = (
  query: string,
  searchField: SearchField,
  dateRange?: DateRange,
  yearRange?: [number, number],
  filterType?: "date" | "year",
  isFilterActive?: boolean,
  sortBy?: string,
  resultsCount?: number
) => {
  const { effectiveDateRange, effectiveYearRange } = getEffectiveRanges(dateRange, yearRange, filterType, isFilterActive);
  return createSearchStateFromStore(
    query,
    searchField,
    effectiveDateRange,
    effectiveYearRange,
    filterType,
    sortBy,
    resultsCount
  );
};

// Utility function to handle common early return patterns
const handleSearchResult = (searchResult: any, cancelled: boolean = false, validationError: boolean = false) => {
  if (cancelled) return { results: searchResult?.results || null, searchId: null };
  if (validationError) return { results: null, searchId: null };
  return null; // Continue processing
};

// Utility function for common search execution pattern
const executeSearchWithValidation = async (
  searchParams: Parameters<typeof getSearchResultsWithFilters>[0],
  currentSearchIndex: number,
  operation: string
) => {
  try {
    // Validate relevance sorting with empty query
    const { query, sortBy } = searchParams;
    if (sortBy === "relevance_score:desc" && (!query || query.trim() === '')) {
      toast.error('Relevance sorting requires a search query', {
        description: 'You cannot sort by relevance without entering search terms. Please enter a query or choose a different sort option.'
      });
      return { searchResult: null, cancelled: false, validationError: true };
    }

    // Get enhanced search results
    const searchResult = await getSearchResultsWithFilters(searchParams);

    // Check cancellation
    if (handleSearchCancellation(currentSearchIndex, operation)) {
      return { searchResult, cancelled: true };
    }

    // Handle validation errors
    if (!searchResult.validation.isValid) {
      toast.error('Invalid search query', {
        description: searchResult.validation.warnings.join('. ') || 'Please check your search terms and try again.'
      });
      return { searchResult: null, cancelled: false, validationError: true };
    }

    return { searchResult, cancelled: false, validationError: false };
  } catch (error) {
    console.error(`Error in ${operation}:`, error);
    
    // Show user-friendly error message
    if (error instanceof Error) {
      if (error.message.includes('400')) {
        toast.error('Search query too large', {
          description: 'Your search query is too complex or long. Please try simplifying it or using fewer search terms.'
        });
      } else if (error.message.includes('403')) {
        toast.error('Search request rejected', {
          description: 'The search query contains invalid parameters. Please try simplifying your search.'
        });
      } else if (error.message.includes('429')) {
        toast.error('Too many requests', {
          description: 'Please wait a moment before trying again.'
        });
      } else if (error.message.includes('500')) {
        toast.error('Server error', {
          description: 'The search service is temporarily unavailable. Please try again later.'
        });
      } else if (error.message.toLowerCase().includes('network') || error.message.toLowerCase().includes('fetch')) {
        toast.error('Connection error', {
          description: 'Please check your internet connection and try again.'
        });
      } else {
        toast.error('Search failed', {
          description: 'An unexpected error occurred. Please try again.'
        });
      }
    } else {
      toast.error('Search failed', {
        description: 'An unexpected error occurred. Please try again.'
      });
    }
    
    return { searchResult: null, cancelled: false, validationError: true };
  }
};

// Utility function to manage loading state with try/finally pattern
const withLoadingState = async <T>(
  loadingKey: 'setIsUpdatingCurrentSearch' | 'setIsCreatingNewSearch' | 'setIsFilterLoading',
  currentSearchIndex: number,
  operation: () => Promise<T>
): Promise<T> => {
  try {
    const { [loadingKey]: setLoading } = useUIStore.getState();
    setLoading(true);
    return await operation();
  } finally {
    // Always clear loading state to prevent stuck loading indicators
    // This is especially important during navigation when search index might change
    const { [loadingKey]: setLoading } = useUIStore.getState();
    setLoading(false);
  }
};

// Utility function to manage complex loading state for search by ID
const withSearchByIdLoadingState = async <T>(
  currentSearchIndex: number,
  index: number | undefined,
  operation: () => Promise<T>
): Promise<T> => {
  try {
    const { setIsLoading, setLoadingResultIndex } = useUIStore.getState();
    setIsLoading(true);
    if (index !== undefined) {
      setLoadingResultIndex(index);
    }
    return await operation();
  } finally {
    // Always clear loading state to prevent stuck loading indicators
    // This is especially important during navigation when search index might change
    const { setIsLoading, setLoadingResultIndex } = useUIStore.getState();
    setIsLoading(false);
    setLoadingResultIndex(null);
  }
};

// Utility function to update results store with custom field and ranges (used by loadSearchResultsById)
const updateResultsInStoreWithStoredData = (
  searchResult: any,
  storedSearchField: SearchField,
  storedDateRange?: DateRange,
  storedYearRange?: [number, number]
) => {
  const {
    setCurrentQuery,
    setCurrentPage,
    setResults,
    setResultsSearchField,
    setResultsDateRange,
    setResultsYearRange
  } = getResultsStoreFunctions();

  setCurrentQuery(searchResult.originalQuery);
  setCurrentPage(1);
  setResults(searchResult.results.results, searchResult.results.meta.count);
  setResultsSearchField(storedSearchField);
  setResultsDateRange(storedDateRange);
  setResultsYearRange(storedYearRange);
};

// Utility function to update results store with direct parameters (used by loadSearchResults)
const updateResultsInStoreWithDirectData = (
  searchResult: any,
  query: string,
  searchField: SearchField,
  dateRange?: DateRange,
  yearRange?: [number, number]
) => {
  const {
    setCurrentQuery,
    setCurrentPage,
    setResults,
    setResultsSearchField,
    setResultsDateRange,
    setResultsYearRange
  } = getResultsStoreFunctions();

  setCurrentQuery(query);
  setCurrentPage(1);
  setResults(searchResult.results.results, searchResult.results.meta.count);
  setResultsSearchField(searchField);
  setResultsDateRange(dateRange);
  setResultsYearRange(yearRange);
};

// Update the current search with a new query
export const updateCurrentSearch = async (
  formData: FormData,
  searchField: SearchField,
  dateRange?: DateRange,
  sortBy?: string,
  yearRange?: [number, number],
  filterType?: "date" | "year",
  isFilterActive?: boolean
) => {
  const currentSearchIndex = ++globalSearchIndex;
  
  return withLoadingState('setIsUpdatingCurrentSearch', currentSearchIndex, async () => {
    try {
      const { updateSearchResult, getSearchResult } = useSearchHistoryStore.getState();
      const { currentSearchId } = useSearchFormStore.getState();
      
      // Get effective search ID
      const pathname = typeof window !== 'undefined' ? window.location.pathname : null;
      const effectiveSearchId = getEffectiveSearchId(pathname, currentSearchId);
      
      if (!effectiveSearchId) {
        toast.error('No active search', {
          description: 'Please perform a search before updating it.'
        });
        throw new Error('No current search to update');
      }
      
      const normalizedQuery = extractQueryFromFormData(formData);
      
      // Execute search with validation
      const { searchResult, cancelled, validationError } = await executeSearchWithValidation({
        query: normalizedQuery,
        searchField,
        dateRange,
        sortBy,
        yearRange,
        filterType,
        isFilterActive
      }, currentSearchIndex, 'Search update');

      // Handle early returns
      const earlyReturn = handleSearchResult(searchResult, cancelled, validationError);
      if (earlyReturn) return earlyReturn;
      
      // Update search history
      const searchState = createSearchStateWithEffectiveRanges(
        normalizedQuery,
        searchField,
        dateRange,
        yearRange,
        filterType,
        isFilterActive,
        sortBy,
        searchResult!.results.meta.count
      );
      updateSearchResult(effectiveSearchId, searchState);

      // Update results in store
      updateResultsInStore(searchResult!, searchField, dateRange, yearRange, filterType, isFilterActive);

      return { results: searchResult!.results, searchId: effectiveSearchId };
    } catch (error) {
      console.error('Error updating current search:', error);
      
      // Only show toast if we haven't already shown one above
      if (error instanceof Error && !error.message.includes('No current search')) {
        toast.error('Failed to update search', {
          description: 'Could not update the current search. Please try again.'
        });
      }
      
      return { results: null, searchId: null };
    }
  });
};

// Create a new search and return its ID
export const submitSearchAndLoadResults = async (
  formData: FormData,
  searchField: SearchField,
  dateRange?: DateRange,
  sortBy?: string,
  yearRange?: [number, number],
  filterType?: "date" | "year",
  isFilterActive?: boolean
) => {
  const currentSearchIndex = ++globalSearchIndex;
  
  return withLoadingState('setIsCreatingNewSearch', currentSearchIndex, async () => {
    const { addSearchResult } = useSearchHistoryStore.getState();
    const { setCurrentSearchId } = useSearchFormStore.getState();
    
    const normalizedQuery = extractQueryFromFormData(formData);
    
    // Execute search with validation
    const { searchResult, cancelled, validationError } = await executeSearchWithValidation({
      query: normalizedQuery,
      searchField,
      dateRange,
      sortBy,
      yearRange,
      filterType,
      isFilterActive
    }, currentSearchIndex, 'Search');

    // Handle early returns
    const earlyReturn = handleSearchResult(searchResult, cancelled, validationError);
    if (earlyReturn) return earlyReturn;
    
    // Add to search history
    const searchState = createSearchStateWithEffectiveRanges(
      normalizedQuery,
      searchField,
      dateRange,
      yearRange,
      filterType,
      isFilterActive,
      sortBy,
      searchResult!.results.meta.count
    );
    const searchId = addSearchResult(searchState);

    // Set current search ID and update results
    setCurrentSearchId(searchId);
    updateResultsInStore(searchResult!, searchField, dateRange, yearRange, filterType, isFilterActive);

    return { results: searchResult!.results, searchId };
  });
};

// Load search results by ID and update current state
export const loadSearchResultsById = async (searchId: string, index?: number) => {
  const currentSearchIndex = ++globalSearchIndex;
  
  return withSearchByIdLoadingState(currentSearchIndex, index, async () => {
    try {
      const { getSearchResult, migrateSearchResult } = useSearchHistoryStore.getState();
      const { loadSearchState } = useSearchFormStore.getState();
      
      // Get and validate search result
      let searchResult = getSearchResult(searchId);
      if (!searchResult) {
        toast.error('Search not found', {
          description: 'The requested search could not be found in your history.'
        });
        throw new Error(`Search with ID ${searchId} not found`);
      }
      
      // Ensure the search result has an ID (migration)
      if (!searchResult.id) {
        migrateSearchResult(searchResult);
      }
      
      // Load the search state into form store
      loadSearchState(searchResult);
      
      // Execute search with stored state
      const overrideState = extractStateFromSearchResult(searchResult);
      const { searchResult: enhancedSearchResult, cancelled, validationError } = await executeSearchWithValidation({
        query: searchResult.query,
        searchField: searchResult.field,
        dateRange: searchResult.dateRange,
        sortBy: searchResult.sortBy,
        yearRange: searchResult.yearRange,
        filterType: searchResult.filterType,
        isFilterActive: !!(searchResult.dateRange || searchResult.yearRange),
        overrideState
      }, currentSearchIndex, 'Search history load');

      // Handle early returns
      if (validationError) return null;
      if (cancelled) return enhancedSearchResult?.results || null;
      
      // Update results in store with stored search field and ranges
      updateResultsInStoreWithStoredData(
        enhancedSearchResult!,
        searchResult.field,
        searchResult.dateRange,
        searchResult.yearRange
      );

      return enhancedSearchResult!.results;
    } catch (error) {
      console.error('Error loading search by ID:', error);
      
      // Only show toast if we haven't already shown one above
      if (error instanceof Error && !error.message.includes('not found')) {
        toast.error('Failed to load search', {
          description: 'Could not reload the search results. Please try again.'
        });
      }
      
      return null;
    }
  });
};

// Update current search with new filters and refresh results
export const updateCurrentSearchFilters = async () => {
  const currentSearchIndex = ++globalSearchIndex;
  
  return withLoadingState('setIsFilterLoading', currentSearchIndex, async () => {
    try {
      const { updateSearchResult, getSearchResult } = useSearchHistoryStore.getState();
      const { 
        currentSearchField,
        dateRange,
        sortBy,
        filterType,
        yearRange,
        isFilterActive,
        currentSearchId
      } = useSearchFormStore.getState();
      
      // Get effective search ID and current search
      const pathname = typeof window !== 'undefined' ? window.location.pathname : null;
      const effectiveSearchId = getEffectiveSearchId(pathname, currentSearchId);
      
      if (!effectiveSearchId) {
        toast.error('No active search', {
          description: 'Please perform a search before applying filters.'
        });
        throw new Error('No current search ID to update');
      }
      
      const currentSearch = getSearchResult(effectiveSearchId);
      if (!currentSearch) {
        toast.error('Search not found', {
          description: 'The current search could not be found in your history.'
        });
        throw new Error('Current search not found in history');
      }
      
      // Update search history with current filter state
      const searchState = createSearchStateWithEffectiveRanges(
        currentSearch.query,
        currentSearchField,
        dateRange,
        yearRange,
        filterType,
        isFilterActive,
        sortBy
      );
      updateSearchResult(effectiveSearchId, searchState);
      
      // Execute search with validation
      const { searchResult, cancelled, validationError } = await executeSearchWithValidation({
        query: currentSearch.query,
        searchField: currentSearchField,
        dateRange,
        sortBy,
        yearRange,
        filterType,
        isFilterActive
      }, currentSearchIndex, 'Filter update');

      // Handle early returns with special logic for filters
      if (validationError) return null;
      if (cancelled) return searchResult?.results || null;
      
      // Update the count in search history
      updateSearchResult(effectiveSearchId, {
        count: searchResult!.results.meta.count,
      });
      
      // Update results in store
      updateResultsInStore(searchResult!, currentSearchField, dateRange, yearRange, filterType, isFilterActive);

      return searchResult!.results;
    } catch (error) {
      console.error('Error updating search filters:', error);
      
      // Only show toast if we haven't already shown one above
      if (error instanceof Error && !error.message.includes('No current search') && !error.message.includes('not found')) {
        toast.error('Failed to update filters', {
          description: 'Could not apply the filter changes. Please try again.'
        });
      }
      
      return null;
    }
  });
};

// Legacy function for backward compatibility - now just calls the unified function
export const submitSearch = async (
  formData: FormData,
  searchField: SearchField,
  dateRange?: DateRange,
  sortBy?: string,
  yearRange?: [number, number],
  filterType?: "date" | "year",
  isFilterActive?: boolean
) => {
  const result = await submitSearchAndLoadResults(formData, searchField, dateRange, sortBy, yearRange, filterType, isFilterActive);
  return result.results;
};

export const loadSearchResults = async (
  query: string,
  searchField: SearchField,
  dateRange?: DateRange,
  sortBy?: string,
  yearRange?: [number, number],
  filterType?: "date" | "year",
  index?: number
) => {
  try {
    const { setLoadingResultIndex, setIsLoadingResults } = useUIStore.getState();
    
    if (index !== undefined) {
      setLoadingResultIndex(index);
    }
    setIsLoadingResults(true);

    // Execute search with validation (legacy function doesn't use filters)
    const { searchResult, validationError } = await executeSearchWithValidation({
      query,
      searchField,
      dateRange,
      sortBy,
      yearRange,
      filterType,
      isFilterActive: false
    }, 0, 'Legacy search'); // No cancellation for legacy function
    
    // Handle validation errors
    if (validationError) return;
    
    // Update results in store
    updateResultsInStoreWithDirectData(searchResult!, query, searchField, dateRange, yearRange);
  } catch (error) {
    console.error('Error in loadSearchResults:', error);
    toast.error('Failed to load search results', {
      description: 'Could not load the search results. Please try again.'
    });
  } finally {
    const { setLoadingResultIndex, setIsLoadingResults } = useUIStore.getState();
    setLoadingResultIndex(null);
    setIsLoadingResults(false);
  }
};

export const createSearchMetadata = (
  query: string,
  searchField: SearchField,
  dateRange?: DateRange,
  yearRange?: [number, number]
) => {
  // Use the centralized utility function to create search parameters
  const searchParams = createSearchParameters(query, searchField, dateRange, undefined, yearRange);

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

export const downloadItem = async (item: any, format: 'json' | 'csv') => {
  try {
    const { ratings } = useRatingsStore.getState();
    const { currentQuery, resultsSearchField, resultsDateRange, resultsYearRange } = useResultsStore.getState();
    
    // Expand keywords for export
    const { expandedQuery } = validateAndExpandKeywordsSilently(currentQuery);
    
    const filename = generateFilename(item.title, '', format);
    const itemWithRating = {
      ...item,
      rating: getRatingOrNull(ratings, item.id)
    };
    const metadata = createSearchMetadata(expandedQuery, resultsSearchField, resultsDateRange, resultsYearRange);
    await downloadWithMetadata(itemWithRating, filename, format, metadata);
  } catch (error) {
    console.error('Error downloading item:', error);
    toast.error('Download failed', {
      description: 'Could not download the item. Please try again.'
    });
  }
};

export const downloadEssentialItem = async (item: any, format: 'json' | 'csv') => {
  try {
    const { currentQuery, resultsSearchField, resultsDateRange, resultsYearRange } = useResultsStore.getState();
    
    // Expand keywords for export
    const { expandedQuery } = validateAndExpandKeywordsSilently(currentQuery);
    
    const essentialInfo = getEssentialInfo(item);
    const filename = generateFilename(item.title, 'essential', format);
    const metadata = createSearchMetadata(expandedQuery, resultsSearchField, resultsDateRange, resultsYearRange);
    await downloadWithMetadata(essentialInfo, filename, format, metadata);
  } catch (error) {
    console.error('Error downloading essential item:', error);
    toast.error('Download failed', {
      description: 'Could not download the essential information. Please try again.'
    });
  }
};

export const downloadAll = async (format: 'json' | 'csv', onlyEssential: boolean = false) => {
  try {
    const { ratings } = useRatingsStore.getState();
    const { results, currentQuery, resultsSearchField, resultsDateRange, resultsYearRange } = useResultsStore.getState();
    
    // Expand keywords for export
    const { expandedQuery } = validateAndExpandKeywordsSilently(currentQuery);
    
    const suffix = onlyEssential ? 'essential_all' : 'all';
    const filename = generateFilename(expandedQuery, suffix, format);
    const dataToDownload = onlyEssential 
      ? results.map(getEssentialInfo) 
      : results.map(item => ({
          ...item,
          rating: getRatingOrNull(ratings, item.id)
        }));
    const metadata = createSearchMetadata(expandedQuery, resultsSearchField, resultsDateRange, resultsYearRange);
    await downloadWithMetadata(dataToDownload, filename, format, metadata);
  } catch (error) {
    console.error('Error downloading all items:', error);
    toast.error('Download failed', {
      description: `Could not download all ${onlyEssential ? 'essential ' : ''}items. Please try again.`
    });
  }
};

export const openFocusMode = (isMobile?: boolean) => {
  const { setIsDialogOpen, setIsFocusModeOpen } = useUIStore.getState();
  
  // If isMobile is provided, use it; otherwise fall back to window check for backward compatibility
  const isDesktop = isMobile !== undefined ? !isMobile : window.matchMedia("(min-width: 768px)").matches;
  if (!isDesktop) {
    setIsDialogOpen(false);
  }
  setIsFocusModeOpen(true);
};

export const closeFocusMode = () => {
  const { setIsFocusModeOpen } = useUIStore.getState();
  setIsFocusModeOpen(false);
}; 

export async function handleSearchHistoryClick(
  query: string,
  searchField: any,
  dateRange?: any,
  sortBy?: string,
  yearRange?: [number, number],
  filterType?: "date" | "year",
  index?: number
) {
  try {
    // Find the search result in history to get its ID
    const searchHistory = useSearchHistoryStore.getState().searchHistory;
    let searchResult = searchHistory[index || 0];
    
    if (!searchResult) {
      toast.error('Search not found', {
        description: 'The requested search could not be found in your history.'
      });
      return null;
    }
    
    // If the search result doesn't have an ID, migrate it
    if (!searchResult.id) {
      const { migrateSearchResult } = useSearchHistoryStore.getState();
      const searchId = migrateSearchResult(searchResult);
      const { getSearchResult } = useSearchHistoryStore.getState();
      searchResult = getSearchResult(searchId)!;
    }
    
    // Set the query in the results store (single source of truth)
    const { setCurrentQuery } = useResultsStore.getState();
    
    // Set the query (setSuggestedQuery is now handled centrally by QuerySyncProvider)
    setCurrentQuery(searchResult.query);
    
    // Load the results by ID with the index for loading state
    const result = await loadSearchResultsById(searchResult.id, index);
    
    // Return the search result ID if loading was successful, null otherwise
    return result !== null ? searchResult.id : null;
  } catch (error) {
    console.error('Error handling search history click:', error);
    toast.error('Failed to load search from history', {
      description: 'Could not load the selected search. Please try again.'
    });
    return null;
  }
} 