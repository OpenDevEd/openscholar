"use node";

/**
 * Extraction Actions
 * Fetch papers from OpenAlex
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import type { PaperData } from "./types";

// Fetch papers from OpenAlex via HTTP API with abstract support
export const fetchPapersFromHistory = internalAction({
  args: {
    searchFilters: v.record(v.string(), v.any()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args): Promise<PaperData[]> => {
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
      citesItemId?: string;
      citedByItemId?: string;
      relatedToItemId?: string;
    };

    const baseUrl = "https://api.openalex.org/works";
    const searchParams = new URLSearchParams();

    // Add search query with field support
    if (filters.query) {
      if (filters.searchField === "title_and_abstract") {
        searchParams.set("filter", `title_and_abstract.search:${filters.query}`);
      } else if (filters.searchField === "title") {
        searchParams.set("filter", `title.search:${filters.query}`);
      } else if (filters.searchField === "abstract") {
        searchParams.set("filter", `abstract.search:${filters.query}`);
      } else if (filters.searchField === "fulltext") {
        searchParams.set("filter", `fulltext.search:${filters.query}`);
      } else if (filters.searchField === "display_name") {
        searchParams.set("filter", `display_name.search:${filters.query}`);
      } else {
        searchParams.set("search", filters.query);
      }
    }

    const filterParts: string[] = [];
    const existingFilter = searchParams.get("filter");
    if (existingFilter) {
      filterParts.push(existingFilter);
    }

    // Add year range filter
    if (filters.yearRange && !filters.dateRange?.from && !filters.dateRange?.to) {
      filterParts.push(
        `publication_year:${filters.yearRange[0]}-${filters.yearRange[1]}`
      );
    }

    if (filters.dateRange?.from) {
      filterParts.push(`from_publication_date:${filters.dateRange.from}`);
    }
    if (filters.dateRange?.to) {
      filterParts.push(`to_publication_date:${filters.dateRange.to}`);
    }

    if (filters.reviewFilter) {
      filterParts.push("type:review");
    }

    if (filters.selectedCountryFocus && filters.selectedCountryFocus.length > 0) {
      filterParts.push(`countries:${filters.selectedCountryFocus.join("|")}`);
    }

    if (filters.selectedRegions && filters.selectedRegions.length > 0) {
      filterParts.push(`regions:${filters.selectedRegions.join("|")}`);
    }

    if (filters.citesItemId) {
      const clean = filters.citesItemId.startsWith("https://openalex.org/")
        ? filters.citesItemId
        : `https://openalex.org/${filters.citesItemId}`;
      filterParts.push(`cites:${clean}`);
    }
    if (filters.citedByItemId) {
      const clean = filters.citedByItemId.startsWith("https://openalex.org/")
        ? filters.citedByItemId
        : `https://openalex.org/${filters.citedByItemId}`;
      filterParts.push(`cited_by:${clean}`);
    }
    if (filters.relatedToItemId) {
      const clean = filters.relatedToItemId.startsWith("https://openalex.org/")
        ? filters.relatedToItemId
        : `https://openalex.org/${filters.relatedToItemId}`;
      filterParts.push(`related_to:${clean}`);
    }

    if (filterParts.length > 0) {
      searchParams.set("filter", filterParts.join(","));
    }

    // Add sorting
    if (filters.sortBy) {
      const [field, order] = filters.sortBy.split(":");
      searchParams.set("sort", `${field}:${order || "desc"}`);
    }

    // Get 200 papers with abstracts
    searchParams.set("per-page", "200");

    

    const papers: PaperData[] = [];

    try {
      console.log(
        `[fetchPapersFromHistory] Fetching: ${baseUrl}?${searchParams.toString()}`
      );

      const response = await fetch(`${baseUrl}?${searchParams.toString()}`, {
        headers: {
          "User-Agent": "OpenAlex-Count/1.0 (mailto:admin@example.com)",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `OpenAlex API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      for (const work of data.results || []) {
        // Extract abstract from inverted index if available
        let abstract: string | undefined;
        if (work.abstract_inverted_index) {
          abstract = reconstructAbstract(work.abstract_inverted_index);
        }

        papers.push({
          openalexId: work.id?.replace("https://openalex.org/", "") || "",
          title: work.display_name || "Untitled",
          doi: work.doi || undefined,
          publicationYear: work.publication_year || undefined,
          abstract,
          authors:
            work.authorships
              ?.map((a: any) => a.author?.display_name)
              .filter(Boolean) || [],
          pdfUrl: work.open_access?.oa_url || undefined,
          isOpenAccess: work.open_access?.is_oa || false,
        });
      }

      console.log(`[fetchPapersFromHistory] Fetched ${papers.length} papers`);
      const withAbstracts = papers.filter((p) => p.abstract).length;
      console.log(
        `[fetchPapersFromHistory] Papers with abstracts: ${withAbstracts}/${papers.length}`
      );

      return papers;
    } catch (error) {
      console.error(`[fetchPapersFromHistory] Error:`, error);
      throw error;
    }
  },
});

// Helper to reconstruct abstract from OpenAlex inverted index
function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  if (!invertedIndex || Object.keys(invertedIndex).length === 0) {
    return "";
  }

  const positionMap: Map<number, string> = new Map();

  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      positionMap.set(pos, word);
    }
  }

  const sortedPositions = Array.from(positionMap.keys()).sort((a, b) => a - b);
  return sortedPositions.map((pos) => positionMap.get(pos)).join(" ");
}
