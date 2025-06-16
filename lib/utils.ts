import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { Work } from "openalex-sdk/dist/src/types/work";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";

export const fields = [
  { value: "title_and_abstract", label: "Title, abstract" },
  { value: "title", label: "Title" },
  { value: "abstract", label: "Abstract" },
  { value: "fulltext", label: "Fulltext" },
  { value: "display_name", label: "Display name" }
] as const;

export type SearchField = (typeof fields)[number]["value"];

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
  searchField: SearchField,
  dateRange?: DateRange,
  sortBy?: string,
  yearRange?: [number, number],
  countryCodes?: string[],
  citesItemId?: string,
  relatedToItemId?: string
) {
  const searchParams: any = {
    perPage: 200,
    AbstractArrayToString: true
  };

  // Build filter object
  const filters: any = {};

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
    
    if (searchField in searchFilterMap) {
      // Use search filters for specific fields
      const filterKey = searchFilterMap[searchField as keyof typeof searchFilterMap];
      
      // For the SDK, we use the filter object with search subfields
      if (filterKey === 'title_and_abstract') {
        filters.title_and_abstract = { search: query };
      } else if (filterKey === 'title') {
        filters.title = { search: query };
      } else if (filterKey === 'abstract') {
        filters.abstract = { search: query };
      } else if (filterKey === 'fulltext') {
        filters.fulltext = { search: query };
      } else if (filterKey === 'display_name') {
        filters.display_name = { search: query };
      }
    } else {
      // Fallback to main search
      searchParams.search = query;
    }
  }

  // Add cites filtering
  if (citesItemId) {
    // Clean the item ID to ensure it's in the correct format
    const cleanItemId = citesItemId.startsWith('https://openalex.org/') ? citesItemId : `https://openalex.org/${citesItemId}`;
    filters.cites = cleanItemId;
  }

  // Add related_to filtering
  if (relatedToItemId) {
    // Clean the item ID to ensure it's in the correct format
    const cleanItemId = relatedToItemId.startsWith('https://openalex.org/') ? relatedToItemId : `https://openalex.org/${relatedToItemId}`;
    filters.related_to = cleanItemId;
  }

  // Add date filtering
  if (dateRange?.from || dateRange?.to || yearRange) {
    if (dateRange?.from) {
      const fromDate = dateRange.from.toISOString().split('T')[0];
      filters.from_publication_date = fromDate;
    }
    if (dateRange?.to) {
      const toDate = dateRange.to.toISOString().split('T')[0];
      filters.to_publication_date = toDate;
    }
    if (yearRange && !dateRange?.from && !dateRange?.to) {
      filters.from_publication_date = `${yearRange[0]}-01-01`;
      filters.to_publication_date = `${yearRange[1]}-12-31`;
    }
  }
  
  // Country filtering (for Institution location - author affiliations)
  if (countryCodes && countryCodes.length > 0) {
    filters.authorships = {
      countries: countryCodes.join('|')
    };
  }

  // Add filters to search params if we have any
  if (Object.keys(filters).length > 0) {
    searchParams.filter = filters;
  }

  // Add sorting
  if (sortBy) {
    const [field, order] = sortBy.split(':');
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