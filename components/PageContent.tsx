"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { SearchHistory } from "@/components/search-history";
import { useSearchFormStore, useUIStore, useSearchHistoryStore, useResultsStore } from "@/lib/store";
import { useQueryChangeHandler } from "@/lib/hooks";
import {
  submitSearchAndLoadResults,
  loadSearchResultsById,
  handleSearchHistoryClick as sharedHandleSearchHistoryClick,
} from "@/lib/search-actions";
import { Logo } from "@/components/logo";
import { Search } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { BookOpen, Sparkles } from "lucide-react";
import Link from "next/link";
import React from "react";

function PageContent() {
  const router = useRouter();
  
  // Zustand stores
  const {
    currentSearchField,
    dateRange,
    sortBy,
    filterType,
    yearRange,
    isFilterActive,
  } = useSearchFormStore();

  const {
    loadingResultIndex,
    isLoading,
    isCreatingNewSearch,
    isFilterLoading,
  } = useUIStore();



  // Add state to track the current query for the tooltip
  const { currentQuery, setCurrentQuery } = useResultsStore();
  const handleQueryChange = useQueryChangeHandler(setCurrentQuery);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = currentQuery;
    
    if (!query.trim()) return;

    // Create FormData with the current query value
    const formData = new FormData();
    formData.set("query", query);

    // Submit search and load results in one call, get the search ID
    const { searchId } = await submitSearchAndLoadResults(
      formData,
      currentSearchField,
      dateRange,
      sortBy,
      yearRange,
      filterType,
      isFilterActive
    );

    // Only navigate if search was successful (searchId is not null)
    if (searchId) {
      router.push(`/results/${searchId}`);
    }
  };

  const handleSearchHistoryClick = async (
    query: string,
    searchField: any,
    dateRange?: any,
    sortBy?: string,
    yearRange?: [number, number],
    filterType?: "date" | "year",
    index?: number
  ) => {
    const searchId = await sharedHandleSearchHistoryClick(
      query,
      searchField,
      dateRange,
      sortBy,
      yearRange,
      filterType,
      index
    );
    
    // Only navigate if loading was successful (searchId is not null)
    if (searchId) {
      router.push(`/results/${searchId}`);
    }
  };

  return (
    <main className="w-full h-screen bg-background">
      {/* Full screen container */}
      <div className="relative w-full h-full">
        {/* Centered logo + search bar container */}
        <div className="absolute inset-0 flex items-center justify-center px-4">
          <div className="relative w-full max-w-2xl space-y-6 md:space-y-8">
            {/* Logo */}
            <div className="text-center">
              <Logo size="lg" className="justify-center mb-4 md:mb-6 lg:mb-8 sm:hidden" context="home" />
              <Logo size="xl" className="justify-center mb-4 md:mb-6 lg:mb-8 hidden sm:flex" context="home" />
              <p className="text-muted-foreground text-sm sm:text-base md:text-lg px-4">
                Search millions of academic papers and research articles
              </p>
            </div>

            {/* Search Form */}
            <form onSubmit={handleSubmit} className="w-full px-2 md:px-0">
              <div className="relative">
                <div className="flex w-full items-center space-x-2 p-2 border rounded-full shadow-lg hover:shadow-xl transition-shadow bg-background">
                  <Search className="h-5 w-5 text-muted-foreground ml-4" />
                  <Textarea
                    name="query"
                    value={currentQuery}
                    placeholder="Search for papers, topics..."
                    className="flex-1 border-0 bg-transparent resize-none min-h-[48px] max-h-32 focus-visible:ring-0 focus-visible:ring-offset-0 text-base md:text-lg"
                    disabled={isCreatingNewSearch || loadingResultIndex !== null || isFilterLoading}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        const form = e.currentTarget.form;
                        if (form) {
                          form.requestSubmit();
                        }
                      }
                    }}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button asChild size="icon" variant="outline" className="rounded-full h-12 w-12">
                        <Link href="/keyword-expansion">
                          <BookOpen className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>Keyword Expansion</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button asChild size="icon" variant="outline" className="rounded-full h-12 w-12">
                        <Link href="/ai-enhancement">
                          <Sparkles className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>AI Enhancement</p>
                    </TooltipContent>
                  </Tooltip>
                  <Button 
                    type="submit" 
                    disabled={isCreatingNewSearch || loadingResultIndex !== null || isFilterLoading} 
                    className="rounded-full h-12 w-12 mr-2"
                    size="icon"
                  >
                    {isCreatingNewSearch ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Search className="h-5 w-5" />
                    )}
                  </Button>
                </div>
              </div>
            </form>

            {/* Quick Actions */}
            <div className="text-center space-y-2 px-4">
              <p className="text-sm text-muted-foreground">
                Try searching for topics like "machine learning", "climate change", or "quantum computing"
              </p>
            </div>

            {/* Search History - absolutely positioned directly under this container */}
            <div className="absolute top-full left-0 right-0 pt-8 md:pt-12 pb-8 md:pb-16">
              <SearchHistory
                onSearchResults={handleSearchHistoryClick}
                loadingResultIndex={loadingResultIndex}
                currentSearchField={currentSearchField}
                compact={true}
                currentSearchId={undefined}
              />
              
              {/* Footer */}
              <div className="text-center mt-12 pt-6">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-100/50 shadow-sm">
                  <span className="text-sm text-muted-foreground">Built with</span>
                  <a 
                    href="https://openalex.org" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    OpenAlex
                  </a>
                  <div className="w-2 h-2 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default dynamic(() => Promise.resolve(PageContent), { ssr: false });
