import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { Work } from "@sickrin/openalex-sdk/dist/src/types/work";
import type { SortByWork } from "@sickrin/openalex-sdk/dist/src/types/work";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import type { SearchResult, SearchField, SearchFilters } from './types'
import { getCountryCodesForRegions, MIN_YEAR } from './constants'
import { buildSearchSubfilter } from './search/search-field'
import { researchAreaFilter, sdgFilterValue } from './openalex/vocabulary'

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
  researchAreas: [] as string[],
  sdgs: [] as string[],
  openAccessOnly: false,
  workTypes: [] as string[],
  workLanguages: [] as string[],
  institutionTypes: [] as string[],
  funders: [] as string[],
  authors: [] as string[],
  minCitations: null as number | null,
  hasAbstract: false,
  includeRetracted: false,
} as const;

/** Every filter back to its default, in the keys useUpdateSearchFilter takes. */
export function clearedFilterUpdates() {
  return {
    currentSearchField: DEFAULT_FILTERS.field,
    sortBy: DEFAULT_FILTERS.sortBy,
    dateRange: DEFAULT_FILTERS.dateRange,
    yearRange: DEFAULT_FILTERS.yearRange(),
    isYearRangeEnabled: DEFAULT_FILTERS.isYearRangeEnabled,
    ratingRange: DEFAULT_FILTERS.ratingRange,
    onlyRatedPapers: DEFAULT_FILTERS.onlyRatedPapers,
    selectedRegions: [],
    selectedCountryFocus: [],
    citesItemId: DEFAULT_FILTERS.citesItemId,
    citedByItemId: DEFAULT_FILTERS.citedByItemId,
    relatedToItemId: DEFAULT_FILTERS.relatedToItemId,
    reviewFilter: DEFAULT_FILTERS.reviewFilter,
    researchAreas: [],
    sdgs: [],
    openAccessOnly: DEFAULT_FILTERS.openAccessOnly,
    workTypes: [],
    workLanguages: [],
    institutionTypes: [],
    funders: [],
    authors: [],
    minCitations: DEFAULT_FILTERS.minCitations,
    hasAbstract: DEFAULT_FILTERS.hasAbstract,
    includeRetracted: DEFAULT_FILTERS.includeRetracted,
  };
}

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
    researchAreas: [],
    sdgs: [],
    openAccessOnly: DEFAULT_FILTERS.openAccessOnly,
    workTypes: [],
    workLanguages: [],
    institutionTypes: [],
    funders: [],
    authors: [],
    minCitations: DEFAULT_FILTERS.minCitations,
    hasAbstract: DEFAULT_FILTERS.hasAbstract,
    includeRetracted: DEFAULT_FILTERS.includeRetracted,
  };
}

// Utility functions to check if filters are at default values
const isFilterAtDefault = {
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

type JsonValue = string | number | boolean | null | undefined | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue }

function escapeCSVValue(value: JsonValue): string {
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
  data: JsonValue,
  filename: string,
  format: 'json' | 'csv',
  metadata?: Record<string, JsonValue>
) {
  if (format === 'json') {
    const dataWithMetadata = metadata ? { ...metadata, res: data } : data;
    downloadAsFile(JSON.stringify(dataWithMetadata, null, 2), filename, 'json');
  } else {
    const csv = await jsonToCSV(data as JsonObject | JsonObject[]);
    downloadAsFile(csv, filename, 'csv');
  }
}

/**
 * Creates search parameters object for OpenAlex API calls
 * Used by both the OpenAlex action and search metadata creation.
 *
 * `perPageOverride` is for the count-only path — pass `1` when only
 * `meta.count` is needed so the request payload is ~200x smaller than
 * the default search page.
 */
export function createSearchParameters(
  query: string,
  filters: SearchFilters,
  options?: { perPageOverride?: number }
) {
  interface OpenAlexSearchParams {
    perPage: number;
    AbstractArrayToString: boolean;
    search?: string;
    filter?: Record<string, unknown>;
    sortBy?: SortByWork;
  }

  const searchParams: OpenAlexSearchParams = {
    perPage: options?.perPageOverride ?? 200,
    AbstractArrayToString: true
  };

  // Build filter object
  const apiFilters: Record<string, unknown> = {};

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
      
      // Stemmed `.search` by default; route to the no-stem `.search.exact`
      // field when the query has an unquoted wildcard, the way openalex.org
      // does — otherwise a `*`/`?` 400s against the stemmed field.
      apiFilters[filterKey] = buildSearchSubfilter(query);
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
    return format(date, 'yyyy-MM-dd');
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

  if (filters.researchAreas.length) apiFilters.topics = researchAreaFilter(filters.researchAreas);
  if (filters.sdgs.length) {
    apiFilters.sustainable_development_goals = { id: sdgFilterValue(filters.sdgs) };
  }
  if (filters.openAccessOnly) apiFilters.open_access = { is_oa: true };
  if (filters.workTypes.length) apiFilters.type = filters.workTypes.join('|');
  if (filters.workLanguages.length) apiFilters.language = filters.workLanguages.join('|');
  if (filters.institutionTypes.length) {
    apiFilters.authorships = {
      ...(apiFilters.authorships as Record<string, unknown> | undefined),
      institutions: { type: filters.institutionTypes.join('|') },
    };
  }
  if (filters.funders.length) apiFilters.funders = { id: filters.funders.join('|') };
  if (filters.authors.length) {
    apiFilters.authorships = {
      ...(apiFilters.authorships as Record<string, unknown> | undefined),
      author: { id: filters.authors.join('|') },
    };
  }
  // OpenAlex takes "more than", so at least N is more than N - 1.
  if (filters.minCitations) apiFilters.cited_by_count = `>${filters.minCitations - 1}`;
  if (filters.hasAbstract) apiFilters.has_abstract = true;
  if (!filters.includeRetracted) apiFilters.is_retracted = false;

  // Add filters to search params if we have any
  if (Object.keys(apiFilters).length > 0) {
    searchParams.filter = apiFilters;
  }

  // Add sorting
  if (filters.sortBy) {
    const [field, order] = filters.sortBy.split(':');
    searchParams.sortBy = {
      field: field as SortByWork['field'],
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

/**
 * Helper function to handle file upload and parsing
 */
export function uploadFile(file: File): Promise<Record<string, JsonValue>[]> {
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
            const item: Record<string, JsonValue> = {};
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