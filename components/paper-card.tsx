import React from 'react';
import { workToCoins } from "@/lib/utils";
import { useResultsStore, useUIStore } from "@/lib/store";
import { RatingSelector } from "./rating-selector";
import { PaperMetadata } from "./paper-metadata";
import { DownloadMenu } from "./download-menu";

interface PaperCardProps {
  result: any;
  onDownloadItem: (item: any, format: 'json' | 'csv') => void;
  onDownloadEssentialItem: (item: any, format: 'json' | 'csv') => void;
  onOpenFocusMode: () => void;
}

export function PaperCard({ 
  result, 
  onDownloadItem, 
  onDownloadEssentialItem, 
  onOpenFocusMode
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
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1">
            {/* Rating */}
            <RatingSelector paperId={result.id} />

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
          <DownloadMenu
            variant="icon"
            showFocusMode={true}
            onOpenFocusMode={onOpenFocusMode}
            onDownloadJSON={() => onDownloadItem(result, 'json')}
            onDownloadCSV={() => onDownloadItem(result, 'csv')}
            onDownloadEssentialJSON={() => onDownloadEssentialItem(result, 'json')}
            onDownloadEssentialCSV={() => onDownloadEssentialItem(result, 'csv')}
          />
        </div>
      </div>
    </div>
  );
} 