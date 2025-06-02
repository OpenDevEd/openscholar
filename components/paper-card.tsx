import React from 'react';
import { workToCoins } from "@/lib/utils";
import { useResultsStore, useUIStore } from "@/lib/store";
import { RatingSelector } from "./rating-selector";
import { PaperMetadata } from "./paper-metadata";
import { DownloadMenu } from "./download-menu";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

interface PaperCardProps {
  result: any;
  onDownloadItem: (item: any, format: 'json' | 'csv') => void;
  onDownloadEssentialItem: (item: any, format: 'json' | 'csv') => void;
}

export function PaperCard({ 
  result, 
  onDownloadItem, 
  onDownloadEssentialItem
}: PaperCardProps) {
  const { expandedAbstracts, toggleAbstract } = useResultsStore();
  const { isFocusModeOpen } = useUIStore();

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
        
        {/* Header Row: Rating and Action Buttons */}
        <div className="flex justify-between items-start mb-3">
          <RatingSelector paperId={result.id} />
          <div className="flex items-start gap-2">
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
                className="flex items-center gap-2 text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/50 cursor-pointer"
                title="Open Access PDF"
              >
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">PDF</span>
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

        {/* Full Width Content */}
        <div className="w-full">
          {/* Title with Year */}
          <a
            href={result.id}
            target="_blank"
            rel="noopener noreferrer"
            className="group-hover:underline"
          >
            <h3 className="font-medium text-lg break-all hyphens-auto">
              {result.title} ({result.publication_year})
            </h3>
          </a>
          
          {/* Abstract */}
          {result.abstract && (
            <div className="mt-3">
              <p className="text-sm text-muted-foreground break-words hyphens-auto overflow-wrap-anywhere">
                {expandedAbstracts[result.id] 
                  ? result.abstract
                  : result.abstract.length > 500 
                    ? `${result.abstract.slice(0, 500)}...` 
                    : result.abstract
                }
              </p>
            </div>
          )}

          {/* Show More/Less Button - Always Visible */}
          <button
            onClick={() => toggleAbstract(result.id)}
            className="mt-3 text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
          >
            {expandedAbstracts[result.id] ? 'Show Less' : 'Show More'}
          </button>

          {/* Expanded Metadata */}
          <PaperMetadata result={result} isExpanded={expandedAbstracts[result.id]} />
        </div>
      </div>
    </div>
  );
} 