"use server";
import OpenAlexClient from "@/lib/openalex";
import { fields, type SearchField } from "@/lib/utils";
import { SearchParameters, SortByWork } from "openalex-sdk/dist/src/types/work";
import { DateRange } from "react-day-picker";

function buildSearchParams(query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string, additionalParams?: Partial<SearchParameters>): SearchParameters {
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
    
    // Add date range filtering if provided
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
    }
    
    return searchParams;
}

export async function startSearch(formData: FormData, searchField: SearchField, dateRange?: DateRange, sortBy?: string) {
    const query = formData.get('query') as string;
    const searchParams = buildSearchParams(query, searchField, dateRange, sortBy);
    const results = await OpenAlexClient.works(searchParams);
    return results.meta.count;
}

export async function getSearchResults(query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string) {
    console.log("searchField", searchField);
    const searchParams = buildSearchParams(query, searchField, dateRange, sortBy, {
        perPage: 200,
        AbstractArrayToString: true
    });
    const results = await OpenAlexClient.works(searchParams);
    return results;
}
