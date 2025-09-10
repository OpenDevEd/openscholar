import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { Work } from "@sickrin/openalex-sdk/dist/src/types/work";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import type { SearchResult } from './store'
import type { SearchField, SearchFilters } from './types'
import { getCountryCodesForRegions, MIN_YEAR } from './constants'

export const fields = [
  { value: "title_and_abstract", label: "Title, abstract" },
  { value: "title", label: "Title" },
  { value: "abstract", label: "Abstract" },
  { value: "fulltext", label: "Fulltext" },
  { value: "display_name", label: "Display name" }
] as const;

// Centralized default filter values
export const DEFAULT_FILTERS = {
  field: 'title_and_abstract' as SearchField,
  sortBy: 'relevance_score:desc',
  filterType: 'year' as 'date' | 'year',
  yearRange: () => [MIN_YEAR, new Date().getFullYear()] as [number, number],
  isYearRangeEnabled: false, // Default is no year filter (unchecked)
  dateRange: undefined as DateRange | undefined,
  ratingRange: [0, 5] as [number, number],
  onlyRatedPapers: false,
  selectedRegions: [] as string[],
  selectedCountryFocus: [] as string[],
  citesItemId: '',
  citedByItemId: '',
  relatedToItemId: '',
  reviewFilter: false,
} as const;

/**
 * Creates a default SearchFilters object
 */
export function createDefaultFilters(): SearchFilters {
  return {
    searchField: DEFAULT_FILTERS.field,
    sortBy: DEFAULT_FILTERS.sortBy,
    filterType: DEFAULT_FILTERS.filterType,
    yearRange: DEFAULT_FILTERS.yearRange(),
    isYearRangeEnabled: DEFAULT_FILTERS.isYearRangeEnabled,
    dateRange: DEFAULT_FILTERS.dateRange,
    ratingRange: DEFAULT_FILTERS.ratingRange,
    onlyRatedPapers: DEFAULT_FILTERS.onlyRatedPapers,
    selectedRegions: [...DEFAULT_FILTERS.selectedRegions],
    selectedCountryFocus: [...DEFAULT_FILTERS.selectedCountryFocus],
    citesItemId: DEFAULT_FILTERS.citesItemId,
    citedByItemId: DEFAULT_FILTERS.citedByItemId,
    relatedToItemId: DEFAULT_FILTERS.relatedToItemId,
    reviewFilter: DEFAULT_FILTERS.reviewFilter,
  };
}

/**
 * Check if all filters are at their default values
 */
export function areFiltersAtDefault(filters: SearchFilters): boolean {
  const defaults = createDefaultFilters();
  return (
    filters.searchField === defaults.searchField &&
    filters.sortBy === defaults.sortBy &&
    filters.filterType === defaults.filterType &&
    isFilterAtDefault.yearRange(filters.yearRange) &&
    isFilterAtDefault.isYearRangeEnabled(filters.isYearRangeEnabled) &&
    isFilterAtDefault.dateRange(filters.dateRange) &&
    isFilterAtDefault.ratingRange(filters.ratingRange) &&
    isFilterAtDefault.onlyRatedPapers(filters.onlyRatedPapers) &&
    isFilterAtDefault.selectedRegions(filters.selectedRegions) &&
    isFilterAtDefault.selectedCountryFocus(filters.selectedCountryFocus) &&
    isFilterAtDefault.citesItemId(filters.citesItemId) &&
    isFilterAtDefault.citedByItemId(filters.citedByItemId) &&
    isFilterAtDefault.relatedToItemId(filters.relatedToItemId) &&
    isFilterAtDefault.reviewFilter(filters.reviewFilter)
  );
}

/**
 * Count the number of active (non-default) filters
 */
export function countActiveFilters(filters: SearchFilters): number {
  let count = 0;
  if (filters.searchField !== DEFAULT_FILTERS.field) count++;
  if (filters.sortBy !== DEFAULT_FILTERS.sortBy) count++;
  if (isDateFilterActive(filters.dateRange, filters.yearRange, filters.filterType, filters.isYearRangeEnabled)) count++;
  if (isRatingFilterActive(filters.ratingRange, filters.onlyRatedPapers)) count++;
  if (isCountryFilterActive(filters.selectedRegions)) count++;
  if (isCountryFocusActive(filters.selectedCountryFocus)) count++;
  if (isCitesFilterActive(filters.citesItemId)) count++;
  if (isCitedByFilterActive(filters.citedByItemId)) count++;
  if (isRelatedToFilterActive(filters.relatedToItemId)) count++;
  if (isReviewFilterActive(filters.reviewFilter)) count++;
  return count;
}

// Utility functions to check if filters are at default values
export const isFilterAtDefault = {
  yearRange: (range?: [number, number]) => {
    if (!range) return true;
    const defaultRange = DEFAULT_FILTERS.yearRange();
    return range[0] === defaultRange[0] && range[1] === defaultRange[1];
  },
  isYearRangeEnabled: (enabled?: boolean) => enabled === undefined || enabled === DEFAULT_FILTERS.isYearRangeEnabled,
  dateRange: (range?: DateRange) => !range,
  ratingRange: (range?: [number, number]) => {
    if (!range) return true;
    return range[0] === DEFAULT_FILTERS.ratingRange[0] && range[1] === DEFAULT_FILTERS.ratingRange[1];
  },
  onlyRatedPapers: (value?: boolean) => value === undefined || value === DEFAULT_FILTERS.onlyRatedPapers,
  selectedRegions: (regions?: string[]) => !regions || regions.length === 0,
  selectedCountryFocus: (focus?: string[]) => !focus || focus.length === 0,
  citesItemId: (id?: string) => !id || id === DEFAULT_FILTERS.citesItemId,
  citedByItemId: (id?: string) => !id || id === DEFAULT_FILTERS.citedByItemId,
  relatedToItemId: (id?: string) => !id || id === DEFAULT_FILTERS.relatedToItemId,
  reviewFilter: (value?: boolean) => value === undefined || value === DEFAULT_FILTERS.reviewFilter,
};

// Helper to check if rating filter is active (combines range and onlyRatedPapers)
export const isRatingFilterActive = (range?: [number, number], onlyRated?: boolean) => {
  // If onlyRatedPapers is false, the filter is inactive regardless of range
  if (onlyRated === false) {
    return false;
  }
  // If onlyRatedPapers is true, check if either the toggle or range is non-default
  return !isFilterAtDefault.onlyRatedPapers(onlyRated) || !isFilterAtDefault.ratingRange(range);
};

// Helper to check if any date/year filter is active based on current filter type
export const isDateFilterActive = (dateRange?: DateRange, yearRange?: [number, number], filterType?: "date" | "year", isYearRangeEnabled?: boolean) => {
  if (filterType === "date") {
    return !isFilterAtDefault.dateRange(dateRange);
  } else if (filterType === "year") {
    // Year filter is only active if the toggle is enabled
    return !isFilterAtDefault.isYearRangeEnabled(isYearRangeEnabled);
  }
  // Fallback to old behavior if filterType is not provided (for backward compatibility)
  return !isFilterAtDefault.dateRange(dateRange) || (!isFilterAtDefault.isYearRangeEnabled(isYearRangeEnabled));
};

// Helper to check if country filter is active
export const isCountryFilterActive = (regions?: string[]) => {
  return !isFilterAtDefault.selectedRegions(regions);
};

// Helper to check if country focus filter is active  
export const isCountryFocusActive = (focus?: string[]) => {
  return !isFilterAtDefault.selectedCountryFocus(focus);
};

// Helper to check if cites filter is active
export const isCitesFilterActive = (citesItemId?: string) => {
  return !isFilterAtDefault.citesItemId(citesItemId);
};

// Helper to check if cited by filter is active
export const isCitedByFilterActive = (citedByItemId?: string) => {
  return !isFilterAtDefault.citedByItemId(citedByItemId);
};

// Helper to check if related-to filter is active
export const isRelatedToFilterActive = (relatedToItemId?: string) => {
  return !isFilterAtDefault.relatedToItemId(relatedToItemId);
};

// Helper to check if review filter is active
export const isReviewFilterActive = (reviewFilter?: boolean) => {
  return !isFilterAtDefault.reviewFilter(reviewFilter);
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

type JsonObject = { [key: string]: any }

function escapeCSVValue(value: any): string {
  if (value === null || value === undefined) return ''
  
  const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
  
  // If the value contains quotes, commas, newlines, or is an empty string, it needs to be quoted
  if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('\r') || stringValue === '') {
    // Double up any quotes and wrap the whole thing in quotes
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  
  return stringValue
}

export function jsonToCSV(data: JsonObject | JsonObject[]): string {
  const items = Array.isArray(data) ? data : [data]
  if (items.length === 0) return ''

  // Get all unique keys from all objects
  const headers = Array.from(
    new Set(
      items.reduce((keys: string[], item) => {
        return keys.concat(Object.keys(item))
      }, [])
    )
  ).sort() // Sort headers for consistent output

  // Create CSV header row with properly escaped header names
  const csvRows = [headers.map(header => escapeCSVValue(header)).join(',')]

  // Create data rows
  items.forEach((item) => {
    const row = headers.map(header => escapeCSVValue(item[header]))
    csvRows.push(row.join(','))
  })

  return csvRows.join('\n')
}

export function downloadAsFile(content: string, filename: string, type: 'json' | 'csv') {
  const mimeTypes = {
    json: 'application/json',
    csv: 'text/csv'
  }
  
  // For CSV, add BOM for Excel compatibility
  const bom = type === 'csv' ? '\ufeff' : ''
  const blob = new Blob([bom + content], { type: mimeTypes[type] })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Helper function to get rating with null fallback
 */
export function getRatingOrNull(ratings: Record<string, number>, itemId: string): number | null {
  return ratings[itemId] !== undefined ? ratings[itemId] : null;
}

/**
 * Helper function to generate clean filenames
 */
export function generateFilename(title: string, suffix: string = '', extension: 'json' | 'csv'): string {
  const cleanTitle = title.slice(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const suffixPart = suffix ? `_${suffix}` : '';
  return `${cleanTitle}${suffixPart}.${extension}`;
}

/**
 * Helper function to handle download with metadata
 */
export async function downloadWithMetadata(
  data: any,
  filename: string,
  format: 'json' | 'csv',
  metadata?: any
) {
  if (format === 'json') {
    const dataWithMetadata = metadata ? { ...metadata, res: data } : data;
    downloadAsFile(JSON.stringify(dataWithMetadata, null, 2), filename, 'json');
  } else {
    const csv = await jsonToCSV(data);
    downloadAsFile(csv, filename, 'csv');
  }
}

/**
 * Creates search parameters object for OpenAlex API calls
 * Used by both the OpenAlex action and search metadata creation
 */
export function createSearchParameters(
  query: string,
  filters: SearchFilters
) {
  const searchParams: any = {
    perPage: 200,
    AbstractArrayToString: true
  };

  // Build filter object
  const apiFilters: any = {};

  // Handle search based on field type
  if (query) {
    // Map search fields to SDK filter format
    const searchFilterMap = {
      'title_and_abstract': 'title_and_abstract',
      'title': 'title',
      'abstract': 'abstract', 
      'fulltext': 'fulltext',
      'display_name': 'display_name'
    } as const;
    
    if (filters.searchField in searchFilterMap) {
      // Use search filters for specific fields
      const filterKey = searchFilterMap[filters.searchField as keyof typeof searchFilterMap];
      
      // For the SDK, we use the filter object with search subfields
      if (filterKey === 'title_and_abstract') {
        apiFilters.title_and_abstract = { search: query };
      } else if (filterKey === 'title') {
        apiFilters.title = { search: query };
      } else if (filterKey === 'abstract') {
        apiFilters.abstract = { search: query };
      } else if (filterKey === 'fulltext') {
        apiFilters.fulltext = { search: query };
      } else if (filterKey === 'display_name') {
        apiFilters.display_name = { search: query };
      }
    } else {
      // Fallback to main search
      searchParams.search = query;
    }
  }

  // Add cites filtering
  if (filters.citesItemId) {
    // Clean the item ID to ensure it's in the correct format
    const cleanItemId = filters.citesItemId.startsWith('https://openalex.org/') ? filters.citesItemId : `https://openalex.org/${filters.citesItemId}`;
    apiFilters.cites = cleanItemId;
  }

  // Add cited_by filtering
  if (filters.citedByItemId) {
    // Clean the item ID to ensure it's in the correct format
    const cleanItemId = filters.citedByItemId.startsWith('https://openalex.org/') ? filters.citedByItemId : `https://openalex.org/${filters.citedByItemId}`;
    apiFilters.cited_by = cleanItemId;
  }

  // Add related_to filtering
  if (filters.relatedToItemId) {
    // Clean the item ID to ensure it's in the correct format
    const cleanItemId = filters.relatedToItemId.startsWith('https://openalex.org/') ? filters.relatedToItemId : `https://openalex.org/${filters.relatedToItemId}`;
    apiFilters.related_to = cleanItemId;
  }

  // Helper function to convert date to ISO string format
  const toISODateString = (date: Date | string): string => {
    if (typeof date === 'string') {
      // Already an ISO string, extract date part
      return date.split('T')[0];
    }
    // It's a Date object, convert to ISO string
    return date.toISOString().split('T')[0];
  };

  // Add date filtering
  if (filters.dateRange?.from || filters.dateRange?.to || filters.yearRange) {
    if (filters.dateRange?.from) {
      const fromDate = toISODateString(filters.dateRange.from);
      apiFilters.from_publication_date = fromDate;
    }
    if (filters.dateRange?.to) {
      const toDate = toISODateString(filters.dateRange.to);
      apiFilters.to_publication_date = toDate;
    }
    if (filters.yearRange && !filters.dateRange?.from && !filters.dateRange?.to) {
      apiFilters.from_publication_date = `${filters.yearRange[0]}-01-01`;
      apiFilters.to_publication_date = `${filters.yearRange[1]}-12-31`;
    }
  }
  
  // Country filtering (for Institution location - author affiliations)
  // Process selectedRegions into country codes for the API
  const updateCountryData = isCountryFilterActive(filters.selectedRegions) ? getCountryCodesForRegions(filters.selectedRegions) : null;
  const countryCodes = updateCountryData ? updateCountryData.countries : undefined;
  
  if (countryCodes && countryCodes.length > 0) {
    apiFilters.authorships = {
      countries: countryCodes.join('|')
    };
  }

  // Add filters to search params if we have any
  if (Object.keys(apiFilters).length > 0) {
    searchParams.filter = apiFilters;
  }

  // Add sorting
  if (filters.sortBy) {
    const [field, order] = filters.sortBy.split(':');
    searchParams.sortBy = {
      field: field as any,
      order: order as 'asc' | 'desc'
    };
  } else {
    // Default sorting
    searchParams.sortBy = {
      field: 'relevance_score',
      order: 'desc'
    };
  }

  return searchParams;
}

/**
 * Converts OpenAlex Work data to COINS (COinS - ContextObjects in Spans) format
 * following the Z39.88 standard for bibliographic metadata embedding
 * 
 * @param work - OpenAlex Work object
 * @returns COINS-formatted string for use in title attribute of span elements
 */
export function workToCoins(work: Work): string {
  const params: Record<string, string> = {}

  // Basic OpenURL context information
  params['ctx_ver'] = 'Z39.88-2004'
  params['rft_val_fmt'] = 'info:ofi/fmt:kev:mtx:journal'
  params['rft.genre'] = 'article'

  // Title
  if (work.title) {
    params['rft.atitle'] = work.title
  }

  // Journal/Source information
  if (work.primary_location?.source?.display_name) {
    params['rft.jtitle'] = work.primary_location.source.display_name
  }

  // Publication date/year
  if (work.publication_year) {
    params['rft.date'] = work.publication_year.toString()
  }
  if (work.publication_date) {
    params['rft.date'] = work.publication_date
  }

  // Volume, Issue, Pages from biblio
  if (work.biblio?.volume) {
    params['rft.volume'] = work.biblio.volume
  }
  if (work.biblio?.issue) {
    params['rft.issue'] = work.biblio.issue
  }
  if (work.biblio?.first_page) {
    params['rft.spage'] = work.biblio.first_page
  }
  if (work.biblio?.last_page) {
    params['rft.epage'] = work.biblio.last_page
  }

  // Collect all identifiers
  const identifiers: string[] = []
  
  // DOI
  if (work.doi) {
    const cleanDoi = work.doi.replace('https://doi.org/', '')
    identifiers.push(`info:doi/${cleanDoi}`)
  }

  // OpenAlex ID as alternative identifier
  if (work.id) {
    identifiers.push(work.id)
  }

  // PMID if available
  if (work.ids?.pmid) {
    identifiers.push(`info:pmid/${work.ids.pmid.replace('https://pubmed.ncbi.nlm.nih.gov/', '')}`)
  }

  // PDF URL from open access data - this is crucial for Zotero PDF detection
  if (work.open_access?.oa_url) {
    identifiers.push(work.open_access.oa_url)
  }

  // Add the primary identifier (prefer DOI, then OpenAlex ID)
  if (identifiers.length > 0) {
    params['rft_id'] = identifiers[0]
  }

  // Authors
  if (work.authorships && work.authorships.length > 0) {
    work.authorships.forEach((authorship, index) => {
      if (authorship.author?.display_name) {
        if (index === 0) {
          params['rft.aulast'] = authorship.author.display_name.split(' ').pop() || ''
          params['rft.aufirst'] = authorship.author.display_name.split(' ').slice(0, -1).join(' ')
        }
        params[`rft.au`] = authorship.author.display_name
      }
    })
  }

  // ISSN
  if (work.primary_location?.source?.issn) {
    const issns = Array.isArray(work.primary_location.source.issn) 
      ? work.primary_location.source.issn 
      : [work.primary_location.source.issn]
    if (issns.length > 0) {
      params['rft.issn'] = issns[0]
    }
  }

  // Language
  if (work.language) {
    params['rft.language'] = work.language
  }

  // Abstract (not standard COINS but useful)
  if (work.abstract) {
    params['rft.description'] = work.abstract
  }

  // Keywords/Topics
  if (work.keywords && work.keywords.length > 0) {
    params['rft.subject'] = work.keywords.map(k => k.keyword || '').filter(Boolean).join('; ')
  }

  // Convert params to URL-encoded string
  const coinsString = Object.entries(params)
    .filter(([key, value]) => value && value.trim() !== '')
    .map(([key, value]) => {
      // Handle multiple authors - they should appear as multiple rft.au parameters
      if (key === 'rft.au' && work.authorships && work.authorships.length > 1) {
        return work.authorships
          .filter(auth => auth.author?.display_name)
          .map(auth => `rft.au=${encodeURIComponent(auth.author!.display_name!)}`)
          .join('&')
      }
      // Handle multiple identifiers - they should appear as multiple rft_id parameters
      if (key === 'rft_id' && identifiers.length > 1) {
        return identifiers
          .map(id => `rft_id=${encodeURIComponent(id)}`)
          .join('&')
      }
      return `${key}=${encodeURIComponent(value)}`
    })
    .join('&')

  return coinsString
}

export const formatDateRange = (dateRange?: DateRange, yearRange?: [number, number]): string | undefined => {
  if (dateRange?.from && dateRange?.to) {
    return `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`;
  } else if (dateRange?.from) {
    return `From ${format(dateRange.from, "MMM dd, yyyy")}`;
  } else if (yearRange) {
    return `${yearRange[0]} - ${yearRange[1]}`;
  }
  return undefined;
};

export const getFieldLabel = (searchField: SearchField): string => {
  return fields.find(f => f.value === searchField)?.label || searchField;
};

/**
 * Helper function to handle file upload and parsing
 */
export function uploadFile(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        
        if (file.type === 'application/json' || file.name.endsWith('.json')) {
          const data = JSON.parse(content);
          // Handle both array and single object
          const items = Array.isArray(data) ? data : [data];
          resolve(items);
        } else if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
          const lines = content.split('\n').filter(line => line.trim());
          if (lines.length < 2) {
            reject(new Error('CSV file must have at least a header and one data row'));
            return;
          }
          
          const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
          const items = lines.slice(1).map(line => {
            const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
            const item: any = {};
            headers.forEach((header, index) => {
              const value = values[index] || '';
              // Try to parse numbers
              if (!isNaN(Number(value)) && value !== '') {
                item[header] = Number(value);
              } else {
                item[header] = value;
              }
            });
            return item;
          });
          resolve(items);
        } else {
          reject(new Error('Unsupported file type. Please upload a JSON or CSV file.'));
        }
      } catch (error) {
        reject(new Error(`Failed to parse file: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsText(file);
  });
}

/**
 * Helper function to trigger file input dialog
 */
export function triggerFileUpload(accept: string = '.json,.csv'): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        resolve(file);
      } else {
        reject(new Error('No file selected'));
      }
    };
    
    input.click();
  });
}

/**
 * Gets the effective search ID by combining the store's currentSearchId with route-based fallback.
 * This is useful when components need the search ID but the store might not be populated yet
 * (e.g., when users land directly on a results page).
 * 
 * @param pathname - The current pathname from usePathname()
 * @param currentSearchId - The currentSearchId from useSearchFormStore()
 * @returns The effective search ID or undefined if not on a results page
 */
export function getEffectiveSearchId(pathname: string | null, currentSearchId?: string): string | undefined {
  // First priority: use store value if available
  if (currentSearchId) {
    return currentSearchId;
  }
  
  // Second priority: extract from route if on results page
  if (pathname?.startsWith('/results')) {
    const match = pathname.match(/^\/results\/([^\/]+)/);
    return match ? match[1] : undefined;
  }
  
  return undefined;
}

/**
 * Gets current search state from search history based on URL pathname
 * This replaces useSearchFormStore functionality
 */
export function getCurrentSearchState(pathname: string | null) {
  if (typeof window === 'undefined') return null;
  
  // Import here to avoid circular dependencies
  const { useSearchHistoryStore } = require('./store');
  const { getSearchResult } = useSearchHistoryStore.getState();
  
  // Extract search ID from URL
  const searchId = getEffectiveSearchId(pathname, undefined);
  if (!searchId) return null;
  
  // Get search result from history
  const searchResult = getSearchResult(searchId);
  if (!searchResult) return null;
  
  return searchResult;
}

/**
 * Gets a specific field from current search state with fallback
 */
export function getCurrentSearchField<T>(pathname: string | null, field: string, fallback: T): T {
  const searchState = getCurrentSearchState(pathname);
  if (!searchState) return fallback;
  
  return (searchState as any)[field] ?? fallback;
}

/**
 * Helper functions to get specific search state values with proper defaults
 */
export function getCurrentSearchFormState(pathname: string | null) {
  const defaultYearRange = DEFAULT_FILTERS.yearRange();
  
  return {
    currentSearchField: getCurrentSearchField(pathname, 'field', DEFAULT_FILTERS.field),
    dateRange: getCurrentSearchField(pathname, 'dateRange', DEFAULT_FILTERS.dateRange),
    sortBy: getCurrentSearchField(pathname, 'sortBy', DEFAULT_FILTERS.sortBy),
    filterType: getCurrentSearchField(pathname, 'filterType', DEFAULT_FILTERS.filterType),
    yearRange: getCurrentSearchField(pathname, 'yearRange', defaultYearRange),
    isYearRangeEnabled: getCurrentSearchField(pathname, 'isYearRangeEnabled', DEFAULT_FILTERS.isYearRangeEnabled),
    yearFromInput: getCurrentSearchField(pathname, 'yearRange', defaultYearRange)[0]?.toString() || defaultYearRange[0].toString(),
    yearToInput: getCurrentSearchField(pathname, 'yearRange', defaultYearRange)[1]?.toString() || defaultYearRange[1].toString(),
    ratingRange: getCurrentSearchField(pathname, 'ratingRange', DEFAULT_FILTERS.ratingRange),
    onlyRatedPapers: getCurrentSearchField(pathname, 'onlyRatedPapers', DEFAULT_FILTERS.onlyRatedPapers),
    selectedRegions: getCurrentSearchField(pathname, 'selectedRegions', DEFAULT_FILTERS.selectedRegions),
    selectedCountryFocus: getCurrentSearchField(pathname, 'selectedCountryFocus', DEFAULT_FILTERS.selectedCountryFocus),
    citesItemId: getCurrentSearchField(pathname, 'citesItemId', DEFAULT_FILTERS.citesItemId),
    citedByItemId: getCurrentSearchField(pathname, 'citedByItemId', DEFAULT_FILTERS.citedByItemId),
    relatedToItemId: getCurrentSearchField(pathname, 'relatedToItemId', DEFAULT_FILTERS.relatedToItemId),
    reviewFilter: getCurrentSearchField(pathname, 'reviewFilter', DEFAULT_FILTERS.reviewFilter),
  };
}

/**
 * Parses a boolean search query and returns formatted parts with operator highlighting
 */
export interface BooleanQueryPart {
  text: string;
  type: 'operator' | 'term' | 'parenthesis' | 'parenthesis_content';
  nestingLevel?: number;
  originalPosition?: number;
}

export function parseBooleanQuery(query: string, nestingLevel: number = 0): BooleanQueryPart[] {
  if (!query || typeof query !== 'string') {
    return [{ text: query || '', type: 'term', nestingLevel: 0, originalPosition: 0 }];
  }

  const parts: BooleanQueryPart[] = [];
  let i = 0;
  
  while (i < query.length) {
    const char = query[i];
    
    // Handle quoted strings
    if (char === '"') {
      const endQuote = query.indexOf('"', i + 1);
      if (endQuote !== -1) {
        parts.push({ text: query.slice(i, endQuote + 1), type: 'term', nestingLevel, originalPosition: i });
        i = endQuote + 1;
        continue;
      }
    }
    
    // Handle parentheses and their content
    if (char === '(') {
      const { content, endIndex } = extractParenthesesContent(query, i);
      // Parse the content inside parentheses recursively
      const innerContent = content.slice(1, -1); // Remove outer parentheses
      if (innerContent.trim()) {
        parts.push({ text: '(', type: 'parenthesis', nestingLevel, originalPosition: i });
        const innerParts = parseBooleanQuery(innerContent, nestingLevel + 1);
        parts.push(...innerParts.map(part => ({ 
          ...part, 
          type: part.type === 'term' ? 'parenthesis_content' as const : part.type,
          nestingLevel: part.type === 'term' ? nestingLevel : part.nestingLevel
        })));
        parts.push({ text: ')', type: 'parenthesis', nestingLevel, originalPosition: endIndex });
      } else {
        parts.push({ text: content, type: 'parenthesis', nestingLevel, originalPosition: i });
      }
      i = endIndex + 1;
      continue;
    }
    
    // Handle operators
    const remaining = query.slice(i);
    const operatorMatch = remaining.match(/^(\bAND\b|\bOR\b|\bNOT\b)/i);
    if (operatorMatch) {
      parts.push({ text: operatorMatch[0], type: 'operator', nestingLevel, originalPosition: i });
      i += operatorMatch[0].length;
      continue;
    }
    
    // Handle regular text
    let textEnd = i;
    while (textEnd < query.length && 
           query[textEnd] !== '(' && 
           query[textEnd] !== ')' && 
           query[textEnd] !== '"' &&
           !query.slice(textEnd).match(/^(\bAND\b|\bOR\b|\bNOT\b)/i)) {
      textEnd++;
    }
    
    if (textEnd > i) {
      const text = query.slice(i, textEnd).trim();
      if (text) {
        parts.push({ text, type: 'term', nestingLevel, originalPosition: i });
      }
      i = textEnd;
    } else {
      i++;
    }
  }
  
  return parts.length > 0 ? parts : [{ text: query, type: 'term', nestingLevel: 0, originalPosition: 0 }];
}

// Helper function to extract content within parentheses, handling nesting
function extractParenthesesContent(query: string, startIndex: number): { content: string; endIndex: number } {
  let depth = 0;
  let i = startIndex;
  
  while (i < query.length) {
    const char = query[i];
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return {
          content: query.slice(startIndex, i + 1),
          endIndex: i
        };
      }
    }
    i++;
  }
  
  // If no matching closing parenthesis found, return the rest of the string
  return {
    content: query.slice(startIndex),
    endIndex: query.length - 1
  };
}

/**
 * Formats a boolean query with syntax highlighting for display
 */
export function formatBooleanQueryForDisplay(query: string): string {
  const parts = parseBooleanQuery(query);
  return parts.map(part => {
    switch (part.type) {
      case 'operator':
        return `<span class="font-semibold text-blue-600 dark:text-blue-400">${part.text}</span>`;
      case 'parenthesis':
        return `<span class="font-medium text-gray-500 dark:text-gray-400">${part.text}</span>`;
      default:
        return part.text;
    }
  }).join(' ');
}