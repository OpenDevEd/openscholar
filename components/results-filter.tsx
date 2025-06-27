"use client";

import React from 'react';
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { DownloadMenu } from "./download-menu";
import { useIsMobile } from "@/lib/hooks";

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
}

export function ResultsFilter({ 
  value, 
  onChange, 
  filteredCount, 
  totalCount,
  onDownloadJSON,
  onDownloadCSV,
  onDownloadEssentialJSON,
  onDownloadEssentialCSV 
}: ResultsFilterProps) {
  const isMobile = useIsMobile();
  const hasDownloadHandlers = onDownloadJSON || onDownloadCSV || onDownloadEssentialJSON || onDownloadEssentialCSV;

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
        
        {/* Show download button on mobile if handlers are provided */}
        {isMobile && hasDownloadHandlers && (
          <DownloadMenu
            variant="icon"
            onDownloadJSON={onDownloadJSON}
            onDownloadCSV={onDownloadCSV}
            onDownloadEssentialJSON={onDownloadEssentialJSON}
            onDownloadEssentialCSV={onDownloadEssentialCSV}
          />
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