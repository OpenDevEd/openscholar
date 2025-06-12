"use server";
import { SearchField } from "@/lib/utils";
import { DateRange } from "react-day-picker";

/**
 * Direct OpenAlex API call following the official documentation
 * https://docs.openalex.org/how-to-use-the-api/get-lists-of-entities/search-entities
 */
async function callOpenAlexAPI(
  query: string, 
  searchField: SearchField, 
  dateRange?: DateRange, 
  sortBy?: string, 
  yearRange?: [number, number], 
  countryCodes?: string[]
) {
  const baseUrl = 'https://api.openalex.org/works';
  const params = new URLSearchParams();

  // Build filter parts manually to avoid double encoding
  const filterParts: string[] = [];

  // Handle search based on field type
  if (query) {
    console.log("query", query);
    // All search fields should use the .search filter approach
    // Boolean syntax IS supported in search filters when properly encoded
    const searchFilterMap = {
      'title_and_abstract': 'title_and_abstract.search',
      'title': 'title.search',
      'abstract': 'abstract.search', 
      'fulltext': 'fulltext.search',
      'display_name': 'display_name.search'
    } as const;
    
    if (searchField in searchFilterMap) {
      // Use filter approach for all search fields - build manually to avoid double encoding
      const filterKey = searchFilterMap[searchField as keyof typeof searchFilterMap];
      filterParts.push(`${filterKey}:${query}`);
    } else {
      // Fallback to main search
      params.append('search', query);
    }
  }

  // Add additional filters (for exact value matching)
  // Date filtering
  if (dateRange?.from || dateRange?.to || yearRange) {
    if (dateRange?.from) {
      const fromDate = dateRange.from.toISOString().split('T')[0];
      filterParts.push(`from_publication_date:${fromDate}`);
    }
    if (dateRange?.to) {
      const toDate = dateRange.to.toISOString().split('T')[0];
      filterParts.push(`to_publication_date:${toDate}`);
    }
    if (yearRange && !dateRange?.from && !dateRange?.to) {
      filterParts.push(`from_publication_date:${yearRange[0]}-01-01`);
      filterParts.push(`to_publication_date:${yearRange[1]}-12-31`);
    }
  }
  
  // Country filtering (for Institution location - author affiliations)
  if (countryCodes && countryCodes.length > 0) {
    filterParts.push(`authorships.countries:${countryCodes.join('|')}`);
  }

  // Add filter parameter if we have any filters
  if (filterParts.length > 0) {
    params.append('filter', filterParts.join(','));
  }

  // Add sorting
  const sortParam = sortBy || 'relevance_score:desc';
  params.append('sort', sortParam);
  
  // Add pagination
  params.append('per-page', '200');

  const fullUrl = `${baseUrl}?${params.toString()}`;
  console.log('OpenAlex API call:', fullUrl);

  const response = await fetch(fullUrl);
  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAlex API Error:', response.status, errorText);
    throw new Error(`OpenAlex API error ${response.status}: ${errorText}`);
  }

  const jsonResponse = await response.json();
  console.log('OpenAlex API response:', {
    url: fullUrl,
    meta: jsonResponse.meta,
    resultsCount: jsonResponse.results?.length || 0,
    firstResult: jsonResponse.results?.[0] ? {
      id: jsonResponse.results[0].id,
      title: jsonResponse.results[0].title,
      abstract: jsonResponse.results[0].abstract ? jsonResponse.results[0].abstract.substring(0, 100) + '...' : 'No abstract'
    } : 'No results'
  });
  
  return jsonResponse;
}

export async function startSearch(formData: FormData, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], countryCodes?: string[], expandedQuery?: string) {
  const query = expandedQuery || formData.get('query') as string;
  const results = await callOpenAlexAPI(query, searchField, dateRange, sortBy, yearRange, countryCodes);
  return results.meta.count;
}

export async function getSearchResults(query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], countryCodes?: string[], expandedQuery?: string) {
  console.log("searchField", searchField);
  const actualQuery = expandedQuery || query;
  
  const results = await callOpenAlexAPI(actualQuery, searchField, dateRange, sortBy, yearRange, countryCodes);
  return results;
}
