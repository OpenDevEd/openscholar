"use server";
import { createSearchParameters } from "@/lib/utils";
import client from "@/lib/openalex";
import type { SearchFilters } from "@/lib/types";

/**
 * OpenAlex API call using the OpenAlex SDK
 */
async function callOpenAlexSDK(
  query: string, 
  filters: SearchFilters
) {
  console.log("query", query);
  
  // Use the centralized utility function to create search parameters
  const searchParams = createSearchParameters(query, filters);

  console.log('OpenAlex SDK call with params:', JSON.stringify(searchParams, null, 2));

  try {
    const response = await client.works(searchParams);
    
    console.log('OpenAlex SDK response:', response);
    
    return response;
  } catch (error) {
    console.error('OpenAlex SDK Error:', error);
    throw new Error(`OpenAlex SDK error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function startSearch(formData: FormData, filters: SearchFilters, expandedQuery?: string) {
  const query = expandedQuery || formData.get('query') as string;
  const results = await callOpenAlexSDK(query, filters);
  return results.meta.count;
}

export async function getSearchResults(query: string, filters: SearchFilters, expandedQuery?: string, effectiveCitesItemId?: string, effectiveRelatedToItemId?: string) {
  console.log("searchField", filters.searchField);
  const actualQuery = expandedQuery || query;
  
  // Create a copy of filters with the effective IDs (if provided)
  const effectiveFilters: SearchFilters = {
    ...filters,
    citesItemId: effectiveCitesItemId || filters.citesItemId,
    relatedToItemId: effectiveRelatedToItemId || filters.relatedToItemId
  };

  
  const results = await callOpenAlexSDK(actualQuery, effectiveFilters);
  return results;
}
