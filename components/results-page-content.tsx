"use client";

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Navbar } from './navbar';
import { SearchSidebar } from './search-sidebar';
import { ResultsList } from './results-list';
import { useSearchFormStore, useUIStore, useResultsStore } from '@/lib/store';
import {
  submitSearchAndLoadResults,
  loadSearchResultsById,
  loadSearchResults,
  updateCurrentSearchFilters,
  downloadItem,
  downloadEssentialItem,
  downloadAll,
  openFocusMode,
} from '@/lib/search-actions';
import { FocusMode } from '@/components/ui/focus-mode';
import { Button } from '@/components/ui/button';
import { Eye, Loader2, Sparkles, Search } from 'lucide-react';
import { DownloadMenu } from './download-menu';
import { useIsMobile } from '@/lib/hooks';
import { motion, AnimatePresence } from 'framer-motion';

interface ResultsPageContentProps {
  searchId?: string;
}

export default function ResultsPageContent({ searchId }: ResultsPageContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const isMobile = useIsMobile();

  const {
    currentSearchField,
    dateRange,
    sortBy,
    filterType,
    yearRange,
    isFilterActive,
    currentSearchId,
  } = useSearchFormStore();

  const {
    isLoading,
    isFocusModeOpen,
    loadingResultIndex,
    isFilterLoading,
  } = useUIStore();

  const {
    results,
    totalCount,
    currentQuery,
    resultsSearchField,
    resultsDateRange,
    resultsYearRange,
  } = useResultsStore();

  // Load results when opening a direct link with no results in state
  React.useEffect(() => {
    if (searchId && results.length === 0 && !currentQuery) {
      // Only load if we have a searchId but no results/query in state
      // This happens when opening a direct link in a new tab
      const loadResults = async () => {
        try {
          const result = await loadSearchResultsById(searchId);
          // If result is null, it means keyword expansion failed
          // The warning toast was already shown, no need to do anything else
        } catch (error) {
          console.error('Failed to load search results:', error);
        }
      };
      loadResults();
    }
  }, [searchId, results.length, currentQuery]);

  const handleNewSearch = async (query: string) => {
    // Create form data for the search
    const formData = new FormData();
    formData.set('query', query);
    
    // Submit search and load results in one call, get the search ID
    const { searchId: newSearchId } = await submitSearchAndLoadResults(
      formData,
      currentSearchField,
      dateRange,
      sortBy,
      yearRange,
      filterType,
      isFilterActive
    );

    // Only navigate if search was successful (searchId is not null)
    if (newSearchId) {
      router.push(`/results/${newSearchId}`);
    }
  };

  const handleBackToHome = () => {
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar
        searchQuery={currentQuery}
        onSearchSubmit={handleNewSearch}
        onMenuToggle={() => setIsSidebarOpen(true)}
        isLoading={isLoading}
        loadingResultIndex={loadingResultIndex}
        isFilterLoading={isFilterLoading}
      />

      <div className="container mx-auto p-6 pb-0">
        <div className="flex gap-6">
          {/* Desktop Sidebar */}
          <aside className="hidden lg:block flex-shrink-0">
            <SearchSidebar />
          </aside>

          {/* Mobile Sidebar - Only render on mobile */}
          {isMobile && (
            <SearchSidebar
              isOpen={isSidebarOpen}
              onClose={() => setIsSidebarOpen(false)}
              isMobile={isMobile}
            />
          )}

          {/* Main Content */}
          <main className="flex-1 min-w-0 relative">
            {isLoading || isFilterLoading ? (
              <div className="text-center py-12">
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <div>
                    <h2 className="text-xl font-semibold mb-2">Loading Results</h2>
                    <p className="text-muted-foreground">
                      Searching through millions of academic papers...
                    </p>
                  </div>
                </div>
              </div>
            ) : results.length > 0 ? (
              <div className="space-y-4">
                {/* Updating Results Animation */}
                <motion.div
                  animate={{ 
                    height: isFilterLoading ? "auto" : 0,
                    marginBottom: isFilterLoading ? 16 : 0
                  }}
                  transition={{ 
                    type: "spring", 
                    stiffness: 400, 
                    damping: 30,
                    duration: 0.4
                  }}
                  className="overflow-hidden"
                >
                  <AnimatePresence>
                    {isFilterLoading && (
                      <motion.div
                        initial={{ opacity: 0, y: -20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.95 }}
                        transition={{ 
                          type: "spring", 
                          stiffness: 400, 
                          damping: 25,
                          duration: 0.3
                        }}
                      >
                        <div className="bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 dark:from-blue-950/30 dark:via-purple-950/30 dark:to-pink-950/30 border border-blue-200/50 dark:border-blue-800/50 rounded-xl p-4 shadow-sm relative overflow-hidden">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                              >
                                <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                              </motion.div>
                            </div>
                            <div className="flex-1">
                              <p className="font-medium text-blue-900 dark:text-blue-100">
                                Updating results...
                              </p>
                              <p className="text-sm text-blue-700 dark:text-blue-300">
                                Applying your new filters
                              </p>
                            </div>
                          </div>
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: "100%" }}
                            transition={{ duration: 1.5, ease: "easeInOut" }}
                            className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* Results Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold">Search Results</h1>
                    <p className="text-muted-foreground">
                      {totalCount.toLocaleString()} results for "{currentQuery}"
                    </p>
                  </div>
                  
                  <div className="flex items-center  gap-3 flex-shrink-0">
                    {/* Flashy Focus Mode Button */}
                    <Button
                      onClick={() => openFocusMode(isMobile)}
                      className="relative overflow-hidden bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 hover:from-purple-700 hover:via-pink-700 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 border-0"
                      size="sm"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-purple-400/20 via-pink-400/20 to-blue-400/20 animate-pulse" />
                      <div className="relative flex items-center gap-2">
                        <Eye className="h-4 w-4" />
                        <span className="font-semibold whitespace-nowrap">Focus Mode</span>
                      </div>
                    </Button>
                    
                    <DownloadMenu
                      variant="button"
                      size="sm"
                      onDownloadJSON={() => downloadAll("json")}
                      onDownloadCSV={() => downloadAll("csv")}
                      onDownloadEssentialJSON={() => downloadAll("json", true)}
                      onDownloadEssentialCSV={() => downloadAll("csv", true)}
                    />
                  </div>
                </div>

                {/* Results List */}
                <ResultsList
                  onDownloadItem={downloadItem}
                  onDownloadEssentialItem={downloadEssentialItem}
                />
              </div>
            ) : currentQuery ? (
              <div className="text-center py-12">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                    <Search className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold mb-2">No Results Found</h2>
                    <p className="text-muted-foreground mb-4">
                      No papers found for "{currentQuery}". Try adjusting your search terms or filters.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 justify-center">
                      <Button variant="outline" onClick={handleBackToHome}>
                        Try New Search
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <h2 className="text-xl font-semibold mb-2">No search query</h2>
                <p className="text-muted-foreground mb-4">
                  Please enter a search query to see results.
                </p>
                <Button onClick={handleBackToHome}>
                  Back to Home
                </Button>
              </div>
            )}
          </main>
        </div>
        
        {/* Footer */}
        <footer className="py-8">
          <div className="container mx-auto p-6">
            <div className="text-center">
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
        </footer>
      </div>

      <FocusMode
        isOpen={isFocusModeOpen}
        onClose={() => useUIStore.getState().setIsFocusModeOpen(false)}
        papers={results}
        onDownloadItem={downloadItem}
        onDownloadEssentialItem={downloadEssentialItem}
      />
    </div>
  );
} 