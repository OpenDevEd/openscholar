import { NextRequest, NextResponse } from "next/server";
import client from "@/lib/openalex";
import { createSearchParameters } from "@/lib/utils";
import type { SearchFilters, SearchField } from "@/lib/types/search.types";

/**
 * GET /api/openalex/search
 * 
 * Search OpenAlex for works matching the query.
 * Uses the same createSearchParameters function as the main search
 * to ensure consistent results.
 * 
 * Query params:
 * - q: search query string
 * - field: title_and_abstract | title | abstract
 * - per_page: number of results (max 200)
 * - from_year: start year filter
 * - to_year: end year filter
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const query = searchParams.get("q") || "";
    const field = (searchParams.get("field") || "title_and_abstract") as SearchField;
    const fromYear = searchParams.get("from_year");
    const toYear = searchParams.get("to_year");

    if (!query) {
      return NextResponse.json(
        { error: "Query parameter 'q' is required" },
        { status: 400 }
      );
    }

    // Build SearchFilters object to use with createSearchParameters
    // This ensures the exact same query format as the main search
    const filters: SearchFilters = {
      searchField: field,
      sortBy: "relevance_score:desc",
      filterType: "year",
      yearRange: fromYear && toYear 
        ? [parseInt(fromYear, 10), parseInt(toYear, 10)] 
        : undefined,
      isYearRangeEnabled: !!(fromYear && toYear),
      selectedRegions: [],
      selectedCountryFocus: [],
      citesItemId: "",
      citedByItemId: "",
      relatedToItemId: "",
      reviewFilter: false,
      researchAreas: [],
      sdgs: [],
      openAccessOnly: false,
      workTypes: [],
    };

    // Use the same function as the main search action
    const params = createSearchParameters(query, filters);

    const response = await client.works(params);

    return NextResponse.json({
      results: response.results || [],
      meta: response.meta || {},
    });
  } catch (error: unknown) {
    console.error("[OpenAlex API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}
