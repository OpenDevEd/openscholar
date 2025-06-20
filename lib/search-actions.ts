import { toast } from 'sonner';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useUIStore, useSearchHistoryStore, useRatingsStore } from './store';
import { getEffectiveSearchId, createSearchParameters, generateFilename, downloadWithMetadata, getRatingOrNull } from './utils';
import { createSearchStateFromStore } from './search-utils';
import { validateAndExpandKeywords, validateAndExpandKeywordsSilently } from './keyword-validation';
import type { SearchField, SearchFilters } from './types';

// Utility function to extract query from FormData
const extractQueryFromFormData = (formData: FormData): string => {
  return formData.get('query') as string || '';
};

// Utility function to calculate effective date/year ranges based on filter type
const getEffectiveRanges = (dateRange?: DateRange, yearRange?: [number, number], filterType?: "date" | "year", isFilterActive?: boolean, isYearRangeEnabled?: boolean) => {
  const effectiveDateRange = (filterType === "date" && isFilterActive) ? dateRange : undefined;
  const effectiveYearRange = (filterType === "year" && isFilterActive && isYearRangeEnabled) ? yearRange : undefined;
  return { effectiveDateRange, effectiveYearRange };
};

// Helper function to create search state with effective ranges
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
  
  // Create unified filters object
  const filters: SearchFilters = {
    searchField,
    sortBy: sortBy || 'relevance_score:desc',
    filterType: filterType || 'year',
    dateRange: effectiveDateRange,
    yearRange: effectiveYearRange,
    isYearRangeEnabled: undefined, // Will be filled from current search state
    ratingRange: undefined, // Rating filters are handled client-side
    onlyRatedPapers: undefined,
    selectedRegions: [], // Will be filled from current search state
    selectedCountryFocus: [], // Will be filled from current search state
    citesItemId: '', // Will be filled from current search state
    relatedToItemId: '', // Will be filled from current search state
  };
  
  return createSearchStateFromStore(query, filters, resultsCount);
};

// Submit search and create history item (SWR will handle data fetching)
export const submitSearchAndLoadResults = async (
  formData: FormData,
  searchField: SearchField,
  dateRange?: DateRange,
  sortBy?: string,
  yearRange?: [number, number],
  filterType?: "date" | "year",
  isFilterActive?: boolean
) => {
  const { addSearchResult } = useSearchHistoryStore.getState();
  
  const normalizedQuery = extractQueryFromFormData(formData);
  
  // Validate query only - don't perform search
  const validation = validateAndExpandKeywords(normalizedQuery);
  
  // If validation failed, don't create history item
  if (!validation.isValid) {
    return { searchId: null };
  }
  
  // Create search state with validated query
  const searchState = createSearchStateWithEffectiveRanges(
    normalizedQuery,
    searchField,
    dateRange,
    yearRange,
    filterType,
    isFilterActive,
    sortBy,
    0 // Results count will be populated by SWR
  );
  
  const searchId = addSearchResult(searchState);
  
  return { searchId };
};

// Update current search with new query (SWR will handle data fetching)
export const updateCurrentSearch = async (
  formData: FormData,
  searchField: SearchField,
  dateRange?: DateRange,
  sortBy?: string,
  yearRange?: [number, number],
  filterType?: "date" | "year",
  isFilterActive?: boolean
) => {
  const { updateSearchResult } = useSearchHistoryStore.getState();
  
  // Get effective search ID from URL
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null;
  const effectiveSearchId = getEffectiveSearchId(pathname, undefined);
  
  if (!effectiveSearchId) {
    toast.error('No active search', {
      description: 'Please perform a search before updating.'
    });
    throw new Error('No current search ID to update');
  }

  const normalizedQuery = extractQueryFromFormData(formData);
  
  // Validate query only - don't perform search
  const validation = validateAndExpandKeywords(normalizedQuery);
  
  // If validation failed, don't update history item
  if (!validation.isValid) {
    return { searchId: effectiveSearchId };
  }
  
  // Update search history with new query
  const searchState = createSearchStateWithEffectiveRanges(
    normalizedQuery,
    searchField,
    dateRange,
    yearRange,
    filterType,
    isFilterActive,
    sortBy,
    0 // Results count will be populated by SWR
  );
  
  updateSearchResult(effectiveSearchId, searchState);

  return { searchId: effectiveSearchId };
};

// Update current search with new filters and refresh results
export const updateCurrentSearchFilters = async () => {
  const { updateSearchResult, getSearchResult } = useSearchHistoryStore.getState();
  
  // Get effective search ID from URL
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null;
  const effectiveSearchId = getEffectiveSearchId(pathname, undefined);
  
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

  // SWR will automatically refetch when the search parameters change
  // We just need to update the timestamp to trigger a revalidation
  updateSearchResult(effectiveSearchId, { 
    updatedAt: new Date().toISOString() 
  });
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
    relatedToItemId: '',
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