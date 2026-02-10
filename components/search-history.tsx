import React, { useState } from 'react';
import { parseAsInteger, useQueryState } from 'nuqs';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Trash2, Copy, Clock, ChevronLeft, ChevronRight, History, FileDown, FileUp, MoreVertical, BookmarkPlus, Check, ChevronDown, ChevronUp, Languages } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatNumber, formatTimeAgo, getIdColor } from "@/lib/format";
import { jsonToCSV, downloadAsFile, uploadFile, triggerFileUpload } from "@/lib/utils";
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
import { useSearchHistoryStore, useKeywordExpansionStore } from "@/lib/store";
import { DateRange } from "react-day-picker";

import { appToast, getErrorMessage } from "@/lib/toast";
import { showConfirmation } from "@/lib/confirmation";
import { CountryFlag } from "@/components/ui/country-flag";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { HistoryFilterBadges } from "@/components/ui/filter-display";
import { languageOptions } from "@/components/language-selector";
import { QueryText } from "@/components/ui/query-text";
import { getFieldLabel, getSortLabel, hasActiveFiltersFromResult } from "@/lib/filters";

interface SearchHistoryProps {
  onSearchResults: (query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], filterType?: "date" | "year", index?: number) => void;
  loadingResultIndex: number | null;
  currentSearchField: SearchField;
  compact?: boolean;
  currentSearchId?: string;
  hideHeader?: boolean;
  onQuerySelect?: (searchId: string, query: string) => void;
}

export function SearchHistory({ onSearchResults, loadingResultIndex, currentSearchField, compact = false, currentSearchId, hideHeader = false, onQuerySelect }: SearchHistoryProps) {
  const { searchHistory, removeSearchResult, clearSearchHistory, importSearchHistory } = useSearchHistoryStore();
  const [currentPage, setCurrentPage] = useQueryState('historyPage', parseAsInteger.withDefault(1));
  const { keywords, addKeyword } = useKeywordExpansionStore();
  const itemsPerPage = compact ? 5 : 10;
  
  // State for bookmark creation
  const [bookmarkingIndex, setBookmarkingIndex] = useState<number | null>(null);

  // Handlers
  // Card clicking removed - users should use action buttons instead

  const handleCopyQuery = async (query: string) => {
    try {
      await navigator.clipboard.writeText(query);
      appToast.clipboard.copied("Query");
    } catch (err) {
      const textArea = document.createElement('textarea');
      textArea.value = query;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      appToast.clipboard.copied("Query");
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
      appToast.entity.created("history export", `${data.length} search entries (JSON)`);
    } catch (error) {
      appToast.io.downloadFailed("JSON file");
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
      appToast.entity.created("history export", `${data.length} search entries (CSV)`);
    } catch (error) {
      appToast.io.downloadFailed("CSV file");
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload('.json');
      const data = await uploadFile(file);
      const importedCount = importSearchHistory(data);
      appToast.io.importResult("search entries", importedCount);
    } catch (error) {
      appToast.io.uploadFailed("JSON file", getErrorMessage(error, "Failed to upload JSON file."));
    }
  };

  const handleUploadCSV = async () => {
    try {
      const file = await triggerFileUpload('.csv');
      const data = await uploadFile(file);
      const importedCount = importSearchHistory(data);
      appToast.io.importResult("search entries", importedCount);
    } catch (error) {
      appToast.io.uploadFailed("CSV file", getErrorMessage(error, "Failed to upload CSV file."));
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
        appToast.entity.deleted("search entry");
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
        appToast.entity.cleared("search history");
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
  };

  const handleBookmarkCancel = () => {
    setBookmarkingIndex(null);
  };



  // Query-specific handlers (now handled locally in QueryHistoryDisplay)

  const handleQueryDelete = (searchId: string, queryIndex: number) => {
    const { getSearchResult, updateSearchResult } = useSearchHistoryStore.getState();
    const searchResult = getSearchResult(searchId);
    
    if (!searchResult || !searchResult.queryHistory) return;
    
    // Remove the query entry from history
    const updatedQueryHistory = searchResult.queryHistory.filter((_, index) => index !== queryIndex);
    
    // Update the search result
    updateSearchResult(searchId, {
      queryHistory: updatedQueryHistory,
      updatedAt: new Date().toISOString()
    });
    
    appToast.entity.deleted("query entry");
  };

  // Reusable Bookmark Form Component
  function BookmarkForm({
    query,
    onSubmit,
    onCancel,
    variant = 'full'
  }: {
    query: string;
    onSubmit: (bookmarkName: string) => void;
    onCancel: () => void;
    variant?: 'full' | 'compact';
  }) {
    const [localBookmarkName, setLocalBookmarkName] = useState('');
    const { addKeyword, keywords } = useKeywordExpansionStore();

    const validateKeyword = (keyword: string): string | null => {
      if (!keyword.trim()) return 'Bookmark name is required';
      if (!/^[a-zA-Z0-9-]+$/.test(keyword.trim())) return 'Only letters, numbers, and dashes allowed';
      if (keyword.includes(' ')) return 'Bookmark name cannot contain spaces';
      if (keywords[keyword]) return `Bookmark "${keyword}" already exists`;
      return null;
    };

    const handleSubmit = () => {
      const validationError = validateKeyword(localBookmarkName);
    if (validationError) {
      appToast.validation.failed(validationError);
      return;
    }

    // Expand the query before saving it as a bookmark
    const { expandedQuery } = validateAndExpandKeywordsSilently(query);
    
      addKeyword(localBookmarkName.trim(), expandedQuery);
      appToast.entity.created("bookmark", localBookmarkName);
      onSubmit(localBookmarkName);
      setLocalBookmarkName('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    };

    return (
      <div className={cn(
        "space-y-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded",
        variant === 'full' ? 'space-y-3 p-3 rounded-lg' : 'p-2'
      )}>
        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
          <BookmarkPlus className={cn(variant === 'full' ? 'h-4 w-4' : 'h-3 w-3')} />
          <span className={cn(
            "font-medium",
            variant === 'full' ? 'text-sm' : 'text-xs'
          )}>
            {variant === 'full' ? 'Save as Bookmark' : 'Save Query as Bookmark'}
          </span>
        </div>
        
        {variant === 'full' && (
          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
            Bookmarks let you create shortcuts for complex search queries. Use the format "bookmark..." in your search to expand them automatically.
          </p>
        )}
        
        <div className={cn(
          "text-amber-700 dark:text-amber-300 font-mono break-all border border-amber-200 dark:border-amber-700 rounded",
          variant === 'full' 
            ? 'text-xs bg-amber-100 dark:bg-amber-900/50 p-2' 
            : 'text-xs p-1.5 bg-background'
        )}>
          "{validateAndExpandKeywordsSilently(query).expandedQuery}"
        </div>
        
        <div className={cn(variant === 'full' ? 'space-y-2' : 'space-y-1')}>
          <Input
            placeholder={variant === 'full' ? "Enter bookmark name (e.g., ai-research)" : "Enter bookmark name (e.g., ml-research)"}
            value={localBookmarkName}
            onChange={(e) => setLocalBookmarkName(e.target.value)}
            className={cn(
              "bg-background border-amber-200 dark:border-amber-800 focus:border-amber-400 dark:focus:border-amber-600",
              variant === 'full' ? 'text-sm' : 'text-xs h-7'
            )}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <p className={cn(
            "text-amber-600 dark:text-amber-400",
            variant === 'full' ? 'text-xs' : 'text-xs'
          )}>
            Letters, numbers, and dashes only. No spaces allowed.
          </p>
          <div className={cn(variant === 'full' ? 'flex gap-2' : 'flex gap-1')}>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!localBookmarkName.trim()}
              className={cn(
                "bg-amber-600 hover:bg-amber-700 text-white",
                variant === 'compact' && 'h-6 text-xs px-2'
              )}
            >
              <Check className={cn(
                "mr-1",
                variant === 'full' ? 'h-3 w-3' : 'h-2 w-2'
              )} />
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancel}
              className={cn(
                "text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50",
                variant === 'compact' && 'h-6 text-xs px-2'
              )}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Reusable Action Buttons Component
function ActionButtons({
  query,
  searchId,
  index,
  variant = 'compact',
  isLoading = false,
  canDelete = true,
  onCopy,
  onBookmark,
  onSearch,
  onDelete,
  className
}: {
  query: string;
  searchId?: string;
  index?: number;
  variant?: 'compact' | 'full';
  isLoading?: boolean;
  canDelete?: boolean;
  onCopy: (query: string) => void;
  onBookmark: (index: number) => void;
  onSearch: (query: string) => void;
  onDelete?: (index: number, query: string) => void;
  className?: string;
}) {
    return (
      <div className={cn(
        "flex items-center gap-1 transition-opacity duration-200",
        className
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
            onCopy(query);
          }}
          title="Copy query"
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
          if (index !== undefined) onBookmark(index);
        }}
          disabled={!query.trim()}
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
            onSearch(query);
          }}
          disabled={isLoading}
          title="Search with this query"
        >
          {isLoading ? (
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
        
        {canDelete && onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
              variant === 'compact' ? 'h-7 w-7' : 'h-8 w-8'
            )}
                      onClick={(e) => {
            e.stopPropagation();
            if (index !== undefined) onDelete(index, query);
          }}
            title="Remove from history"
          >
            <Trash2 className={cn(
              variant === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5'
            )} />
          </Button>
        )}
      </div>
    );
  }

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
    const idColor = getIdColor(result.id);
    const [isQueryHistoryExpanded, setIsQueryHistoryExpanded] = useState(false);
    const queryHistoryCount = result.queryHistory?.length || 0;
    
    return (
      <div
        key={actualIndex}
        className={cn(
          "group relative overflow-hidden rounded-xl border transition-all duration-200",
          isCurrentSearch 
            ? 'border-primary/50 bg-primary/5 shadow-md ring-1 ring-primary/20' 
            : cn(
                "border-border/50 hover:border-border",
                variant === 'compact' 
                  ? 'bg-card/50 backdrop-blur-sm hover:bg-card/80 hover:shadow-md' 
                  : 'bg-card/30 backdrop-blur-sm hover:bg-card/60 hover:shadow-lg'
              )
        )}
      >
        <div className={cn(variant === 'compact' ? 'p-4' : 'p-5', !isQueryHistoryExpanded && "pb-2")}>
          
          {/* === HERO SECTION: Result Count + Info Rows === */}
          <div className={cn(
            "flex gap-3 items-stretch",
            variant === 'compact' ? 'flex-col sm:flex-row' : 'flex-row'
          )}>
            
            {/* Result Count Block - stretches to fill height */}
            <div 
              className={cn(
                "flex-shrink-0 rounded-lg flex flex-col items-center justify-center",
                variant === 'compact' 
                  ? 'px-3 py-2 min-w-[72px]' 
                  : 'px-4 py-2 min-w-[88px]'
              )}
              style={{ 
                backgroundColor: idColor.bg,
                border: `1px solid ${idColor.border}` 
              }}
            >
              <div 
                className={cn(
                  "font-bold leading-none",
                  variant === 'compact' ? 'text-lg' : 'text-xl'
                )}
                style={{ color: idColor.text }}
              >
                {formatNumber(result.count)}
              </div>
              <div 
                className="text-[10px] opacity-70 leading-none mt-0.5"
                style={{ color: idColor.text }}
              >
                results
              </div>
            </div>
            
            {/* Info Rows - tight line height, equal gaps */}
            <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
              {/* Row 1: Query Text */}
              <p className={cn(
                "break-words leading-tight",
                variant === 'compact' ? 'text-sm font-medium' : 'text-base font-semibold'
              )}>
                <QueryText query={result.query} />
              </p>
              
              {/* Row 2: Research Question (if available) */}
              {result.questionHistory?.length > 0 && (
                <p className="text-xs text-muted-foreground leading-tight truncate" title={result.questionHistory[result.questionHistory.length - 1]?.question}>
                  <span className="opacity-60">Q:</span> {result.questionHistory[result.questionHistory.length - 1]?.question}
                </p>
              )}
              
              {/* Row 3: Metadata */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground leading-tight">
                <span>{formatTimeAgo(result.createdAt)}</span>
                <span className="opacity-50">•</span>
                <span>{getFieldLabel(result.field)}</span>
                {result.sortBy && getSortLabel(result.sortBy) && (
                  <>
                    <span className="opacity-50">•</span>
                    <span>{getSortLabel(result.sortBy)}</span>
                  </>
                )}
              </div>
              
              {/* Row 4: Language */}
              <div className="flex items-center gap-1.5 text-xs leading-tight">
                {result.language ? (() => {
                  const lang = languageOptions.find(l => l.code === result.language);
                  return lang ? (
                    <>
                      <img 
                        src={lang.flagUrl}
                        alt={lang.name}
                        className="w-4 h-3 rounded-sm object-cover shadow-sm border border-border/30"
                      />
                      <span className="text-foreground">{lang.name}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Languages className="h-3 w-3" />
                      <span className="italic">Language not set</span>
                    </span>
                  );
                })() : (
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Languages className="h-3 w-3" />
                    <span className="italic">Language not set</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          
          {/* === BOOKMARK FORM (inline, when active) === */}
          {bookmarkingIndex === actualIndex && (
            <div className="mt-4">
              <BookmarkForm
                query={result.query}
                onSubmit={() => setBookmarkingIndex(null)}
                onCancel={handleBookmarkCancel}
                variant="full"
              />
            </div>
          )}
          
          {/* === FOOTER: Filters + History + Actions (single row) === */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
            {/* Left: Filters (scrollable) */}
            <div className="flex-1 overflow-x-auto scrollbar-hover">
              {hasActiveFiltersFromResult(result) && (
                <HistoryFilterBadges result={result} variant={variant} />
              )}
            </div>
            
            {/* Right: History Toggle + Action Buttons */}
            <div className="flex items-center gap-1 shrink-0">
              {/* History Toggle - only show if count > 1 */}
              {queryHistoryCount > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "text-muted-foreground hover:text-foreground gap-1",
                    variant === 'compact' ? 'h-7 px-2' : 'h-8 px-2'
                  )}
                  onClick={() => setIsQueryHistoryExpanded(!isQueryHistoryExpanded)}
                  title="Query History"
                >
                  <History className={cn(variant === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
                  <span className={cn(variant === 'compact' ? 'text-xs' : 'text-xs')}>{queryHistoryCount}</span>
                </Button>
              )}
              
              {/* Action Buttons */}
              <ActionButtons
                query={result.query}
                searchId={result.id}
                index={actualIndex}
                variant={variant}
                isLoading={loadingResultIndex === actualIndex}
                canDelete={true}
                onCopy={handleCopyQuery}
                onBookmark={handleBookmarkClick}
                onSearch={(query) => onSearchResults(query, result.field || currentSearchField, result.dateRange, result.sortBy, result.yearRange, result.filterType, actualIndex)}
                onDelete={handleDeleteItem}
              />
            </div>
          </div>
          
          {/* === EXPANDED QUERY HISTORY === */}
          {isQueryHistoryExpanded && queryHistoryCount > 1 && (
            <div className="mt-3">
              <QueryHistoryDisplay 
                queryHistory={result.queryHistory} 
                currentQuery={result.query}
                searchId={result.id}
                onQuerySelect={onQuerySelect}
                onCopyQuery={handleCopyQuery}
                onDeleteQueryEntry={handleQueryDelete}
                initiallyExpanded={true}
              />
            </div>
          )}
          
        </div>
      </div>
    );
  };

// Component to display query history for a search item
function QueryHistoryDisplay({ 
  queryHistory, 
  currentQuery, 
  searchId, 
  onQuerySelect,
  onCopyQuery,
  onDeleteQueryEntry,
  initiallyExpanded = false
}: { 
  queryHistory: any[], 
  currentQuery: string,
  searchId?: string,
  onQuerySelect?: (searchId: string, query: string) => void,
  onCopyQuery?: (query: string) => void,
  onDeleteQueryEntry?: (searchId: string, queryIndex: number) => void,
  initiallyExpanded?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const [bookmarkingQueryIndex, setBookmarkingQueryIndex] = useState<number | null>(null);
  
  if (!queryHistory || queryHistory.length <= 1) {
    return null;
  }

  const handleQueryClick = (query: string) => {
    if (onQuerySelect && searchId && query !== currentQuery) {
      onQuerySelect(searchId, query);
    }
  };

  const handleQueryBookmarkClick = (queryIndex: number) => {
    setBookmarkingQueryIndex(queryIndex);
  };

  const handleQueryBookmarkCancel = () => {
    setBookmarkingQueryIndex(null);
  };

  // If controlled by parent (initiallyExpanded), skip the toggle and show content directly
  if (initiallyExpanded) {
    return (
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {queryHistory.slice().reverse().map((entry, index) => {
          const isMostRecent = index === 0;
          const originalIndex = queryHistory.length - 1 - index;
          const date = new Date(entry.timestamp);
          const timeAgo = formatDistanceToNow(date, { addSuffix: true });
          const isClickable = onQuerySelect && searchId && entry.query !== currentQuery;
          const canDelete = !isMostRecent;
          
          return (
            <div
              key={index}
              className={cn(
                "rounded-lg border overflow-hidden",
                isMostRecent 
                  ? "bg-primary/5 border-primary/30" 
                  : "bg-card border-border/60"
              )}
            >
              {/* Current indicator */}
              {isMostRecent && (
                <div className="h-1 bg-primary" />
              )}
              
              {bookmarkingQueryIndex === originalIndex ? (
                <div className="p-3">
                  <BookmarkForm
                    query={entry.query}
                    onSubmit={() => setBookmarkingQueryIndex(null)}
                    onCancel={handleQueryBookmarkCancel}
                    variant="compact"
                  />
                </div>
              ) : (
                <div>
                  {/* Main content */}
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <Search className={cn(
                        "h-4 w-4 mt-0.5 flex-shrink-0",
                        isMostRecent ? "text-primary" : "text-muted-foreground"
                      )} />
                      
                      <div className="flex-1 min-w-0">
                        <div className="mb-1">
                          <p className={cn(
                            "text-sm font-mono break-all",
                            isMostRecent ? "text-primary font-medium" : "text-foreground"
                          )}>
                            {entry.query}
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{timeAgo}</span>
                          <span>•</span>
                          <span>{date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      
                      {/* Desktop action buttons */}
                      <div className="hidden md:flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onCopyQuery?.(entry.query)}
                          title="Copy query"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleQueryBookmarkClick(originalIndex)}
                          title="Save as bookmark"
                        >
                          <BookmarkPlus className="h-3 w-3" />
                        </Button>
                        
                        {isClickable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleQueryClick(entry.query)}
                            title="Switch to this query"
                          >
                            <Search className="h-3 w-3" />
                          </Button>
                        )}
                        
                        {canDelete && onDeleteQueryEntry && searchId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => onDeleteQueryEntry(searchId, originalIndex)}
                            title="Remove from history"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Mobile action buttons */}
                  <div className="md:hidden border-t bg-muted/30 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => onCopyQuery?.(entry.query)}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Copy
                        </Button>
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => handleQueryBookmarkClick(originalIndex)}
                        >
                          <BookmarkPlus className="h-3 w-3 mr-1" />
                          Save
                        </Button>
                      </div>
                      
                      <div className="flex gap-2">
                        {isClickable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => handleQueryClick(entry.query)}
                          >
                            <Search className="h-3 w-3 mr-1" />
                            Switch
                          </Button>
                        )}
                        
                        {canDelete && onDeleteQueryEntry && searchId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => onDeleteQueryEntry(searchId, originalIndex)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mt-2 border-t pt-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Query History ({queryHistory.length})
      </button>
      
      {isExpanded && (
        <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
          {queryHistory.slice().reverse().map((entry, index) => {
            const isMostRecent = index === 0;
            const originalIndex = queryHistory.length - 1 - index;
            const date = new Date(entry.timestamp);
            const timeAgo = formatDistanceToNow(date, { addSuffix: true });
            const isClickable = onQuerySelect && searchId && entry.query !== currentQuery;
            const canDelete = !isMostRecent;
            
            return (
              <div
                key={index}
            className={cn(
                  "rounded-lg border overflow-hidden",
                  isMostRecent 
                    ? "bg-primary/5 border-primary/30" 
                    : "bg-card border-border/60"
                )}
              >
                {/* Current indicator */}
                {isMostRecent && (
                  <div className="h-1 bg-primary" />
                )}
                
                {bookmarkingQueryIndex === originalIndex ? (
                  <div className="p-3">
                    <BookmarkForm
                      query={entry.query}
                      onSubmit={() => setBookmarkingQueryIndex(null)}
                      onCancel={handleQueryBookmarkCancel}
                      variant="compact"
                    />
                  </div>
                ) : (
                  <div>
                    {/* Main content */}
                    <div className="p-3">
                      <div className="flex items-start gap-2">
                        <Search className={cn(
                          "h-4 w-4 mt-0.5 flex-shrink-0",
                          isMostRecent ? "text-primary" : "text-muted-foreground"
                        )} />
                        
                        <div className="flex-1 min-w-0">
                          <div className="mb-1">
                            <p className={cn(
                              "text-sm font-mono break-all",
                              isMostRecent ? "text-primary font-medium" : "text-foreground"
                            )}>
                              {entry.query}
                            </p>
                          </div>
                          
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>{timeAgo}</span>
                            <span>•</span>
                            <span>{date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                        
                        {/* Desktop action buttons */}
                        <div className="hidden md:flex items-center gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onCopyQuery?.(entry.query)}
                            title="Copy query"
                          >
                            <Copy className="h-3 w-3" />
          </Button>
                          
          <Button
            variant="ghost"
            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleQueryBookmarkClick(originalIndex)}
            title="Save as bookmark"
          >
                            <BookmarkPlus className="h-3 w-3" />
          </Button>
                          
                          {isClickable && (
          <Button
            variant="ghost"
            size="icon"
                              className="h-7 w-7"
                              onClick={() => handleQueryClick(entry.query)}
                              title="Switch to this query"
                            >
                              <Search className="h-3 w-3" />
          </Button>
                          )}
                          
                          {canDelete && onDeleteQueryEntry && searchId && (
          <Button
            variant="ghost"
            size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => onDeleteQueryEntry(searchId, originalIndex)}
            title="Remove from history"
          >
                              <Trash2 className="h-3 w-3" />
          </Button>
                          )}
        </div>
      </div>
              </div>
                    
                    {/* Mobile action buttons */}
                    <div className="md:hidden border-t bg-muted/30 px-3 py-2">
                      <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Button
                            variant="ghost"
                    size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => onCopyQuery?.(entry.query)}
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Copy
                          </Button>
                          
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => handleQueryBookmarkClick(originalIndex)}
                          >
                            <BookmarkPlus className="h-3 w-3 mr-1" />
                    Save
                  </Button>
                        </div>
                        
                        <div className="flex gap-2">
                          {isClickable && (
                  <Button
                              variant="ghost"
                    size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() => handleQueryClick(entry.query)}
                            >
                              <Search className="h-3 w-3 mr-1" />
                              Switch
                            </Button>
                          )}
                          
                          {canDelete && onDeleteQueryEntry && searchId && (
                            <Button
                    variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                              onClick={() => onDeleteQueryEntry(searchId, originalIndex)}
                  >
                              <Trash2 className="h-3 w-3 mr-1" />
                              Delete
                  </Button>
                          )}
                </div>
              </div>
            </div>
            </div>
          )}
        </div>
            );
          })}
      </div>
      )}
    </div>
  );
}

  const Pagination = ({ variant = 'compact' }: { variant?: 'compact' | 'full' }) => {
  const { searchHistory } = useSearchHistoryStore();
  const [currentPage, setCurrentPage] = useQueryState('historyPage', parseAsInteger.withDefault(1));
  const itemsPerPage = variant === 'compact' ? 5 : 10;
  
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
        <div className="flex items-center justify-between gap-3">
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
