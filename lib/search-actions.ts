import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import posthog from 'posthog-js';
import { useUIStore, useRatingsStore, useSearchHistoryStore } from './store';
import { createSearchParameters, generateFilename, downloadWithMetadata, getRatingOrNull } from './utils';
import { validateAndExpandKeywordsSilently } from './keyword-validation';
import type { SearchField, SearchFilters, ScreeningResponses, PaperResult } from './types';

export type DownloadSearchState = {
  query: string;
  field: SearchField;
  dateRange?: DateRange;
  yearRange?: [number, number];
  searchId?: string;
};

type ItemScreeningResults = Record<string, boolean | null>;

function getScreeningResponsesForSearch(searchState?: DownloadSearchState): ScreeningResponses {
  if (!searchState?.searchId) {
    return {};
  }

  const searchResult = useSearchHistoryStore
    .getState()
    .getSearchResult(searchState.searchId);

  return searchResult?.screeningResponses || {};
}

function getItemScreeningResults(
  itemId: string,
  screeningResponses: ScreeningResponses
): ItemScreeningResults | undefined {
  const screeningResults = screeningResponses[itemId];
  if (!screeningResults || Object.keys(screeningResults).length === 0) {
    return undefined;
  }

  return screeningResults;
}

function withScreeningResults<T extends Record<string, unknown>>(
  payload: T,
  itemId: string,
  screeningResponses: ScreeningResponses,
  format: 'json' | 'csv'
): T & { screening_results?: ItemScreeningResults } {
  if (format !== 'json') {
    return payload;
  }

  const screeningResults = getItemScreeningResults(itemId, screeningResponses);
  if (!screeningResults) {
    return payload;
  }

  return {
    ...payload,
    screening_results: screeningResults,
  };
}

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
    researchAreas: [],
    sdgs: [],
    openAccessOnly: false,
    workTypes: [],
    workLanguages: [],
    institutionTypes: [],
    funders: [],
    minCitations: null,
    hasAbstract: false,
    includeRetracted: false,
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

export const getEssentialInfo = (
  item: PaperResult,
  ratings: Record<string, number>,
  screeningResponses: ScreeningResponses,
  format: 'json' | 'csv'
) => {
  const essentialInfo = {
    id: item.id,
    title: item.title,
    authors: item.authorships?.map((a: { author: { display_name: string } }) => a.author.display_name).join(', ') || '',
    year: item.publication_year,
    abstract: item.abstract || '',
    rating: getRatingOrNull(ratings, item.id),
    ...(item.doi ? { doi: item.doi } : {}),
    ...(item.open_access?.oa_url ? { pdf_url: item.open_access.oa_url } : {}),
  };

  return withScreeningResults(essentialInfo, item.id, screeningResponses, format);
};

export type DownloadToastLabels = {
  item?: string;
  essentialItem?: string;
  results?: string;
};

export type ToastApi = {
  io: { downloadFailed: (formatLabel: string) => void };
};

export const downloadItem = async (
  item: PaperResult,
  format: 'json' | 'csv',
  toast: ToastApi,
  searchState?: DownloadSearchState,
  labels?: DownloadToastLabels
) => {
  const formatLabel = labels?.item ?? 'item';
  try {
    const { ratings } = useRatingsStore.getState();
    const screeningResponses = getScreeningResponsesForSearch(searchState);
    
    if (!searchState) {
      toast.io.downloadFailed(formatLabel);
      return;
    }
    
    // Expand keywords for export
    const { expandedQuery } = validateAndExpandKeywordsSilently(searchState.query);
    
    const filename = generateFilename(item.title || '', '', format);
    const itemWithRating = withScreeningResults(
      {
        ...item,
        rating: getRatingOrNull(ratings, item.id)
      },
      item.id,
      screeningResponses,
      format
    );
    const metadata = createSearchMetadata(expandedQuery, searchState.field, searchState.dateRange, searchState.yearRange);
    await downloadWithMetadata(itemWithRating, filename, format, metadata as unknown as Parameters<typeof downloadWithMetadata>[3]);
  } catch (error) {
    console.error('Error downloading item:', error);
    toast.io.downloadFailed(formatLabel);
  }
};

export const downloadEssentialItem = async (
  item: PaperResult,
  format: 'json' | 'csv',
  toast: ToastApi,
  searchState?: DownloadSearchState,
  labels?: DownloadToastLabels
) => {
  const formatLabel = labels?.essentialItem ?? 'essential item';
  try {
    const { ratings } = useRatingsStore.getState();
    const screeningResponses = getScreeningResponsesForSearch(searchState);

    if (!searchState) {
      toast.io.downloadFailed(formatLabel);
      return;
    }
    
    // Expand keywords for export
    const { expandedQuery } = validateAndExpandKeywordsSilently(searchState.query);
    
    const essentialInfo = getEssentialInfo(item, ratings, screeningResponses, format);
    const filename = generateFilename(item.title || '', 'essential', format);
    const metadata = createSearchMetadata(expandedQuery, searchState.field, searchState.dateRange, searchState.yearRange);
    await downloadWithMetadata(essentialInfo, filename, format, metadata as unknown as Parameters<typeof downloadWithMetadata>[3]);
  } catch (error) {
    console.error('Error downloading essential item:', error);
    toast.io.downloadFailed(formatLabel);
  }
};

export const downloadAll = async (
  format: 'json' | 'csv',
  toast: ToastApi,
  onlyEssential: boolean = false,
  searchState?: DownloadSearchState,
  results?: PaperResult[],
  labels?: DownloadToastLabels
) => {
  const formatLabel = labels?.results ?? 'results';
  try {
    const { ratings } = useRatingsStore.getState();
    const screeningResponses = getScreeningResponsesForSearch(searchState);
    
    if (!searchState || !results) {
      toast.io.downloadFailed(formatLabel);
      return;
    }

    // Expand keywords for export
    const { expandedQuery } = validateAndExpandKeywordsSilently(searchState.query);
    
    const filename = generateFilename('search_results', onlyEssential ? 'essential' : '', format);
    const dataToDownload = onlyEssential 
      ? results.map((item) => getEssentialInfo(item, ratings, screeningResponses, format))
      : results.map(item =>
          withScreeningResults(
            {
              ...item,
              rating: getRatingOrNull(ratings, item.id)
            },
            item.id,
            screeningResponses,
            format
          )
        );
    
    const metadata = createSearchMetadata(expandedQuery, searchState.field, searchState.dateRange, searchState.yearRange);
    await downloadWithMetadata(dataToDownload, filename, format, metadata as unknown as Parameters<typeof downloadWithMetadata>[3]);
  } catch (error) {
    console.error('Error downloading all results:', error);
    toast.io.downloadFailed(formatLabel);
  }
};

export const openFocusMode = (
  isMobile?: boolean,
  initialIndex: number = 0,
  paperId?: string
) => {
  const { setIsDialogOpen, setIsFocusModeOpen, setFocusModeIndex } = useUIStore.getState();

  // If isMobile is provided, use it; otherwise fall back to window check for backward compatibility
  const isDesktop = isMobile !== undefined ? !isMobile : window.matchMedia("(min-width: 768px)").matches;
  if (!isDesktop) {
    setIsDialogOpen(false);
  }
  setFocusModeIndex(initialIndex);
  setIsFocusModeOpen(true);

  // Track focus mode opened
  posthog.capture("focus_mode_opened", {
    from_position: initialIndex,
    paper_id: paperId ?? null,
  });
};
