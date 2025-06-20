"use client";

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Navbar } from './navbar';
import { SearchSidebar } from './search-sidebar';
import { ResultsList } from './results-list';
import { useUIStore } from '@/lib/store';
import {
  submitSearchAndLoadResults,
  updateCurrentSearch,
  downloadItem,
  downloadEssentialItem,
  downloadAll,
  openFocusMode,
} from '@/lib/search-actions';
import { FocusMode } from '@/components/ui/focus-mode';
import { Button } from '@/components/ui/button';
import { Eye, Loader2, Sparkles, Search } from 'lucide-react';
import { DownloadMenu } from './download-menu';
import { useIsMobile, useEffectiveSearchId, useCurrentSearchFormState, useSearchResults } from '@/lib/hooks';
import { isDateFilterActive } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { validateAndExpandKeywordsSilently } from '@/lib/keyword-validation';

interface ResultsPageContentProps {
  searchId?: string;
}

export default function ResultsPageContent({ searchId }: ResultsPageContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const hasAttemptedLoad = React.useRef(false);

  const {
    currentSearchField,
    dateRange,
    sortBy,
    filterType,
    yearRange,
    isYearRangeEnabled,
  } = useCurrentSearchFormState();

  // Computed filter active state
  const isFilterActive = isDateFilterActive(dateRange, yearRange, filterType, isYearRangeEnabled);

  const effectiveSearchId = useEffectiveSearchId();

  const {
    isFocusModeOpen,
    loadingResultIndex,
  } = useUIStore();

  const {
    results,
    totalCount,
    originalQuery: currentQuery,
    searchState,
    isLoading,
    isValidating,
    isLoadingResults,
  } = useSearchResults();

  const handleBackToHome = () => {
    router.push('/');
  };

  return (
    <>
      <div className="container mx-auto p-6 pb-0">
        <div className="flex gap-6">
          {/* Desktop Sidebar */}
          <aside className="hidden lg:block flex-shrink-0">
            <SearchSidebar />
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0 relative">
            {(isLoading || isValidating) && results.length === 0 ? (
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
                    height: isValidating ? "auto" : 0,
                    marginBottom: isValidating ? 16 : 0
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
                    {isValidating && (
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
                      {totalCount.toLocaleString()} results
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
                      onDownloadJSON={() => downloadAll("json", false, searchState, results)}
                      onDownloadCSV={() => downloadAll("csv", false, searchState, results)}
                      onDownloadEssentialJSON={() => downloadAll("json", true, searchState, results)}
                      onDownloadEssentialCSV={() => downloadAll("csv", true, searchState, results)}
                    />
                  </div>
                </div>

                {/* Results List */}
                <ResultsList
                  onDownloadItem={(item, format) => downloadItem(item, format, searchState)}
                  onDownloadEssentialItem={(item, format) => downloadEssentialItem(item, format, searchState)}
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
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                    <Search className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold mb-2">No Results Found</h2>
                    <p className="text-muted-foreground mb-4">
                      No papers found. Try adjusting your search terms or filters.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 justify-center">
                      <Button variant="outline" onClick={handleBackToHome}>
                        Try New Search
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      <FocusMode
        isOpen={isFocusModeOpen}
        onClose={() => useUIStore.getState().setIsFocusModeOpen(false)}
        papers={results}
        onDownloadItem={(item, format) => downloadItem(item, format, searchState)}
        onDownloadEssentialItem={(item, format) => downloadEssentialItem(item, format, searchState)}
      />
    </>
  );
} 