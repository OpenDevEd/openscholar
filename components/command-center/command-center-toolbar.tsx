"use client";

import React from "react";
import { motion } from "motion/react";
import {
  Search,
  X,
  Trash2,
  Download,
  Upload,
  ChevronDown,
  ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { subtleSpring } from "@/lib/animation-config";
import { VIEW_MODE_OPTIONS } from "@/lib/constants/view-modes";
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
  const currentSortOption = sortOptions.find((o) => o.value === currentSort);
  const hasDownloadUpload = onDownloadJSON || onDownloadCSV || onUploadJSON || onUploadCSV;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ...subtleSpring, delay: 0.15 }}
      className={cn(
        "px-4 md:px-6 py-3",
        "border-b border-border/40",
        "flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
      )}
    >
      {/* Left: View mode toggle + extra actions */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-0.5 p-0.5 bg-muted/50 dark:bg-muted/30 rounded-lg border border-border/60">
          {VIEW_MODE_OPTIONS.map((option) => {
            const isActive = viewMode === option.mode;
            const Icon = option.icon;
            return (
              <button
                key={option.mode}
                onClick={() => onViewModeChange(option.mode)}
                className={cn(
                  "relative z-10 flex items-center justify-center p-1.5 rounded-md transition-colors",
                  isActive
                    ? "text-primary bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
                title={option.label}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
        {extraActions}
      </div>

      {/* Center: Search input */}
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          placeholder={placeholder}
          value={searchFilter}
          onChange={(e) => onSearchChange(e.target.value)}
          className={cn(
            "pl-9 pr-9 h-9",
            "bg-muted/30 dark:bg-muted/20",
            "border-border/50",
            "placeholder:text-muted-foreground/60"
          )}
        />
        {searchFilter && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 shrink-0 justify-end">
        {/* Sort dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{currentSortOption?.label}</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
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

        {/* Download/Upload dropdown */}
        {hasDownloadUpload && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
              >
                <Download className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onDownloadJSON && (
                <DropdownMenuItem
                  onClick={onDownloadJSON}
                  disabled={totalCount === 0}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download as JSON
                </DropdownMenuItem>
              )}
              {onDownloadCSV && (
                <DropdownMenuItem
                  onClick={onDownloadCSV}
                  disabled={totalCount === 0}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download as CSV
                </DropdownMenuItem>
              )}
              {(onDownloadJSON || onDownloadCSV) && (onUploadJSON || onUploadCSV) && (
                <DropdownMenuSeparator />
              )}
              {onUploadJSON && (
                <DropdownMenuItem onClick={onUploadJSON}>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload JSON
                </DropdownMenuItem>
              )}
              {onUploadCSV && (
                <DropdownMenuItem onClick={onUploadCSV}>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload CSV
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Clear all button */}
        {onClearAll && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClearAll}
                disabled={totalCount === 0}
                className="h-9 w-9 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{clearTooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </motion.div>
  );
}
