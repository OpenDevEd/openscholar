import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { startSearch, getSearchResults } from '@/app/actions/openalex';
import { SearchField, getRatingOrNull, generateFilename, downloadWithMetadata } from './utils';
import { useUIStore, useResultsStore, useSearchHistoryStore, useRatingsStore, useSearchFormStore } from './store';

// Global search index counter to prevent race conditions
let globalSearchIndex = 0;

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
  // Increment search index for this request
  const currentSearchIndex = ++globalSearchIndex;
  
  try {
    const { setIsLoading } = useUIStore.getState();
    const { addSearchResult } = useSearchHistoryStore.getState();
    const { 
      setCurrentQuery, 
      setCurrentPage, 
      setResults, 
      setResultsSearchField, 
      setResultsDateRange, 
      setResultsYearRange 
    } = useResultsStore.getState();
    const { setCurrentSearchId } = useSearchFormStore.getState();
    
    setIsLoading(true);
    const rawQuery = formData.get("query") as string;
    // Normalize whitespace: replace newlines, tabs, and multiple spaces with single spaces
    const normalizedQuery = rawQuery.replace(/\s+/g, ' ').trim();
    
    // Determine which range to use based on filter type
    const effectiveDateRange = (filterType === "date" && isFilterActive) ? dateRange : undefined;
    const effectiveYearRange = (filterType === "year" && isFilterActive) ? yearRange : undefined;
    
    // Get full results (which includes the count in meta)
    const results = await getSearchResults(normalizedQuery, searchField, effectiveDateRange, sortBy, effectiveYearRange);
    
    // Check if this is still the latest search before applying results
    if (currentSearchIndex !== globalSearchIndex) {
      console.log(`Search ${currentSearchIndex} cancelled - newer search ${globalSearchIndex} in progress`);
      return { results, searchId: null };
    }
    
    // Add to search history and get the ID
    const searchId = addSearchResult({ 
      query: normalizedQuery, 
      count: results.meta.count, 
      field: searchField, 
      dateRange: effectiveDateRange,
      yearRange: effectiveYearRange,
      filterType,
      sortBy 
    });

    // Set current search ID
    setCurrentSearchId(searchId);

    // Set results in store
    setCurrentQuery(normalizedQuery);
    setCurrentPage(1);
    setResults(results.results, results.meta.count);
    setResultsSearchField(searchField);
    setResultsDateRange(effectiveDateRange);
    setResultsYearRange(effectiveYearRange);

    return { results, searchId };
  } finally {
    // Only clear loading if this is still the latest search
    if (currentSearchIndex === globalSearchIndex) {
      const { setIsLoading } = useUIStore.getState();
      setIsLoading(false);
    }
  }
};

// Load search results by ID and update current state
export const loadSearchResultsById = async (searchId: string, index?: number) => {
  // Increment search index for this request
  const currentSearchIndex = ++globalSearchIndex;
  
  try {
    const { setIsLoading, setLoadingResultIndex } = useUIStore.getState();
    const { getSearchResult, migrateSearchResult } = useSearchHistoryStore.getState();
    const { 
      setCurrentQuery, 
      setCurrentPage, 
      setResults, 
      setResultsSearchField, 
      setResultsDateRange, 
      setResultsYearRange 
    } = useResultsStore.getState();
    const { loadSearchState } = useSearchFormStore.getState();
    
    setIsLoading(true);
    if (index !== undefined) {
      setLoadingResultIndex(index);
    }
    
    let searchResult = getSearchResult(searchId);
    
    // If not found, this might be a legacy search - try to migrate
    if (!searchResult) {
      throw new Error(`Search with ID ${searchId} not found`);
    }
    
    // Ensure the search result has an ID (migration)
    if (!searchResult.id) {
      migrateSearchResult(searchResult);
    }
    
    // Load the search state into form store
    loadSearchState(searchResult);
    
    // Get fresh results with current search parameters
    const results = await getSearchResults(
      searchResult.query, 
      searchResult.field, 
      searchResult.dateRange, 
      searchResult.sortBy, 
      searchResult.yearRange
    );
    
    // Check if this is still the latest search before applying results
    if (currentSearchIndex !== globalSearchIndex) {
      console.log(`Search ${currentSearchIndex} cancelled - newer search ${globalSearchIndex} in progress`);
      return results;
    }
    
    // Update results in store
    setCurrentQuery(searchResult.query);
    setCurrentPage(1);
    setResults(results.results, results.meta.count);
    setResultsSearchField(searchResult.field);
    setResultsDateRange(searchResult.dateRange);
    setResultsYearRange(searchResult.yearRange);

    return results;
  } finally {
    // Only clear loading if this is still the latest search
    if (currentSearchIndex === globalSearchIndex) {
      const { setIsLoading, setLoadingResultIndex } = useUIStore.getState();
      setIsLoading(false);
      setLoadingResultIndex(null);
    }
  }
};

// Update current search with new filters and refresh results
export const updateCurrentSearchFilters = async () => {
  // Increment search index for this request
  const currentSearchIndex = ++globalSearchIndex;
  
  try {
    const { setIsFilterLoading } = useUIStore.getState();
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
    const { 
      setCurrentQuery, 
      setCurrentPage, 
      setResults, 
      setResultsSearchField, 
      setResultsDateRange, 
      setResultsYearRange 
    } = useResultsStore.getState();
    
    if (!currentSearchId) {
      throw new Error('No current search ID to update');
    }
    
    const currentSearch = getSearchResult(currentSearchId);
    if (!currentSearch) {
      throw new Error('Current search not found in history');
    }
    
    setIsFilterLoading(true);
    
    // Determine which range to use based on filter type
    const effectiveDateRange = (filterType === "date" && isFilterActive) ? dateRange : undefined;
    const effectiveYearRange = (filterType === "year" && isFilterActive) ? yearRange : undefined;
    
    // Update the search result in history
    updateSearchResult(currentSearchId, {
      field: currentSearchField,
      dateRange: effectiveDateRange,
      yearRange: effectiveYearRange,
      filterType,
      sortBy,
    });
    
    // Get fresh results with updated parameters
    const results = await getSearchResults(
      currentSearch.query, 
      currentSearchField, 
      effectiveDateRange, 
      sortBy, 
      effectiveYearRange
    );
    
    // Check if this is still the latest search before applying results
    if (currentSearchIndex !== globalSearchIndex) {
      console.log(`Filter update ${currentSearchIndex} cancelled - newer search ${globalSearchIndex} in progress`);
      return results;
    }
    
    // Update the count in search history
    updateSearchResult(currentSearchId, {
      count: results.meta.count,
    });
    
    // Update results in store
    setCurrentQuery(currentSearch.query);
    setCurrentPage(1);
    setResults(results.results, results.meta.count);
    setResultsSearchField(currentSearchField);
    setResultsDateRange(effectiveDateRange);
    setResultsYearRange(effectiveYearRange);

    return results;
  } finally {
    // Only clear loading if this is still the latest search
    if (currentSearchIndex === globalSearchIndex) {
      const { setIsFilterLoading } = useUIStore.getState();
      setIsFilterLoading(false);
    }
  }
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
    const { 
      setCurrentQuery, 
      setCurrentPage, 
      setResults, 
      setResultsSearchField, 
      setResultsDateRange, 
      setResultsYearRange 
    } = useResultsStore.getState();
    
    if (index !== undefined) {
      setLoadingResultIndex(index);
    }
    setIsLoadingResults(true);
    setCurrentQuery(query);
    setCurrentPage(1);
    const results = await getSearchResults(query, searchField, dateRange, sortBy, yearRange);
    setResults(results.results, results.meta.count);
    setResultsSearchField(searchField);
    setResultsDateRange(dateRange);
    setResultsYearRange(yearRange);
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
  const searchParams: any = {
    search: query,
    searchField: searchField,
    perPage: 200,
    AbstractArrayToString: true
  };

  // Add date range filtering if provided
  if (dateRange?.from || dateRange?.to) {
    searchParams.filter = {};
    
    if (dateRange?.from) {
      const fromDate = dateRange.from.toISOString().split('T')[0];
      searchParams.filter.from_publication_date = fromDate;
    }
    
    if (dateRange?.to) {
      const toDate = dateRange.to.toISOString().split('T')[0];
      searchParams.filter.to_publication_date = toDate;
    }
  } else if (yearRange) {
    searchParams.filter = {};
    searchParams.filter.from_publication_date = `${yearRange[0]}-01-01`;
    searchParams.filter.to_publication_date = `${yearRange[1]}-12-31`;
  }

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
  const { ratings } = useRatingsStore.getState();
  const { currentQuery, resultsSearchField, resultsDateRange, resultsYearRange } = useResultsStore.getState();
  
  const filename = generateFilename(item.title, '', format);
  const itemWithRating = {
    ...item,
    rating: getRatingOrNull(ratings, item.id)
  };
  const metadata = createSearchMetadata(currentQuery, resultsSearchField, resultsDateRange, resultsYearRange);
  await downloadWithMetadata(itemWithRating, filename, format, metadata);
};

export const downloadEssentialItem = async (item: any, format: 'json' | 'csv') => {
  const { currentQuery, resultsSearchField, resultsDateRange, resultsYearRange } = useResultsStore.getState();
  
  const essentialInfo = getEssentialInfo(item);
  const filename = generateFilename(item.title, 'essential', format);
  const metadata = createSearchMetadata(currentQuery, resultsSearchField, resultsDateRange, resultsYearRange);
  await downloadWithMetadata(essentialInfo, filename, format, metadata);
};

export const downloadAll = async (format: 'json' | 'csv', onlyEssential: boolean = false) => {
  const { ratings } = useRatingsStore.getState();
  const { results, currentQuery, resultsSearchField, resultsDateRange, resultsYearRange } = useResultsStore.getState();
  
  const suffix = onlyEssential ? 'essential_all' : 'all';
  const filename = generateFilename(currentQuery, suffix, format);
  const dataToDownload = onlyEssential 
    ? results.map(getEssentialInfo) 
    : results.map(item => ({
        ...item,
        rating: getRatingOrNull(ratings, item.id)
      }));
  const metadata = createSearchMetadata(currentQuery, resultsSearchField, resultsDateRange, resultsYearRange);
  await downloadWithMetadata(dataToDownload, filename, format, metadata);
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