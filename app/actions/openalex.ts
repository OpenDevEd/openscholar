"use server";
import OpenAlexClient from "@/lib/openalex";
import { fields, type SearchField } from "@/lib/utils";
import { SearchParameters, SortByWork } from "openalex-sdk/dist/src/types/work";
import { DateRange } from "react-day-picker";
import fs from "fs";

function buildSearchParams(query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], additionalParams?: Partial<SearchParameters>): SearchParameters {
    const searchParams: SearchParameters = {
        search: query,
        searchField: searchField,
        ...additionalParams
    };
    
    // Add sort parameters if provided
    if (sortBy) {
        const [field, order] = sortBy.split(':') as [string, 'asc' | 'desc'];
        searchParams.sortBy = {
            field: field as any,
            order: order
        };
    } else {
        // Default sort
        searchParams.sortBy = {
            field: "relevance_score",
            order: "desc"
        };
    }
    
    // Add date range filtering if provided (takes precedence over year range)
    if (dateRange?.from || dateRange?.to) {
        searchParams.filter = {};
        
        if (dateRange?.from) {
            const fromDate = dateRange.from.toISOString().split('T')[0]; // Format as yyyy-mm-dd
            searchParams.filter.from_publication_date = fromDate;
        }
        
        if (dateRange?.to) {
            const toDate = dateRange.to.toISOString().split('T')[0]; // Format as yyyy-mm-dd
            searchParams.filter.to_publication_date = toDate;
        }
    } else if (yearRange) {
        // Convert year range to date range
        searchParams.filter = {};
        searchParams.filter.from_publication_date = `${yearRange[0]}-01-01`;
        searchParams.filter.to_publication_date = `${yearRange[1]}-12-31`;
    }
    
    return searchParams;
}

export async function startSearch(formData: FormData, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], expandedQuery?: string) {
    const query = expandedQuery || formData.get('query') as string;
    const searchParams = buildSearchParams(query, searchField, dateRange, sortBy, yearRange);
    const results = await OpenAlexClient.works(searchParams);
    return results.meta.count;
}

export async function getSearchResults(query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], expandedQuery?: string) {
    console.log("searchField", searchField);
    const actualQuery = expandedQuery || query;
    const searchParams = buildSearchParams(actualQuery, searchField, dateRange, sortBy, yearRange, {
        perPage: 200,
        AbstractArrayToString: true
    });
    const results = await OpenAlexClient.works(searchParams);
    return results;
}
