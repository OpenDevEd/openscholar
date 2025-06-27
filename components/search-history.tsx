import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Loader2, X, Trash2, ExternalLink, Download, Copy, Clock, ChevronLeft, ChevronRight, History, Upload, FileDown, FileUp, MoreVertical, BookmarkPlus, Check } from "lucide-react";
import { format } from "date-fns";
import { jsonToCSV, downloadAsFile, uploadFile, triggerFileUpload, isCountryFilterActive, isCountryFocusActive, isRatingFilterActive } from "@/lib/utils";
import type { SearchField } from "@/lib/types";
import { sortOptions, COUNTRIES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useSearchHistoryStore, useSearchHistoryUIStore, useKeywordExpansionStore } from "@/lib/store";
import { DateRange } from "react-day-picker";
import { useIsMobile } from "@/lib/hooks";
import { toast } from "sonner";
import { showConfirmation } from "@/lib/confirmation";
import { CountryFlag } from "@/components/ui/country-flag";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";

interface SearchHistoryProps {
  onSearchResults: (query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], filterType?: "date" | "year", index?: number) => void;
  loadingResultIndex: number | null;
  currentSearchField: SearchField;
  compact?: boolean;
  currentSearchId?: string;
  hideHeader?: boolean;
}

export function SearchHistory({ onSearchResults, loadingResultIndex, currentSearchField, compact = false, currentSearchId, hideHeader = false }: SearchHistoryProps) {
  const { searchHistory, removeSearchResult, clearSearchHistory, importSearchHistory } = useSearchHistoryStore();
  const { currentPage, setCurrentPage } = useSearchHistoryUIStore();
  const { keywords, addKeyword } = useKeywordExpansionStore();
  const isMobile = useIsMobile();
  const itemsPerPage = compact ? 5 : 10;
  
  // State for bookmark creation
  const [bookmarkingIndex, setBookmarkingIndex] = useState<number | null>(null);
  const [bookmarkName, setBookmarkName] = useState('');

  // Handlers
  const handleCardClick = (result: any, actualIndex: number) => {
    if (isMobile) {
      onSearchResults(result.query, result.field || currentSearchField, result.dateRange, result.sortBy, result.yearRange, result.filterType, actualIndex);
    }
  };

  const handleCopyQuery = async (query: string) => {
    try {
      await navigator.clipboard.writeText(query);
      toast.success("Query copied to clipboard");
    } catch (err) {
      const textArea = document.createElement('textarea');
      textArea.value = query;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      toast.success("Query copied to clipboard");
    }
  };

  const handleDownloadJSON = () => {
    try {
      const data = searchHistory.map(item => {
        const { expandedQuery } = validateAndExpandKeywordsSilently(item.query);
        return {
          search_query: expandedQuery,
          count: item.count,
          field: item.field,
        };
      });
      downloadAsFile(JSON.stringify(data, null, 2), 'search_history.json', 'json');
      toast.success(`Downloaded ${data.length} search entries as JSON`);
    } catch (error) {
      toast.error("Failed to download JSON file");
    }
  };

  const handleDownloadCSV = async () => {
    try {
      const data = searchHistory.map(item => {
        const { expandedQuery } = validateAndExpandKeywordsSilently(item.query);
        return {
          search_query: expandedQuery,
          count: item.count,
          field: item.field,
        };
      });
      const csv = await jsonToCSV(data);
      downloadAsFile(csv, 'search_history.csv', 'csv');
      toast.success(`Downloaded ${data.length} search entries as CSV`);
    } catch (error) {
      toast.error("Failed to download CSV file");
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload('.json');
      const data = await uploadFile(file);
      const importedCount = importSearchHistory(data);
      if (importedCount > 0) {
        toast.success(`Successfully imported ${importedCount} search entries`);
      } else {
        toast.warning("No valid search entries found in the file");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload JSON file");
    }
  };

  const handleUploadCSV = async () => {
    try {
      const file = await triggerFileUpload('.csv');
      const data = await uploadFile(file);
      const importedCount = importSearchHistory(data);
      if (importedCount > 0) {
        toast.success(`Successfully imported ${importedCount} search entries`);
      } else {
        toast.warning("No valid search entries found in the file");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload CSV file");
    }
  };

  const handleDeleteItem = (index: number, query: string) => {
    const truncatedQuery = query.length > 50 ? query.substring(0, 50) + '...' : query;
    showConfirmation({
      title: "Delete Search Entry",
      message: `Are you sure you want to delete "${truncatedQuery}"?`,
      confirmText: "Delete",
      onConfirm: () => {
        removeSearchResult(index);
        toast.success("Search entry deleted");
      }
    });
  };

  const handleClearAll = () => {
    showConfirmation({
      title: "Clear All Search History",
      message: `Are you sure you want to delete all ${searchHistory.length} search entries? This action cannot be undone.`,
      confirmText: "Clear All",
      onConfirm: () => {
        clearSearchHistory();
        toast.success("All search history cleared");
      }
    });
  };

  const validateKeyword = (keyword: string): string | null => {
    if (!keyword.trim()) return "Bookmark name cannot be empty";
    if (!/^[a-zA-Z0-9-]+$/.test(keyword)) return "Bookmark name can only contain letters, numbers, and dashes";
    if (keyword.includes(' ')) return "Bookmark name cannot contain spaces";
    if (keywords[keyword]) return `Bookmark "${keyword}" already exists`;
    return null;
  };

  const handleBookmarkClick = (index: number) => {
    setBookmarkingIndex(index);
    setBookmarkName('');
  };

  const handleBookmarkCancel = () => {
    setBookmarkingIndex(null);
    setBookmarkName('');
  };

  const handleBookmarkSubmit = (index: number, query: string) => {
    const validationError = validateKeyword(bookmarkName);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    // Expand the query before saving it as a bookmark
    const { expandedQuery } = validateAndExpandKeywordsSilently(query);
    
    addKeyword(bookmarkName.trim(), expandedQuery);
    toast.success(`Search saved as bookmark "${bookmarkName}"`);
    setBookmarkingIndex(null);
    setBookmarkName('');
  };

  const formatNumber = (num: number) => num.toLocaleString();

  // Sub-components
  const ActionDropdown = ({ variant = 'compact' }: { variant?: 'compact' | 'full' }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleDownloadJSON}>
          <FileDown className="h-4 w-4 mr-2" />
          Download as JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDownloadCSV}>
          <FileDown className="h-4 w-4 mr-2" />
          Download as CSV
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleUploadJSON}>
          <FileUp className="h-4 w-4 mr-2" />
          Upload JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleUploadCSV}>
          <FileUp className="h-4 w-4 mr-2" />
          Upload CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const ClearAllButton = ({ variant = 'compact' }: { variant?: 'compact' | 'full' }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClearAll}
      disabled={searchHistory.length === 0}
      className={cn(
        'text-muted-foreground hover:text-destructive transition-colors self-start sm:self-auto',
        searchHistory.length === 0 && 'opacity-50'
      )}
    >
      <Trash2 className="h-4 w-4" />
      <span className="sm:hidden">Clear All</span>
    </Button>
  );

  const HeaderSection = ({ title, count, variant = 'compact' }: { title: string; count: number; variant?: 'compact' | 'full' }) => (
    <div className="flex items-center gap-2">
      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
        <Clock className="h-4 w-4 text-white" />
      </div>
      {variant === 'compact' ? (
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      ) : (
        <CardTitle className="text-xl">{title}</CardTitle>
      )}
      <span className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded-full">
        {count}{variant === 'full' ? ' searches' : ''}
      </span>
    </div>
  );

  const HeaderButtons = ({ variant = 'compact' }: { variant?: 'compact' | 'full' }) => (
    <div className={cn(
      "flex items-center",
      variant === 'compact' ? 'gap-2' : 'gap-2 sm:gap-3 justify-center sm:justify-end'
    )}>
      <ActionDropdown variant={variant} />
      <ClearAllButton variant={variant} />
    </div>
  );

  const EmptyState = () => (
    <div className="text-center py-12">
      <div className="flex justify-center mb-4">
        <div className="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500/10 to-purple-600/10 flex items-center justify-center">
          <History className="h-8 w-8 text-muted-foreground" />
        </div>
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">No search history yet</h3>
      <p className="text-muted-foreground text-sm max-w-md mx-auto">
        Start searching for academic papers and your search history will appear here. 
        This helps you quickly revisit previous searches and track your research progress.
      </p>
    </div>
  );

  const SearchItem = ({ result, index, actualIndex, variant = 'compact' }: { 
    result: any; 
    index: number; 
    actualIndex: number; 
    variant?: 'compact' | 'full' 
  }) => {
    const isCurrentSearch = currentSearchId && result.id === currentSearchId;
    
    return (
      <div
        key={actualIndex}
        className={cn(
          "group relative overflow-hidden rounded-xl border transition-all duration-200 cursor-pointer md:cursor-default",
          isCurrentSearch 
            ? 'border-primary/50 bg-primary/5 shadow-md ring-1 ring-primary/20' 
            : cn(
                "border-border/50 hover:border-border",
                variant === 'compact' 
                  ? 'bg-card/50 backdrop-blur-sm hover:bg-card/80 hover:shadow-md' 
                  : 'bg-card/30 backdrop-blur-sm hover:bg-card/60 hover:shadow-lg'
              )
        )}
        onClick={() => handleCardClick(result, actualIndex)}
      >
      {/* Header with filters and actions */}
      <div className={cn(
        "flex items-center justify-between pb-2",
        variant === 'compact' ? 'px-4 pt-4' : 'px-5 pt-5'
      )}>
        {/* Filters section with horizontal scroll */}
        <div className="flex-1 overflow-x-auto scrollbar-hover">
          <div className={cn(
            "flex items-center gap-2 min-w-0",
            variant === 'compact' ? 'text-xs' : 'text-xs sm:text-sm'
          )}>
            <span className={cn(
              "bg-primary/10 text-primary py-1 font-medium shrink-0",
              variant === 'compact' ? 'px-2 rounded-md' : 'px-3 rounded-lg'
            )}>
              {variant === 'full' ? 'Field: ' : ''}{result.field}
            </span>
            {result.filterType === "year" && result.yearRange ? (
              <span className={cn(
                "bg-blue-50 text-blue-700 py-1 shrink-0",
                variant === 'compact' ? 'px-2 rounded-md' : 'px-3 rounded-lg'
              )}>
                📅 {result.yearRange[0]} - {result.yearRange[1]}
              </span>
            ) : result.dateRange?.from ? (
              <span className={cn(
                "bg-blue-50 text-blue-700 py-1 shrink-0",
                variant === 'compact' ? 'px-2 rounded-md' : 'px-3 rounded-lg'
              )}>
                📅 {format(result.dateRange.from, variant === 'compact' ? "MMM yyyy" : "MMM dd, yyyy")} - {result.dateRange.to ? format(result.dateRange.to, variant === 'compact' ? "MMM yyyy" : "MMM dd, yyyy") : "now"}
              </span>
            ) : variant === 'full' ? (
              <span className="bg-gray-50 text-gray-700 px-3 py-1 rounded-lg shrink-0">
                📅 All dates
              </span>
            ) : null}
            {isCountryFilterActive(result.selectedRegions) && (
              <span className={cn(
                "bg-emerald-50 text-emerald-700 py-1 flex items-center gap-1 shrink-0",
                variant === 'compact' ? 'px-2 rounded-md' : 'px-3 rounded-lg'
              )}>
                🌍 Institution location: {(() => {
                  const regions = result.selectedRegions.filter((id: string) => !(id.length === 2 && COUNTRIES[id]));
                  const countries = result.selectedRegions.filter((id: string) => id.length === 2 && COUNTRIES[id]);
                  const parts = [];
                  
                  if (regions.length > 0) {
                    parts.push(`${regions.length} region${regions.length > 1 ? 's' : ''}`);
                  }
                  if (countries.length > 0) {
                    parts.push(`${countries.length} countr${countries.length > 1 ? 'ies' : 'y'}`);
                  }
                  
                  return parts.join(' + ');
                })()}
                {variant === 'full' && result.selectedRegions.filter((id: string) => id.length === 2 && COUNTRIES[id]).length > 0 && (
                  <span className="flex items-center gap-0.5 ml-1">
                    {result.selectedRegions
                      .filter((id: string) => id.length === 2 && COUNTRIES[id])
                      .slice(0, 3)
                      .map((countryCode: string) => (
                        <CountryFlag key={countryCode} countryCode={countryCode} className="w-3 h-2" />
                      ))}
                    {result.selectedRegions.filter((id: string) => id.length === 2 && COUNTRIES[id]).length > 3 && (
                      <span className="text-xs text-emerald-600 ml-1">+{result.selectedRegions.filter((id: string) => id.length === 2 && COUNTRIES[id]).length - 3}</span>
                    )}
                  </span>
                )}
              </span>
            )}
            {isCountryFocusActive(result.selectedCountryFocus) && (
              <span className={cn(
                "bg-purple-50 text-purple-700 py-1 flex items-center gap-1 shrink-0",
                variant === 'compact' ? 'px-2 rounded-md' : 'px-3 rounded-lg'
              )}>
                🎯 Country focus: {(() => {
                  const regions = result.selectedCountryFocus.filter((id: string) => !(id.length === 2 && COUNTRIES[id]));
                  const countries = result.selectedCountryFocus.filter((id: string) => id.length === 2 && COUNTRIES[id]);
                  const parts = [];
                  
                  if (regions.length > 0) {
                    parts.push(`${regions.length} region${regions.length > 1 ? 's' : ''}`);
                  }
                  if (countries.length > 0) {
                    parts.push(`${countries.length} countr${countries.length > 1 ? 'ies' : 'y'}`);
                  }
                  
                  return parts.join(' + ');
                })()}
                {variant === 'full' && result.selectedCountryFocus.filter((id: string) => id.length === 2 && COUNTRIES[id]).length > 0 && (
                  <span className="flex items-center gap-0.5 ml-1">
                    {result.selectedCountryFocus
                      .filter((id: string) => id.length === 2 && COUNTRIES[id])
                      .slice(0, 3)
                      .map((countryCode: string) => (
                        <CountryFlag key={countryCode} countryCode={countryCode} className="w-3 h-2" />
                      ))}
                    {result.selectedCountryFocus.filter((id: string) => id.length === 2 && COUNTRIES[id]).length > 3 && (
                      <span className="text-xs text-purple-600 ml-1">+{result.selectedCountryFocus.filter((id: string) => id.length === 2 && COUNTRIES[id]).length - 3}</span>
                    )}
                  </span>
                )}
              </span>
            )}
            {result.citesItemId && (
              <span className={cn(
                "bg-orange-50 text-orange-700 py-1 flex items-center gap-1 shrink-0",
                variant === 'compact' ? 'px-2 rounded-md' : 'px-3 rounded-lg'
              )}>
                📑 Cites: {result.citesItemId}
              </span>
            )}
            {result.citedByItemId && (
              <span className={cn(
                "bg-green-50 text-green-700 py-1 flex items-center gap-1 shrink-0",
                variant === 'compact' ? 'px-2 rounded-md' : 'px-3 rounded-lg'
              )}>
                📋 Cited by: {result.citedByItemId}
              </span>
            )}
            {result.relatedToItemId && (
              <span className={cn(
                "bg-blue-50 text-blue-700 py-1 flex items-center gap-1 shrink-0",
                variant === 'compact' ? 'px-2 rounded-md' : 'px-3 rounded-lg'
              )}>
                🔗 Related: {result.relatedToItemId}
              </span>
            )}
            {isRatingFilterActive(result.ratingRange, result.onlyRatedPapers) && (
              <span className={cn(
                "bg-amber-50 text-amber-700 py-1 flex items-center gap-1 shrink-0",
                variant === 'compact' ? 'px-2 rounded-md' : 'px-3 rounded-lg'
              )}>
                ⭐ {(() => {
                  const parts = [];
                  if (result.ratingRange) {
                    const [min, max] = result.ratingRange;
                    if (min > 0 || max < 5) {
                      parts.push(`${min === max ? min : `${min}-${max}`} star${min === 1 && max === 1 ? '' : 's'}`);
                    }
                  }
                  if (result.onlyRatedPapers) {
                    parts.push('rated only');
                  }
                  return parts.length > 0 ? parts.join(', ') : 'filtered';
                })()}
              </span>
            )}
            {result.reviewFilter && (
              <span className={cn(
                "bg-pink-50 text-pink-700 py-1 flex items-center gap-1 shrink-0",
                variant === 'compact' ? 'px-2 rounded-md' : 'px-3 rounded-lg'
              )}>
                📄 Reviews only
              </span>
            )}
            {variant === 'full' && (
              <span className="bg-purple-50 text-purple-700 px-3 py-1 rounded-lg shrink-0">
                Sort: {result.sortBy ? sortOptions.find(opt => opt.value === result.sortBy)?.label || result.sortBy : "Relevance"}
              </span>
            )}
          </div>
        </div>
        
        {/* Actions */}
        <div className={cn(
          "flex items-center gap-1 transition-opacity ml-2 shrink-0",
          variant === 'compact' 
            ? 'opacity-100 md:opacity-0 md:group-hover:opacity-100' 
            : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
        )}>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "text-muted-foreground hover:text-primary hover:bg-primary/10",
              variant === 'compact' ? 'h-7 w-7' : 'h-8 w-8'
            )}
            onClick={(e) => {
              e.stopPropagation();
              handleCopyQuery(result.query);
            }}
            title="Copy search query"
          >
            <Copy className={cn(
              variant === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5'
            )} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "text-muted-foreground hover:text-amber-600 hover:bg-amber-50",
              variant === 'compact' ? 'h-7 w-7' : 'h-8 w-8'
            )}
            onClick={(e) => {
              e.stopPropagation();
              handleBookmarkClick(actualIndex);
            }}
            disabled={!result.query.trim()}
            title="Save as bookmark"
          >
            <BookmarkPlus className={cn(
              variant === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5'
            )} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "text-muted-foreground hover:text-primary hover:bg-primary/10",
              variant === 'compact' ? 'h-7 w-7' : 'h-8 w-8'
            )}
            onClick={(e) => {
              e.stopPropagation();
              onSearchResults(result.query, result.field || currentSearchField, result.dateRange, result.sortBy, result.yearRange, result.filterType, actualIndex);
            }}
            disabled={loadingResultIndex !== null}
            title="View search results"
          >
            {loadingResultIndex === actualIndex ? (
              <Loader2 className={cn(
                "animate-spin",
                variant === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5'
              )} />
            ) : (
              <Search className={cn(
                variant === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5'
              )} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
              variant === 'compact' ? 'h-7 w-7' : 'h-8 w-8'
            )}
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteItem(actualIndex, result.query);
            }}
            title="Remove from history"
          >
            <X className={cn(
              variant === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5'
            )} />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className={cn(
        variant === 'compact' ? 'px-4 pb-4' : 'px-5 pb-5'
      )}>
        <div className="space-y-3">
          {bookmarkingIndex === actualIndex ? (
            /* Bookmark creation interface */
            <div className="space-y-3 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                <BookmarkPlus className="h-4 w-4" />
                <span className="font-medium text-sm">Save as Bookmark</span>
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                Bookmarks let you create shortcuts for complex search queries. Use the format "bookmark..." in your search to expand them automatically.
              </p>
              <div className="space-y-2">
                <Input
                  placeholder="Enter bookmark name (e.g., ai-research)"
                  value={bookmarkName}
                  onChange={(e) => setBookmarkName(e.target.value)}
                  className="text-sm bg-background border-amber-200 dark:border-amber-800 focus:border-amber-400 dark:focus:border-amber-600"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleBookmarkSubmit(actualIndex, result.query);
                    } else if (e.key === 'Escape') {
                      handleBookmarkCancel();
                    }
                  }}
                  autoFocus
                />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Letters, numbers, and dashes only. No spaces allowed.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleBookmarkSubmit(actualIndex, result.query)}
                    disabled={!bookmarkName.trim()}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleBookmarkCancel}
                    className="text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* Normal content */
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className={cn(
                "text-foreground break-words leading-relaxed",
                variant === 'compact' ? 'font-medium text-sm md:text-base' : 'font-semibold text-lg'
              )} title={result.query}>
                <span className={cn(
                  "inline-flex items-center gap-1 text-muted-foreground bg-muted/60 py-0.5 rounded mr-2",
                  variant === 'compact' ? 'text-xs px-1.5' : 'text-sm px-2'
                )}>
                  <Search className={cn(
                    variant === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5'
                  )} />
                  {formatNumber(result.count)}
                </span>
                {result.query}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  };

  const Pagination = ({ variant = 'compact' }: { variant?: 'compact' | 'full' }) => {
    const totalPages = Math.ceil(searchHistory.length / itemsPerPage);
    const goToPage = (page: number) => setCurrentPage(Math.max(1, Math.min(page, totalPages)));

    if (totalPages <= 1) return null;

    if (variant === 'compact') {
      return (
        <>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="h-9 w-9 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            {/* Mobile pagination - show 3 pages */}
            <div className="flex items-center gap-1 sm:hidden">
              {Array.from({ length: Math.min(3, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 3) {
                  pageNum = i + 1;
                } else if (currentPage <= 2) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 1) {
                  pageNum = totalPages - 2 + i;
                } else {
                  pageNum = currentPage - 1 + i;
                }
                
                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "ghost"}
                    size="sm"
                    onClick={() => goToPage(pageNum)}
                    className="h-9 w-9 p-0 text-xs"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            
            {/* Desktop pagination - show 5 pages */}
            <div className="hidden sm:flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                
                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "ghost"}
                    size="sm"
                    onClick={() => goToPage(pageNum)}
                    className="h-9 w-9 p-0 text-xs"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="h-9 w-9 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          
          {searchHistory.length > itemsPerPage && (
            <div className="text-center">
              <p className="text-xs text-muted-foreground">
                Showing {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, searchHistory.length)} of {searchHistory.length} searches
              </p>
            </div>
          )}
        </>
      );
    }

    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-6">
        <p className="text-sm text-muted-foreground text-center sm:text-left">
          Showing {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, searchHistory.length)} of {searchHistory.length} searches
        </p>
        <div className="flex items-center gap-2 justify-center sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="flex items-center gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden xs:inline">Previous</span>
            <span className="xs:hidden">Prev</span>
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (currentPage <= 4) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = currentPage - 3 + i;
              }
              
              return (
                <Button
                  key={pageNum}
                  variant={currentPage === pageNum ? "default" : "outline"}
                  size="sm"
                  onClick={() => goToPage(pageNum)}
                  className="h-9 w-9 p-0"
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="flex items-center gap-1"
          >
            <span className="hidden xs:inline">Next</span>
            <span className="xs:hidden">Next</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  // Main render logic
  const totalPages = Math.ceil(searchHistory.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const displayHistory = searchHistory.slice(startIndex, endIndex);

  if (compact) {
    return (
      <div className="w-full space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <HeaderSection title="Recent Searches" count={searchHistory.length} variant="compact" />
          <HeaderButtons variant="compact" />
        </div>
        
        {searchHistory.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="space-y-3">
              {displayHistory.map((result, index) => {
                const actualIndex = startIndex + index;
                return (
                  <SearchItem 
                    key={actualIndex}
                    result={result} 
                    index={index} 
                    actualIndex={actualIndex} 
                    variant="compact" 
                  />
                );
              })}
            </div>
            <Pagination variant="compact" />
          </>
        )}
      </div>
    );
  }

  if (hideHeader) {
    return (
      <div className="w-full space-y-4">
        {searchHistory.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Clean mobile-first header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
              {/* Left side - Simple count on mobile, more details on desktop */}
              <div className="flex items-center justify-between sm:justify-start gap-3">
                <span className="text-sm text-muted-foreground">
                  {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, searchHistory.length)}
                </span>
                {/* Mobile actions on same line */}
                <div className="sm:hidden">
                  <HeaderButtons variant="compact" />
                </div>
              </div>
              
              {/* Desktop actions */}
              <div className="hidden sm:flex">
                <HeaderButtons variant="compact" />
              </div>
            </div>
            
            <div className="space-y-3">
              {displayHistory.map((result, index) => {
                const actualIndex = startIndex + index;
                return (
                  <SearchItem 
                    key={actualIndex}
                    result={result} 
                    index={index} 
                    actualIndex={actualIndex} 
                    variant="full" 
                  />
                );
              })}
            </div>
            <Pagination variant="full" />
          </>
        )}
      </div>
    );
  }

  return (
    <Card suppressHydrationWarning className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <HeaderSection title="Search History" count={searchHistory.length} variant="full" />
          <HeaderButtons variant="full" />
        </div>
      </CardHeader>
      <CardContent>
        {searchHistory.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="space-y-3">
              {displayHistory.map((result, index) => {
                const actualIndex = startIndex + index;
                return (
                  <SearchItem 
                    key={actualIndex}
                    result={result} 
                    index={index} 
                    actualIndex={actualIndex} 
                    variant="full" 
                  />
                );
              })}
            </div>
            <Pagination variant="full" />
          </>
        )}
      </CardContent>
    </Card>
  );
} 