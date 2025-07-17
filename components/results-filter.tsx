"use client";

import React from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ClipboardCheck } from "lucide-react";
import { DownloadMenu } from "./download-menu";
import { useIsMobile, useEffectiveSearchId } from "@/lib/hooks";
import { useScreeningStore } from "@/lib/store";
import { toast } from 'sonner';

interface ResultsFilterProps {
  value: string;
  onChange: (value: string) => void;
  filteredCount: number;
  totalCount: number;
  // Download props (optional for mobile download button)
  onDownloadJSON?: () => void;
  onDownloadCSV?: () => void;
  onDownloadEssentialJSON?: () => void;
  onDownloadEssentialCSV?: () => void;
  // Search results for adding to screening
  results?: any[];
}

export function ResultsFilter({ 
  value, 
  onChange, 
  filteredCount, 
  totalCount,
  onDownloadJSON,
  onDownloadCSV,
  onDownloadEssentialJSON,
  onDownloadEssentialCSV,
  results = []
}: ResultsFilterProps) {
  const isMobile = useIsMobile();
  const effectiveSearchId = useEffectiveSearchId();
  const { addDocumentFromWork } = useScreeningStore();
  const hasDownloadHandlers = onDownloadJSON || onDownloadCSV || onDownloadEssentialJSON || onDownloadEssentialCSV;

  const handleAddResultsToScreening = () => {
    if (!results || results.length === 0) {
      toast.error('No results to add', {
        description: 'There are no search results available to add to screening.'
      });
      return;
    }

    let addedCount = 0;
    let duplicateCount = 0;

    results.forEach((result) => {
      try {
        // Check if document already exists in screening
        const { documents } = useScreeningStore.getState();
        const existingDoc = documents.find(doc => doc.id === result.id || doc.originalWork?.id === result.id);
        
        if (existingDoc) {
          duplicateCount++;
        } else {
          addDocumentFromWork(result);
          addedCount++;
        }
      } catch (error) {
        console.error('Error adding result to screening:', error);
      }
    });

    if (addedCount > 0) {
      toast.success(`Added ${addedCount} documents to screening`, {
        description: duplicateCount > 0 
          ? `${duplicateCount} documents were already in screening and skipped.`
          : 'All documents were successfully added to screening.'
      });
    } else if (duplicateCount > 0) {
      toast.info('No new documents added', {
        description: 'All documents are already in screening.'
      });
    }
  };

  return (
    <div className="flex-shrink-0 mb-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search within results..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="pl-10"
          />
        </div>
        
        {/* Show download button and add to screening button */}
        {hasDownloadHandlers && (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleAddResultsToScreening}
              disabled={!results || results.length === 0}
              title="Add all results to screening"
            >
              <ClipboardCheck className="h-4 w-4" />
            </Button>
            <DownloadMenu
              variant="icon"
              onDownloadJSON={onDownloadJSON}
              onDownloadCSV={onDownloadCSV}
              onDownloadEssentialJSON={onDownloadEssentialJSON}
              onDownloadEssentialCSV={onDownloadEssentialCSV}
            />
          </>
        )}
      </div>
      
      {value && (
        <div className="mt-2 text-xs text-muted-foreground">
          Showing {filteredCount} of {totalCount} results
        </div>
      )}
    </div>
  );
} 