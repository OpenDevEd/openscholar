"use server";
import { SearchField, createSearchParameters } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import client from "@/lib/openalex";

/**
 * OpenAlex API call using the OpenAlex SDK
 */
async function callOpenAlexSDK(
  query: string, 
  searchField: SearchField, 
  dateRange?: DateRange, 
  sortBy?: string, 
  yearRange?: [number, number], 
  countryCodes?: string[]
) {
  console.log("query", query);
  
  // Use the centralized utility function to create search parameters
  const searchParams = createSearchParameters(query, searchField, dateRange, sortBy, yearRange, countryCodes);

  console.log('OpenAlex SDK call with params:', JSON.stringify(searchParams, null, 2));

  try {
    const response = await client.works(searchParams);
    
    console.log('OpenAlex SDK response:', {
      meta: response.meta,
      resultsCount: response.results?.length || 0,
      firstResult: response.results?.[0] ? {
        id: response.results[0].id,
        title: response.results[0].title || response.results[0].display_name,
        abstract: response.results[0].abstract ? response.results[0].abstract.substring(0, 100) + '...' : 'No abstract'
      } : 'No results'
    });
    
    return response;
  } catch (error) {
    console.error('OpenAlex SDK Error:', error);
    throw new Error(`OpenAlex SDK error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function startSearch(formData: FormData, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], countryCodes?: string[], expandedQuery?: string) {
  const query = expandedQuery || formData.get('query') as string;
  const results = await callOpenAlexSDK(query, searchField, dateRange, sortBy, yearRange, countryCodes);
  return results.meta.count;
}

export async function getSearchResults(query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], countryCodes?: string[], expandedQuery?: string) {
  console.log("searchField", searchField);
  const actualQuery = expandedQuery || query;
  
  const results = await callOpenAlexSDK(actualQuery, searchField, dateRange, sortBy, yearRange, countryCodes);
  return results;
}
