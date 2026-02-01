"use node";

/**
 * Fetch papers from OpenAlex and prepare for creation
 * This action is called via workpool to fetch papers for a job
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import type { PaperData } from "./types";

export const fetchAndCreatePapers = internalAction({
  args: {
    jobId: v.id("extractionJobs"),
    searchFilters: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args): Promise<{ papers: PaperData[]; count: number }> => {
    console.log(`[fetchAndCreatePapers] Fetching papers for job ${args.jobId}`);
    
    const filters = args.searchFilters as {
      query: string;
      field?: string;
      yearRange?: [number, number];
      dateRange?: { from?: string; to?: string };
      sortBy?: string;
      selectedRegions?: string[];
      selectedCountryFocus?: string[];
      reviewFilter?: boolean;
      searchField?: string;
    };

    // Build OpenAlex API URL - SAME as search code
    const baseUrl = "https://api.openalex.org/works";
    const searchParams = new URLSearchParams();
    
    // Add search query
    if (filters.query) {
      // Handle search field like the main search does
      if (filters.searchField === 'title_and_abstract') {
        searchParams.set("filter", `title_and_abstract.search:${filters.query}`);
      } else if (filters.searchField === 'title') {
        searchParams.set("filter", `title.search:${filters.query}`);
      } else if (filters.searchField === 'abstract') {
        searchParams.set("filter", `abstract.search:${filters.query}`);
      } else {
        searchParams.set("search", filters.query);
      }
    }
    
    // Add year range filter
    if (filters.yearRange) {
      const existingFilter = searchParams.get("filter") || "";
      const yearFilter = `publication_year:${filters.yearRange[0]}-${filters.yearRange[1]}`;
      searchParams.set("filter", existingFilter ? `${existingFilter},${yearFilter}` : yearFilter);
    }
    
    // Add sorting
    if (filters.sortBy) {
      const [field, order] = filters.sortBy.split(':');
      searchParams.set("sort", `${field}:${order || 'desc'}`);
    }
    
    // Always get full metadata - limit to 200 papers max (same as search)
    searchParams.set("per-page", "200");
    
    const papers: PaperData[] = [];
    let cursor: string | null = null;
    const maxPapers = 200; // Same limit as search

    do {
      let url: string;
      const paramsString = searchParams.toString();
      
      if (cursor) {
        const encodedCursor = encodeURIComponent(cursor);
        url = paramsString 
          ? `${baseUrl}?${paramsString}&cursor=${encodedCursor}`
          : `${baseUrl}?cursor=${encodedCursor}`;
      } else {
        url = paramsString ? `${baseUrl}?${paramsString}` : baseUrl;
      }
      
      console.log(`[fetchAndCreatePapers] Fetching: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          "User-Agent": "OpenAlex-Count/1.0 (mailto:admin@example.com)",
          "Accept": "application/json",
        },
      });
      
      if (!response.ok) {
        throw new Error(`OpenAlex API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();

      for (const work of data.results || []) {
        const paper: PaperData = {
          openalexId: work.id?.replace("https://openalex.org/", "") || "",
          title: work.display_name || "Untitled",
          doi: work.doi || undefined,
          publicationYear: work.publication_year || undefined,
          abstract: work.abstract_inverted_index ? "Abstract available" : undefined,
          authors: work.authorships?.map((a: any) => a.author?.display_name).filter(Boolean) || [],
          pdfUrl: work.open_access?.oa_url || undefined,
        };

        papers.push(paper);

        if (papers.length >= maxPapers) {
          break;
        }
      }

      cursor = data.meta?.next_cursor || null;
    } while (cursor && papers.length < maxPapers);

    console.log(`[fetchAndCreatePapers] Fetched ${papers.length} papers for job ${args.jobId}`);
    
    return { papers, count: papers.length };
  },
});
