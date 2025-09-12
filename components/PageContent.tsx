"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { SearchHistory } from "@/components/search-history";
import {
  useUIStore,
  useSearchHistoryStore,
  useCurrentQueryStore,
} from "@/lib/store";
import { toast } from "sonner";
import {
  useQueryChangeHandler,
  useCurrentSearchFormState,
  useSearchResults,
  useCreateSearchFilters,
} from "@/lib/hooks";
import {
  submitSearchAndLoadResults,
  selectQueryFromHistory,
} from "@/lib/search-actions";
import { Logo } from "@/components/logo";
import { Search } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { BookOpen, Sparkles } from "lucide-react";
import { KeywordExpansionTooltip } from "@/components/keyword-expansion-tooltip";
import React from "react";
import Link from "next/link";

function PageContent() {
  const router = useRouter();

  // Zustand stores
  const { currentSearchField } = useCurrentSearchFormState();

  const { loadingResultIndex, setLoadingResultIndex } = useUIStore();

  // Get SWR loading states for disabling form
  const { isLoading, isValidating } = useSearchResults();
  const isFormDisabled =
    isLoading || isValidating || loadingResultIndex !== null;

  // Use shared current query state for navbar/home page synchronization
  const { currentQuery, setCurrentQuery } = useCurrentQueryStore();
  const handleQueryChange = useQueryChangeHandler(setCurrentQuery);

  const createSearchFilters = useCreateSearchFilters();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const form = new FormData(e.currentTarget);
    const query = form.get("query") as string;

    setLoadingResultIndex(null);

    // Create FormData with the current query value (allow empty queries)
    const formData = new FormData();
    formData.set("query", query);

    // Create filters object from current state
    const filters = createSearchFilters();

    // Submit search and load results in one call, get the search ID
    const { searchId } = await submitSearchAndLoadResults(formData, filters);

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
    // With SWR, we just need to navigate to the search result
    // The data will be automatically loaded by the SWR hook
    const { searchHistory } = useSearchHistoryStore.getState();
    const searchResult = searchHistory[index || 0];

    if (searchResult?.id) {
      router.push(`/results/${searchResult.id}`);
    } else {
      toast.error("Search not found", {
        description: "The requested search could not be found in your history.",
      });
    }
  };

  const handleQuerySelect = async (searchId: string, selectedQuery: string) => {
    await selectQueryFromHistory(searchId, selectedQuery, router);
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
              <Logo
                size="lg"
                className="justify-center mb-4 md:mb-6 lg:mb-8 sm:hidden"
                context="home"
              />
              <Logo
                size="xl"
                className="justify-center mb-4 md:mb-6 lg:mb-8 hidden sm:flex"
                context="home"
              />
              <p className="text-muted-foreground text-sm sm:text-base md:text-lg px-4">
                Search millions of academic papers and research articles
              </p>
            </div>

            {/* Search Form */}
            <form onSubmit={handleSubmit} className="w-full px-2 md:px-0">
              <div className="relative space-y-3 md:space-y-0">

                <div className="space-y-3">
                  {/* Search input area */}
                  <div className="flex w-full flex-col gap-2 items-center space-x-2 p-2 border rounded-xl shadow-lg hover:shadow-xl transition-shadow bg-background">
                    {/* <Search className="h-5 w-5 text-muted-foreground mx-4 ml-2" /> */}
                    <Textarea
                      name="query"
                      value={currentQuery}
                      placeholder="Search for papers, topics..."
                      className="flex-1 border-0 bg-transparent resize-none min-h-[48px] max-h-32 mr-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-base"
                      disabled={isFormDisabled}
                      onChange={(e) => handleQueryChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          const form = e.currentTarget.form;
                          if (form) {
                            form.requestSubmit();
                          }
                        }
                      }}
                    />
                     <div className="flex items-center justify-center gap-3">
                    <KeywordExpansionTooltip
                      query={currentQuery}
                      side="top"
                      variant="outline"
                      buttonClassName="rounded-full h-12 w-12"
                      asLink
                      href="/bookmarks"
                      iconOnly
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          asChild
                          size="icon"
                          variant="outline"
                          className="rounded-full h-12 w-12"
                        >
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
                      disabled={isFormDisabled}
                      className="rounded-full h-12 w-12"
                      size="icon"
                    >
                      <Search className="h-5 w-5" />
                    </Button>
                  </div>
                  </div>

                  {/* Buttons row */}
                 
                </div>
              </div>
            </form>

            {/* Quick Actions */}
            <div className="text-center space-y-2 px-4">
              <p className="text-sm text-muted-foreground">
                Try searching for topics like "machine learning", "climate
                change", or "quantum computing"
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
                onQuerySelect={handleQuerySelect}
              />

              {/* Footer */}
              <div className="text-center mt-12 pt-6">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-100/50 shadow-sm">
                  <span className="text-sm text-muted-foreground">
                    Built with
                  </span>
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
