import { toast } from 'sonner';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useUIStore, useRatingsStore } from './store';
import { createSearchParameters, generateFilename, downloadWithMetadata, getRatingOrNull } from './utils';
import { validateAndExpandKeywordsSilently } from './keyword-validation';
import type { SearchField, SearchFilters } from './types';

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