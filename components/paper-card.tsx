"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { workToCoins } from "@/lib/utils";
import { useResultsStore, useUIStore, useSearchHistoryStore } from "@/lib/store";
import { useCurrentSearchFormState, useUpdateSearchFilter, useIsMobile } from "@/lib/hooks";
import { openFocusMode } from "@/lib/search-actions";
import { RatingSelector } from "./rating-selector";
import { PaperMetadata } from "./paper-metadata";
import { DownloadMenu } from "./download-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Download, 
  ExternalLink, 
  Calendar, 
  BookOpen, 
  Users, 
  Quote,
  Star,
  StarOff,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Network,
  Award,
  Target,
  Layers,
  Building,
  Leaf,
  BarChart3,
  FileText
} from "lucide-react";


interface PaperCardProps {
  result: any;
  resultIndex: number;
  onDownloadItem: (item: any, format: 'json' | 'csv') => void;
  onDownloadEssentialItem: (item: any, format: 'json' | 'csv') => void;
}

export function PaperCard({ 
  result, 
  resultIndex,
  onDownloadItem, 
  onDownloadEssentialItem
}: PaperCardProps) {
  const router = useRouter();
  const { expandedAbstracts, toggleAbstract } = useResultsStore();
  const { isFocusModeOpen } = useUIStore();
  const updateFilter = useUpdateSearchFilter();
  const isMobile = useIsMobile();

  const handleFilteredSearch = async (filterType: 'cites' | 'cited_by' | 'related') => {
    // Create new search entry in history (SWR will handle data fetching)
    const { addSearchResult } = useSearchHistoryStore.getState();
    const searchId = addSearchResult({
      query: '',
      field: "title_and_abstract",
      count: 0, // SWR will populate the actual count
      dateRange: undefined,
      yearRange: undefined,
      filterType: "year",
      sortBy: "cited_by_count:desc",
      selectedRegions: [],
      selectedCountryFocus: [],
      // Don't set rating ranges - they should default to undefined (not filtered)
      citesItemId: filterType === 'cites' ? result.id : '',
      citedByItemId: filterType === 'cited_by' ? result.id : '',
      relatedToItemId: filterType === 'related' ? result.id : '',
    });

    // Navigate to the new search - SWR will handle data fetching
    if (searchId) {
      router.push(`/results/${searchId}`);
    }
  };

  const handleCitesSearch = () => handleFilteredSearch('cites');
  const handleCitedBySearch = () => handleFilteredSearch('cited_by');
  const handleRelatedSearch = () => handleFilteredSearch('related');

  return (
    <div className="border rounded-lg hover:bg-accent/50 transition-colors group">
      <div className="p-4 overflow-hidden">
        {/* COINS metadata span - only render when focus mode is not active */}
        {!isFocusModeOpen && (
          <span 
            className="Z3988" 
            title={workToCoins(result)}
            style={{ display: 'none' }}
          ></span>
        )}
        
        {/* Title */}
        <div className="mb-3">
          <button
            onClick={() => openFocusMode(isMobile, resultIndex)}
            className="text-left w-full group-hover:underline hover:text-blue-600 transition-colors cursor-pointer"
          >
            <h3 className="font-medium text-lg text-wrap-anywhere">
              {result.title} ({result.publication_year})
            </h3>
          </button>
        </div>

        {/* Authors */}
        {result.authorships && (
          <div className="mb-3">
            <div className="flex gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{result.authorships
                .map((author: { author: { display_name: string } }) => author.author.display_name)
                .join(', ')}</span>
            </div>
          </div>
        )}

        {/* Abstract and Extended Content */}
        <div className="mb-4">
          {/* Abstract */}
          {result.abstract && (
            <p className="text-sm text-muted-foreground text-wrap-anywhere mb-2">
              {expandedAbstracts[result.id] 
                ? result.abstract
                : result.abstract.length > 500 
                  ? `${result.abstract.slice(0, 500)}...` 
                  : result.abstract
              }
            </p>
          )}
          
          {/* Expanded Metadata - shown when expanded, excluding already shown content */}
          {expandedAbstracts[result.id] && (
            <div className="mt-4 space-y-3">
              {/* Academic Classification */}
              <div className="space-y-2">
                {/* Citation Percentile */}
                {result.cited_by_percentile_year && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Award className="h-3 w-3 flex-shrink-0" />
                    <div>
                      <span className="font-medium">Citation Percentile (Year):</span>
                      <span className="ml-1">{result.cited_by_percentile_year.min}-{result.cited_by_percentile_year.max}%</span>
                    </div>
                  </div>
                )}
                {result.primary_topic && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Target className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">Topic:</span>
                      <span className="ml-1">{result.primary_topic.display_name}</span>
                    </div>
                  </div>
                )}
                
                {result.primary_topic?.subfield && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Layers className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">Subfield:</span>
                      <span className="ml-1">{result.primary_topic.subfield.display_name}</span>
                    </div>
                  </div>
                )}
                
                {result.primary_topic?.field && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <BookOpen className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">Field:</span>
                      <span className="ml-1">{result.primary_topic.field.display_name}</span>
                    </div>
                  </div>
                )}
                
                {result.primary_topic?.domain && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Building className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">Domain:</span>
                      <span className="ml-1">{result.primary_topic.domain.display_name}</span>
                    </div>
                  </div>
                )}
                
                {result.sustainable_development_goals && result.sustainable_development_goals.length > 0 && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Leaf className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">SDGs:</span>
                      <div className="ml-1 flex flex-wrap gap-1 mt-1">
                        {result.sustainable_development_goals.map((sdg: { id: string; display_name: string; score: number }) => (
                          <span 
                            key={sdg.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs"
                            title={`${sdg.display_name} (Score: ${sdg.score?.toFixed(2) || 'N/A'})`}
                          >
                            {sdg.display_name}
                            {sdg.score && (
                              <span className="text-green-600 font-medium">
                                {sdg.score.toFixed(2)}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Additional Citation Metrics not shown in main content */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Quote className="h-3 w-3 flex-shrink-0" />
                  <span className="font-medium">References:</span>
                  <span>{result.referenced_works_count || 0}</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <BarChart3 className="h-3 w-3 flex-shrink-0" />
                  <span className="font-medium">FWCI:</span>
                  <span>{result.fwci ? result.fwci.toFixed(2) : 'N/A'}</span>
                </div>
              </div>
            </div>
          )}
          
          {/* Show More/Less Button - Always visible */}
          <button
            onClick={() => toggleAbstract(result.id)}
            className="mt-2 text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
          >
            {expandedAbstracts[result.id] ? 'Show Less' : 'Show More'}
          </button>
        </div>

        {/* Bottom Row: Completely different mobile vs desktop */}
        {isMobile ? (
          /* Mobile Layout: Card-based with clear sections */
          <div className="space-y-3">
            {/* Top row: Rating and quick actions */}
            <div className="flex items-center justify-between">
              <RatingSelector paperId={result.id} variant="compact" />
              <div className="flex items-center gap-2">
                <DownloadMenu
                  variant="icon"
                  onDownloadJSON={() => onDownloadItem(result, 'json')}
                  onDownloadCSV={() => onDownloadItem(result, 'csv')}
                  onDownloadEssentialJSON={() => onDownloadEssentialItem(result, 'json')}
                  onDownloadEssentialCSV={() => onDownloadEssentialItem(result, 'csv')}
                />
                {result.open_access?.is_oa && result.open_access?.oa_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(result.open_access.oa_url, '_blank')}
                    className="flex items-center gap-1 text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/50 px-3"
                    title="Open Access PDF"
                  >
                    <FileText className="h-4 w-4" />
                    <span className="text-sm">PDF</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Citation and related works cards */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleCitesSearch}
                className="bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/30 dark:hover:bg-orange-950/50 border border-orange-200 dark:border-orange-800 rounded-lg p-3 text-left transition-colors group relative"
              >
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 mb-1">
                  <Quote className="h-4 w-4" />
                  <span className="text-xs font-medium">Citations</span>
                </div>
                <div className="text-lg font-semibold text-orange-700 dark:text-orange-300">
                  {result.cited_by_count || 0}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-3 top-1/2 transform -translate-y-1/2 text-orange-600/60 dark:text-orange-400/60 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors" />
              </button>

              <button
                onClick={handleCitedBySearch}
                className="bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-950/50 border border-green-200 dark:border-green-800 rounded-lg p-3 text-left transition-colors group relative"
              >
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-1">
                  <Quote className="h-4 w-4" />
                  <span className="text-xs font-medium">Cited by</span>
                </div>
                <div className="text-lg font-semibold text-green-700 dark:text-green-300">
                  {result.referenced_works_count || 0}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-3 top-1/2 transform -translate-y-1/2 text-green-600/60 dark:text-green-400/60 group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors" />
              </button>

              <button
                onClick={handleRelatedSearch}
                className="bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:hover:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-left transition-colors group relative"
              >
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1">
                  <Network className="h-4 w-4" />
                  <span className="text-xs font-medium">Related</span>
                </div>
                <div className="text-lg font-semibold text-blue-700 dark:text-blue-300">
                  {result.related_works?.length || 0}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-3 top-1/2 transform -translate-y-1/2 text-blue-600/60 dark:text-blue-400/60 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
              </button>
            </div>
          </div>
        ) : (
          /* Desktop Layout: Original horizontal layout */
          <div className="flex items-center justify-between gap-4">
            {/* Left side: Rating and Citation buttons */}
            <div className="flex items-center gap-4 flex-wrap">
              <RatingSelector paperId={result.id} variant="compact" />
              
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCitesSearch}
                className="flex items-center gap-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-950/50 flex-shrink-0"
                title="Find works that cite this paper"
              >
                <Quote className="h-4 w-4" />
                <span className="text-sm">
                  Cited by: {result.cited_by_count || 0}
                </span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleCitedBySearch}
                className="flex items-center gap-2 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/50 flex-shrink-0"
                title="Find works cited by this paper"
              >
                <Quote className="h-4 w-4" />
                <span className="text-sm">
                  Cites: {result.referenced_works_count || 0}
                </span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleRelatedSearch}
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50 flex-shrink-0"
                title="Find works related to this paper"
              >
                <Network className="h-4 w-4" />
                <span className="text-sm">
                  Related: {result.related_works?.length || 0}
                </span>
              </Button>
            </div>

            {/* Right side: Action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Open Access PDF Button */}
              {result.open_access?.is_oa && result.open_access?.oa_url && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(result.open_access.oa_url, '_blank')}
                  onMouseDown={(e) => {
                    // Handle middle click
                    if (e.button === 1) {
                      e.preventDefault();
                      window.open(result.open_access.oa_url, '_blank');
                    }
                  }}
                  className="flex items-center gap-2 text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/50 cursor-pointer flex-shrink-0"
                  title="Open Access PDF"
                >
                  <FileText className="h-4 w-4" />
                  <span>PDF</span>
                </Button>
              )}
              
              {/* Download Menu */}
              <DownloadMenu
                variant="icon"
                onDownloadJSON={() => onDownloadItem(result, 'json')}
                onDownloadCSV={() => onDownloadItem(result, 'csv')}
                onDownloadEssentialJSON={() => onDownloadEssentialItem(result, 'json')}
                onDownloadEssentialCSV={() => onDownloadEssentialItem(result, 'csv')}
              />
            </div>
          </div>
        )}

      </div>
    </div>
  );
} 