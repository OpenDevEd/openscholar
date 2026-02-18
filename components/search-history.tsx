import React, { useState } from 'react';
import { parseAsInteger, useQueryState } from 'nuqs';
import { useTranslations, useLocale, useFormatter, useNow } from 'next-intl';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Trash2, Copy, Clock, ChevronLeft, ChevronRight, History, FileDown, FileUp, MoreVertical, BookmarkPlus, Check, ChevronDown, ChevronUp, Languages } from "lucide-react";
import { getIdColor } from "@/lib/format";
import { jsonToCSV, downloadAsFile, uploadFile, triggerFileUpload } from "@/lib/utils";
import type { SearchField } from "@/lib/types";
import { COUNTRIES } from "@/lib/constants";
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

import { useAppToast, getErrorMessage } from "@/lib/toast";
import { showConfirmation } from "@/lib/confirmation";
import { CountryFlag } from "@/components/ui/country-flag";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { HistoryFilterBadges } from "@/components/ui/filter-display";
import { languageOptions } from "@/components/language-selector";
import { QueryText } from "@/components/ui/query-text";
import {
  getFieldLabel,
  getSortLabel,
  hasActiveFiltersFromResult,
  type FilterT,
} from "@/lib/filters";
import { SearchHistoryBookmarkForm } from "@/components/search-history-bookmark-form";
import { SearchHistoryActionButtons } from "@/components/search-history-action-buttons";
import { SearchHistoryActionDropdown } from "@/components/search-history-action-dropdown";
import { SearchHistoryClearAllButton } from "@/components/search-history-clear-all-button";
import { SearchHistoryHeaderSection } from "@/components/search-history-header-section";
import { SearchHistoryHeaderButtons } from "@/components/search-history-header-buttons";
import { SearchHistoryEmptyState } from "@/components/search-history-empty-state";
import { SearchHistoryItem } from "@/components/search-history-item";
import { SearchHistoryPagination } from "@/components/search-history-pagination";

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
  const toast = useAppToast();
  const t = useTranslations();
  const tc = useTranslations("common");
  const ta = useTranslations('accessibility');
  const tl = useTranslations('languages');
  const tp = useTranslations('paperCard');
  const tToast = useTranslations('toast');
  const tFilters = useTranslations('searchFilters');
  const locale = useLocale();
  const format = useFormatter();
  const now = useNow();
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
      toast.clipboard.copied(tToast("entityQuery"));
    } catch (err) {
      const textArea = document.createElement('textarea');
      textArea.value = query;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      toast.clipboard.copied(tToast("entityQuery"));
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
      toast.entity.created(tToast("entityHistoryExport"), tToast("historyExportLabelJson", { count: data.length }));
    } catch (error) {
      toast.io.downloadFailed(tToast("entityJsonFile"));
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
      toast.entity.created(tToast("entityHistoryExport"), tToast("historyExportLabelCsv", { count: data.length }));
    } catch (error) {
      toast.io.downloadFailed(tToast("entityCsvFile"));
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload('.json');
      const data = await uploadFile(file);
      const importedCount = importSearchHistory(data);
      toast.io.importResult(tToast("entitySearchEntries"), importedCount);
    } catch (error) {
      toast.io.uploadFailed(tToast("entityJsonFile"), getErrorMessage(error, tToast("uploadJsonFileFailed")));
    }
  };

  const handleUploadCSV = async () => {
    try {
      const file = await triggerFileUpload('.csv');
      const data = await uploadFile(file);
      const importedCount = importSearchHistory(data);
      toast.io.importResult(tToast("entitySearchEntries"), importedCount);
    } catch (error) {
      toast.io.uploadFailed(tToast("entityCsvFile"), getErrorMessage(error, tToast("uploadCsvFileFailed")));
    }
  };

  const handleDeleteItem = (index: number, query: string) => {
    const truncatedQuery = query.length > 50 ? query.substring(0, 50) + '...' : query;
    showConfirmation({
      title: t('historyPage.deleteSearchEntry'),
      message: t('confirmations.deleteSearchConfirm', { query: truncatedQuery }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      onConfirm: () => {
        removeSearchResult(index);
        toast.entity.deleted(tToast("entitySearchEntry"));
      }
    });
  };

  const handleClearAll = () => {
    showConfirmation({
      title: t('historyPage.clearAllHistory'),
      message: t('confirmations.deleteAllHistory', { count: searchHistory.length }),
      confirmText: t('common.clearAll'),
      cancelText: t('common.cancel'),
      onConfirm: () => {
        clearSearchHistory();
        toast.entity.cleared(tToast("entitySearchHistory"));
      }
    });
  };

  const validateKeyword = (keyword: string): string | null => {
    if (!keyword.trim()) return t('validation.bookmarkNameEmpty');
    if (!/^[a-zA-Z0-9-]+$/.test(keyword)) return t('validation.bookmarkNameFormat');
    if (keyword.includes(' ')) return t('validation.bookmarkNameNoSpaces');
    if (keywords[keyword]) return t('validation.bookmarkNameExists', { name: keyword });
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
    
    toast.entity.deleted(tToast("entityQueryEntry"));
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
          <SearchHistoryHeaderSection title={t('historyPage.recentSearches')} count={searchHistory.length} variant="compact" />
          <SearchHistoryHeaderButtons
            variant="compact"
            onDownloadJSON={handleDownloadJSON}
            onDownloadCSV={handleDownloadCSV}
            onUploadJSON={handleUploadJSON}
            onUploadCSV={handleUploadCSV}
            onClearAll={handleClearAll}
            isClearDisabled={searchHistory.length === 0}
          />
        </div>
        
        {searchHistory.length === 0 ? (
          <SearchHistoryEmptyState />
        ) : (
          <>
            <div className="space-y-3">
              {displayHistory.map((result, index) => {
                const actualIndex = startIndex + index;
                return (
                  <SearchHistoryItem
                    key={actualIndex}
                    result={result}
                    index={index}
                    actualIndex={actualIndex}
                    variant="compact"
                    currentSearchId={currentSearchId}
                    currentSearchField={currentSearchField}
                    bookmarkingIndex={bookmarkingIndex}
                    loadingResultIndex={loadingResultIndex}
                    onBookmarkClick={handleBookmarkClick}
                    onBookmarkCancel={handleBookmarkCancel}
                    onCopyQuery={handleCopyQuery}
                    onDeleteItem={handleDeleteItem}
                    onQueryDelete={handleQueryDelete}
                    onSearchResults={onSearchResults}
                    onQuerySelect={onQuerySelect}
                  />
                );
              })}
            </div>
            <SearchHistoryPagination variant="compact" />
          </>
        )}
      </div>
    );
  }

  if (hideHeader) {
    return (
      <div className="w-full space-y-4">
        {searchHistory.length === 0 ? (
          <SearchHistoryEmptyState />
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
                  <SearchHistoryHeaderButtons
                    variant="compact"
                    onDownloadJSON={handleDownloadJSON}
                    onDownloadCSV={handleDownloadCSV}
                    onUploadJSON={handleUploadJSON}
                    onUploadCSV={handleUploadCSV}
                    onClearAll={handleClearAll}
                    isClearDisabled={searchHistory.length === 0}
                  />
                </div>
              </div>
              
              {/* Desktop actions */}
              <div className="hidden sm:flex">
                <SearchHistoryHeaderButtons
                  variant="compact"
                  onDownloadJSON={handleDownloadJSON}
                  onDownloadCSV={handleDownloadCSV}
                  onUploadJSON={handleUploadJSON}
                  onUploadCSV={handleUploadCSV}
                  onClearAll={handleClearAll}
                  isClearDisabled={searchHistory.length === 0}
                />
              </div>
            </div>
            
            <div className="space-y-3">
              {displayHistory.map((result, index) => {
                const actualIndex = startIndex + index;
                return (
                  <SearchHistoryItem
                    key={actualIndex}
                    result={result}
                    index={index}
                    actualIndex={actualIndex}
                    variant="full"
                    currentSearchId={currentSearchId}
                    currentSearchField={currentSearchField}
                    bookmarkingIndex={bookmarkingIndex}
                    loadingResultIndex={loadingResultIndex}
                    onBookmarkClick={handleBookmarkClick}
                    onBookmarkCancel={handleBookmarkCancel}
                    onCopyQuery={handleCopyQuery}
                    onDeleteItem={handleDeleteItem}
                    onQueryDelete={handleQueryDelete}
                    onSearchResults={onSearchResults}
                    onQuerySelect={onQuerySelect}
                  />
                );
              })}
            </div>
            <SearchHistoryPagination variant="full" />
          </>
        )}
      </div>
    );
  }

  return (
    <Card suppressHydrationWarning className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <SearchHistoryHeaderSection title={t('common.searchHistory')} count={searchHistory.length} variant="full" />
          <SearchHistoryHeaderButtons
          variant="full"
          onDownloadJSON={handleDownloadJSON}
          onDownloadCSV={handleDownloadCSV}
          onUploadJSON={handleUploadJSON}
          onUploadCSV={handleUploadCSV}
          onClearAll={handleClearAll}
          isClearDisabled={searchHistory.length === 0}
        />
        </div>
      </CardHeader>
      <CardContent>
        {searchHistory.length === 0 ? (
          <SearchHistoryEmptyState />
        ) : (
          <>
            <div className="space-y-3">
              {displayHistory.map((result, index) => {
                const actualIndex = startIndex + index;
                return (
                  <SearchHistoryItem
                    key={actualIndex}
                    result={result}
                    index={index}
                    actualIndex={actualIndex}
                    variant="full"
                    currentSearchId={currentSearchId}
                    currentSearchField={currentSearchField}
                    bookmarkingIndex={bookmarkingIndex}
                    loadingResultIndex={loadingResultIndex}
                    onBookmarkClick={handleBookmarkClick}
                    onBookmarkCancel={handleBookmarkCancel}
                    onCopyQuery={handleCopyQuery}
                    onDeleteItem={handleDeleteItem}
                    onQueryDelete={handleQueryDelete}
                    onSearchResults={onSearchResults}
                    onQuerySelect={onQuerySelect}
                  />
                );
              })}
            </div>
            <SearchHistoryPagination variant="full" />
          </>
        )}
      </CardContent>
    </Card>
  );
} 
