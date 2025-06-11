import React from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Loader2, X, Trash2, ExternalLink, Download, Copy, Clock, ChevronLeft, ChevronRight, History, Upload, FileDown, FileUp, MoreVertical } from "lucide-react";
import { format } from "date-fns";
import { jsonToCSV, downloadAsFile, SearchField, uploadFile, triggerFileUpload } from "@/lib/utils";
import { sortOptions, COUNTRIES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useSearchHistoryStore, useSearchHistoryUIStore } from "@/lib/store";
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
}

export function SearchHistory({ onSearchResults, loadingResultIndex, currentSearchField, compact = false, currentSearchId }: SearchHistoryProps) {
  const { searchHistory, removeSearchResult, clearSearchHistory, importSearchHistory } = useSearchHistoryStore();
  const { currentPage, setCurrentPage } = useSearchHistoryUIStore();
  const isMobile = useIsMobile();
  const itemsPerPage = compact ? 5 : 10;

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

  const formatNumber = (num: number) => num.toLocaleString();

  // Sub-components
  const ActionDropdown = ({ variant = 'compact' }: { variant?: 'compact' | 'full' }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant={variant === 'compact' ? 'ghost' : 'outline'} 
          size="sm"
          className={variant === 'compact' ? 'text-muted-foreground hover:text-foreground transition-colors' : ''}
        >
          {variant === 'compact' ? (
            <MoreVertical className="h-4 w-4" />
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Download
            </>
          )}
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
      variant={variant === 'compact' ? 'ghost' : 'destructive'}
      size="sm"
      onClick={handleClearAll}
      disabled={searchHistory.length === 0}
      className={`${variant === 'compact' 
        ? 'text-muted-foreground hover:text-destructive transition-colors self-start sm:self-auto' 
        : 'flex items-center gap-2'
      } ${searchHistory.length === 0 ? 'opacity-50' : ''}`}
    >
      <Trash2 className="h-4 w-4" />
      {variant === 'compact' ? (
        <span className="sm:hidden">Clear All</span>
      ) : (
        'Clear All'
      )}
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
    <div className="flex gap-2">
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
        className={`group relative overflow-hidden rounded-xl border transition-all duration-200 cursor-pointer md:cursor-default ${
          isCurrentSearch 
            ? 'border-primary/50 bg-primary/5 shadow-md ring-1 ring-primary/20' 
            : `border-border/50 ${
                variant === 'compact' 
                  ? 'bg-card/50 backdrop-blur-sm hover:bg-card/80' 
                  : 'bg-card/30 backdrop-blur-sm hover:bg-card/60'
              } hover:border-border hover:shadow-${variant === 'compact' ? 'md' : 'lg'}`
        }`}
        onClick={() => handleCardClick(result, actualIndex)}
      >
      {/* Header with actions */}
      <div className={`flex items-center justify-between px-${variant === 'compact' ? '4 md:px-4' : '5'} pt-${variant === 'compact' ? '4 md:pt-4' : '5'} pb-2`}>
        <div className={`flex items-center gap-1 text-${variant === 'compact' ? 'xs' : 'sm'} text-muted-foreground bg-muted/60 px-${variant === 'compact' ? '2' : '3'} py-1 rounded-full shrink-0`}>
          <Search className={`h-${variant === 'compact' ? '3' : '4'} w-${variant === 'compact' ? '3' : '4'}`} />
          {formatNumber(result.count)}{variant === 'full' ? ' results' : ''}
        </div>
        
        {/* Actions */}
        <div className={`flex items-center gap-1 opacity-100 ${variant === 'compact' ? 'md:opacity-0 md:group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
          <Button
            variant="ghost"
            size="icon"
            className={`h-${variant === 'compact' ? '7' : '8'} w-${variant === 'compact' ? '7' : '8'} text-muted-foreground hover:text-primary hover:bg-primary/10`}
            onClick={(e) => {
              e.stopPropagation();
              handleCopyQuery(result.query);
            }}
            title="Copy search query"
          >
            <Copy className={`h-${variant === 'compact' ? '3' : '3.5'} w-${variant === 'compact' ? '3' : '3.5'}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-${variant === 'compact' ? '7' : '8'} w-${variant === 'compact' ? '7' : '8'} text-muted-foreground hover:text-primary hover:bg-primary/10`}
            onClick={(e) => {
              e.stopPropagation();
              onSearchResults(result.query, result.field || currentSearchField, result.dateRange, result.sortBy, result.yearRange, result.filterType, actualIndex);
            }}
            disabled={loadingResultIndex !== null}
            title="View search results"
          >
            {loadingResultIndex === actualIndex ? (
              <Loader2 className={`h-${variant === 'compact' ? '3' : '3.5'} w-${variant === 'compact' ? '3' : '3.5'} animate-spin`} />
            ) : (
              <ExternalLink className={`h-${variant === 'compact' ? '3' : '3.5'} w-${variant === 'compact' ? '3' : '3.5'}`} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-${variant === 'compact' ? '7' : '8'} w-${variant === 'compact' ? '7' : '8'} text-muted-foreground hover:text-destructive hover:bg-destructive/10`}
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteItem(actualIndex, result.query);
            }}
            title="Remove from history"
          >
            <X className={`h-${variant === 'compact' ? '3' : '3.5'} w-${variant === 'compact' ? '3' : '3.5'}`} />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className={`px-${variant === 'compact' ? '4 md:px-4' : '5'} pb-${variant === 'compact' ? '4 md:pb-4' : '5'}`}>
        <div className="space-y-3">
          {/* Query - now has full width */}
          <div>
            <p className={`font-${variant === 'compact' ? 'medium' : 'semibold'} text-foreground ${variant === 'compact' ? 'text-sm md:text-base leading-relaxed' : 'text-lg leading-relaxed'} break-words`} title={result.query}>
              {result.query}
            </p>
          </div>
          
          {/* Metadata */}
          <div className={`flex items-center ${variant === 'compact' ? 'flex-wrap' : ''} gap-${variant === 'compact' ? '2' : '4'} text-${variant === 'compact' ? 'xs' : 'sm'}`}>
            <span className={`bg-primary/10 text-primary px-${variant === 'compact' ? '2' : '3'} py-1 rounded-${variant === 'compact' ? 'md' : 'lg'} font-medium`}>
              {variant === 'full' ? 'Field: ' : ''}{result.field}
            </span>
            {result.filterType === "year" && result.yearRange ? (
              <span className={`bg-blue-50 text-blue-700 px-${variant === 'compact' ? '2' : '3'} py-1 rounded-${variant === 'compact' ? 'md' : 'lg'}`}>
                📅 {result.yearRange[0]} - {result.yearRange[1]}
              </span>
            ) : result.dateRange?.from ? (
              <span className={`bg-blue-50 text-blue-700 px-${variant === 'compact' ? '2' : '3'} py-1 rounded-${variant === 'compact' ? 'md' : 'lg'}`}>
                📅 {format(result.dateRange.from, variant === 'compact' ? "MMM yyyy" : "MMM dd, yyyy")} - {result.dateRange.to ? format(result.dateRange.to, variant === 'compact' ? "MMM yyyy" : "MMM dd, yyyy") : "now"}
              </span>
            ) : variant === 'full' ? (
              <span className="bg-gray-50 text-gray-700 px-3 py-1 rounded-lg">
                📅 All dates
              </span>
            ) : null}
            {result.isCountryFilterActive && result.selectedRegions && result.selectedRegions.length > 0 && (
              <span className={`bg-emerald-50 text-emerald-700 px-${variant === 'compact' ? '2' : '3'} py-1 rounded-${variant === 'compact' ? 'md' : 'lg'} flex items-center gap-1`}>
                🌍 {(() => {
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
            {(result.isRatingFilterActive || result.onlyRatedPapers) && (
              <span className={`bg-amber-50 text-amber-700 px-${variant === 'compact' ? '2' : '3'} py-1 rounded-${variant === 'compact' ? 'md' : 'lg'} flex items-center gap-1`}>
                ⭐ {(() => {
                  const parts = [];
                  if (result.isRatingFilterActive && result.ratingRange) {
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
            {variant === 'full' && (
              <span className="bg-purple-50 text-purple-700 px-3 py-1 rounded-lg">
                Sort: {result.sortBy ? sortOptions.find(opt => opt.value === result.sortBy)?.label || result.sortBy : "Relevance"}
              </span>
            )}
          </div>
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
      <div className="flex items-center justify-between pt-6">
        <p className="text-sm text-muted-foreground">
          Showing {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, searchHistory.length)} of {searchHistory.length} searches
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="flex items-center gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
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
            Next
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