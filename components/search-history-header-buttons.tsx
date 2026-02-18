"use client";

import React from "react";
import { SearchHistoryActionDropdown } from "@/components/search-history-action-dropdown";
import { SearchHistoryClearAllButton } from "@/components/search-history-clear-all-button";
import { cn } from "@/lib/utils";

interface SearchHistoryHeaderButtonsProps {
  variant?: "compact" | "full";
  onDownloadJSON: () => void;
  onDownloadCSV: () => void;
  onUploadJSON: () => void;
  onUploadCSV: () => void;
  onClearAll: () => void;
  isClearDisabled: boolean;
}

export function SearchHistoryHeaderButtons({
  variant = "compact",
  onDownloadJSON,
  onDownloadCSV,
  onUploadJSON,
  onUploadCSV,
  onClearAll,
  isClearDisabled,
}: SearchHistoryHeaderButtonsProps) {
  return (
    <div
      className={cn(
        "flex items-center",
        variant === "compact" ? "gap-2" : "gap-2 sm:gap-3 justify-center sm:justify-end"
      )}
    >
      <SearchHistoryActionDropdown
        onDownloadJSON={onDownloadJSON}
        onDownloadCSV={onDownloadCSV}
        onUploadJSON={onUploadJSON}
        onUploadCSV={onUploadCSV}
        variant={variant}
      />
      <SearchHistoryClearAllButton
        onClick={onClearAll}
        disabled={isClearDisabled}
        variant={variant}
      />
    </div>
  );
}
