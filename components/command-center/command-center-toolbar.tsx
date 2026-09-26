"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Trash2,
  Download,
  Upload,
  ChevronDown,
  ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LIST_FILTER, ListSearch } from "@/components/evidence-libraries/list-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ViewModeSwitch } from "@/components/view-mode-toggle";
import type { ViewMode } from "@/lib/types";

interface SortOption<T extends string> {
  value: T;
  label: string;
}

interface CommandCenterToolbarProps<TSort extends string> {
  // View mode
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  // Sort
  sortOptions: SortOption<TSort>[];
  currentSort: TSort;
  onSortChange: (sort: TSort) => void;
  // Search
  searchFilter: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  // Download/Upload handlers (optional)
  onDownloadJSON?: () => void;
  onDownloadCSV?: () => Promise<void>;
  onUploadJSON?: () => Promise<void>;
  onUploadCSV?: () => Promise<void>;
  // Clear (optional)
  onClearAll?: () => void;
  clearTooltip?: string;
  // State
  totalCount?: number;
  // Extra actions slot (rendered after view mode toggle, before search)
  extraActions?: React.ReactNode;
}

/**
 * Shared toolbar component for command centers.
 * Includes view mode toggle, search input, sort dropdown, download/upload, and clear button.
 */
export function CommandCenterToolbar<TSort extends string>({
  viewMode,
  onViewModeChange,
  sortOptions,
  currentSort,
  onSortChange,
  searchFilter,
  onSearchChange,
  placeholder,
  onDownloadJSON,
  onDownloadCSV,
  onUploadJSON,
  onUploadCSV,
  onClearAll,
  clearTooltip,
  totalCount,
  extraActions,
}: CommandCenterToolbarProps<TSort>) {
  const tc = useTranslations("common");
  const currentSortOption = sortOptions.find((o) => o.value === currentSort);
  const hasDownloadUpload = onDownloadJSON || onDownloadCSV || onUploadJSON || onUploadCSV;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 p-4">
      {/* View mode switch + extra actions */}
      <div className="flex items-center gap-2">
        <ViewModeSwitch value={viewMode} onChange={onViewModeChange} />
        {extraActions}
      </div>

      {/* Search, sort and file actions */}
      <div className="flex flex-wrap items-center gap-2">
        <ListSearch
          aria-label={placeholder}
          placeholder={placeholder}
          value={searchFilter}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-56"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className={cn("h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground", LIST_FILTER)}>
              <ArrowUpDown className="size-3.5" />
              <span className="hidden sm:inline">{currentSortOption?.label}</span>
              <ChevronDown className="size-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {sortOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => onSortChange(option.value)}
                className={cn(currentSort === option.value && "bg-muted")}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {hasDownloadUpload && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={tc("downloadAsJson")} className="size-8 text-muted-foreground hover:text-foreground">
                <Download className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onDownloadJSON && (
                <DropdownMenuItem onClick={onDownloadJSON} disabled={totalCount === 0}>
                  <Download className="h-4 w-4 mr-2" />
                  {tc("downloadAsJson")}
                </DropdownMenuItem>
              )}
              {onDownloadCSV && (
                <DropdownMenuItem onClick={onDownloadCSV} disabled={totalCount === 0}>
                  <Download className="h-4 w-4 mr-2" />
                  {tc("downloadAsCsv")}
                </DropdownMenuItem>
              )}
              {(onDownloadJSON || onDownloadCSV) && (onUploadJSON || onUploadCSV) && (
                <DropdownMenuSeparator />
              )}
              {onUploadJSON && (
                <DropdownMenuItem onClick={onUploadJSON}>
                  <Upload className="h-4 w-4 mr-2" />
                  {tc("uploadJson")}
                </DropdownMenuItem>
              )}
              {onUploadCSV && (
                <DropdownMenuItem onClick={onUploadCSV}>
                  <Upload className="h-4 w-4 mr-2" />
                  {tc("uploadCsv")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {onClearAll && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={clearTooltip}
                onClick={onClearAll}
                disabled={totalCount === 0}
                className="size-8 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{clearTooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
