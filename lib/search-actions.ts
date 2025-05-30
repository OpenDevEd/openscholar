import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { startSearch, getSearchResults } from '@/app/actions/openalex';
import { SearchField, getRatingOrNull, generateFilename, downloadWithMetadata } from './utils';
import { useUIStore, useResultsStore, useSearchHistoryStore, useRatingsStore } from './store';

export const submitSearch = async (
  formData: FormData,
  searchField: SearchField,
  dateRange?: DateRange,
  sortBy?: string,
  yearRange?: [number, number],
  filterType?: "date" | "year",
  isFilterActive?: boolean
) => {
  try {
    const { setIsLoading } = useUIStore.getState();
    const { addSearchResult } = useSearchHistoryStore.getState();
    
    setIsLoading(true);
    const rawQuery = formData.get("query") as string;
    // Normalize whitespace: replace newlines, tabs, and multiple spaces with single spaces
    const normalizedQuery = rawQuery.replace(/\s+/g, ' ').trim();
    
    // Create new FormData with normalized query
    const normalizedFormData = new FormData();
    normalizedFormData.set("query", normalizedQuery);
    
    // Determine which range to use based on filter type
    const effectiveDateRange = (filterType === "date" && isFilterActive) ? dateRange : undefined;
    const effectiveYearRange = (filterType === "year" && isFilterActive) ? yearRange : undefined;
    
    const count = await startSearch(normalizedFormData, searchField, effectiveDateRange, sortBy, effectiveYearRange);
    addSearchResult({ 
      query: normalizedQuery, 
      count, 
      field: searchField, 
      dateRange: effectiveDateRange,
      yearRange: effectiveYearRange,
      filterType,
      sortBy 
    });
  } finally {
    const { setIsLoading } = useUIStore.getState();
    setIsLoading(false);
  }
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
    const { setLoadingResultIndex, setIsLoadingResults, setIsDialogOpen } = useUIStore.getState();
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
    setResults(results.results);
    setResultsSearchField(searchField);
    setResultsDateRange(dateRange);
    setResultsYearRange(yearRange);
    setIsDialogOpen(true);
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

export const openFocusMode = () => {
  const { setIsDialogOpen, setIsFocusModeOpen } = useUIStore.getState();
  
  const isDesktop = window.matchMedia("(min-width: 768px)").matches;
  if (!isDesktop) {
    setIsDialogOpen(false);
  }
  setIsFocusModeOpen(true);
};

export const closeFocusMode = () => {
  const { setIsFocusModeOpen } = useUIStore.getState();
  setIsFocusModeOpen(false);
}; 