import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Loader2, X, Trash2, ExternalLink, Download, Copy, Clock, ChevronLeft, ChevronRight, History, Upload, FileDown, FileUp, MoreVertical } from "lucide-react";
import { format } from "date-fns";
import { jsonToCSV, downloadAsFile, SearchField, uploadFile, triggerFileUpload } from "@/lib/utils";
import { sortOptions } from "@/lib/constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useSearchHistoryStore } from "@/lib/store";
import { DateRange } from "react-day-picker";
import { useIsMobile } from "@/lib/hooks";
import { toast } from "sonner";
import { showConfirmation } from "@/lib/confirmation";

interface SearchHistoryProps {
  onSearchResults: (query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], filterType?: "date" | "year", index?: number) => void;
  loadingResultIndex: number | null;
  currentSearchField: SearchField;
  compact?: boolean;
}

export function SearchHistory({ onSearchResults, loadingResultIndex, currentSearchField, compact = false }: SearchHistoryProps) {
  const { searchHistory, removeSearchResult, clearSearchHistory, importSearchHistory } = useSearchHistoryStore();
  const [currentPage, setCurrentPage] = useState(1);
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
      const data = searchHistory.map(item => ({
        search_query: item.query,
        count: item.count,
        field: item.field,
      }));
      downloadAsFile(JSON.stringify(data, null, 2), 'search_history.json', 'json');
      toast.success(`Downloaded ${data.length} search entries as JSON`);
    } catch (error) {
      toast.error("Failed to download JSON file");
    }
  };

  const handleDownloadCSV = async () => {
    try {
      const data = searchHistory.map(item => ({
        search_query: item.query,
        count: item.count,
        field: item.field,
      }));
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
  }) => (
    <div
      key={actualIndex}
      className={`group relative overflow-hidden rounded-xl border border-border/50 ${
        variant === 'compact' 
          ? 'bg-card/50 backdrop-blur-sm hover:bg-card/80' 
          : 'bg-card/30 backdrop-blur-sm hover:bg-card/60'
      } hover:border-border transition-all duration-200 hover:shadow-${variant === 'compact' ? 'md' : 'lg'} cursor-pointer md:cursor-default`}
      onClick={() => handleCardClick(result, actualIndex)}
    >
      <div className={variant === 'compact' ? 'p-3 md:p-4' : 'p-5'}>
        <div className={`flex items-start justify-between gap-${variant === 'compact' ? '3' : '4'}`}>
          <div className="flex-1 min-w-0 space-y-2">
            {/* Query and count */}
            <div className={`flex items-${variant === 'compact' ? 'start flex-col sm:flex-row sm:items-' : ''}center gap-${variant === 'compact' ? '2' : '3'}`}>
              <p className={`font-${variant === 'compact' ? 'medium' : 'semibold'} text-foreground ${variant === 'compact' ? 'break-words text-sm md:text-base' : 'truncate text-lg'}`} title={result.query}>
                {result.query}
              </p>
              <div className={`flex items-center gap-1 text-${variant === 'compact' ? 'xs' : 'sm'} text-muted-foreground bg-muted/60 px-${variant === 'compact' ? '2' : '3'} py-1 rounded-full shrink-0`}>
                <Search className={`h-${variant === 'compact' ? '3' : '4'} w-${variant === 'compact' ? '3' : '4'}`} />
                {formatNumber(result.count)}{variant === 'full' ? ' results' : ''}
              </div>
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
              {variant === 'full' && (
                <span className="bg-purple-50 text-purple-700 px-3 py-1 rounded-lg">
                  Sort: {result.sortBy ? sortOptions.find(opt => opt.value === result.sortBy)?.label || result.sortBy : "Relevance"}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className={`flex items-center gap-1 opacity-100 ${variant === 'compact' ? 'md:opacity-0 md:group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
            <Button
              variant="ghost"
              size="icon"
              className={`h-${variant === 'compact' ? '8' : '9'} w-${variant === 'compact' ? '8' : '9'} text-muted-foreground hover:text-primary hover:bg-primary/10`}
              onClick={(e) => {
                e.stopPropagation();
                handleCopyQuery(result.query);
              }}
              title="Copy search query"
            >
              <Copy className={`h-${variant === 'compact' ? '3' : '4'} w-${variant === 'compact' ? '3' : '4'}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-${variant === 'compact' ? '8' : '9'} w-${variant === 'compact' ? '8' : '9'} text-muted-foreground hover:text-primary hover:bg-primary/10`}
              onClick={(e) => {
                e.stopPropagation();
                onSearchResults(result.query, result.field || currentSearchField, result.dateRange, result.sortBy, result.yearRange, result.filterType, actualIndex);
              }}
              disabled={loadingResultIndex !== null}
              title="View search results"
            >
              {loadingResultIndex === actualIndex ? (
                <Loader2 className={`h-${variant === 'compact' ? '3' : '4'} w-${variant === 'compact' ? '3' : '4'} animate-spin`} />
              ) : (
                <ExternalLink className={`h-${variant === 'compact' ? '3' : '4'} w-${variant === 'compact' ? '3' : '4'}`} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-${variant === 'compact' ? '8' : '9'} w-${variant === 'compact' ? '8' : '9'} text-muted-foreground hover:text-destructive hover:bg-destructive/10`}
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteItem(actualIndex, result.query);
              }}
              title="Remove from history"
            >
              <X className={`h-${variant === 'compact' ? '3' : '4'} w-${variant === 'compact' ? '3' : '4'}`} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

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