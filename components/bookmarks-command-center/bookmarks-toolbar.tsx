"use client";

import React from "react";
import { motion } from "framer-motion";
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
import { useUIStore, useKeywordExpansionStore, BookmarkSortBy, ViewMode } from "@/lib/store";
import { showConfirmation } from "@/lib/confirmation";
import { toast } from "sonner";
import { jsonToCSV, downloadAsFile, triggerFileUpload, uploadFile } from "@/lib/utils";
import { subtleSpring } from "./index";
import { List, LayoutList, LayoutGrid, Grid3X3 } from "lucide-react";

interface ViewModeOption {
  mode: ViewMode;
  icon: React.ReactNode;
  label: string;
}

const viewModeOptions: ViewModeOption[] = [
  { mode: "list-simple", icon: <List className="h-4 w-4" />, label: "Simple List" },
  { mode: "list-detail", icon: <LayoutList className="h-4 w-4" />, label: "Detailed List" },
  { mode: "grid-2", icon: <LayoutGrid className="h-4 w-4" />, label: "2 Column Grid" },
  { mode: "grid-3", icon: <Grid3X3 className="h-4 w-4" />, label: "3 Column Grid" },
];

const sortOptions: { value: BookmarkSortBy; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "oldest", label: "Oldest" },
  { value: "alpha", label: "A → Z" },
  { value: "alpha-desc", label: "Z → A" },
];

interface BookmarksToolbarProps {
  searchFilter: string;
  onSearchChange: (value: string) => void;
  totalCount: number;
}

export function BookmarksToolbar({
  searchFilter,
  onSearchChange,
  totalCount,
}: BookmarksToolbarProps) {
  const {
    bookmarkViewMode,
    setBookmarkViewMode,
    bookmarkSortBy,
    setBookmarkSortBy,
  } = useUIStore();
  const { keywords, clearKeywords, importKeywords } = useKeywordExpansionStore();

  const currentSort = sortOptions.find((o) => o.value === bookmarkSortBy);

  // Download handlers
  const handleDownloadJSON = () => {
    try {
      const data = Object.entries(keywords).map(([name, bookmark]) => ({
        name,
        expansion: bookmark.expansion,
        createdAt: bookmark.createdAt,
      }));
      downloadAsFile(JSON.stringify(data, null, 2), "bookmarks.json", "json");
      toast.success(`Downloaded ${data.length} bookmarks as JSON`);
    } catch {
      toast.error("Failed to download JSON file");
    }
  };

  const handleDownloadCSV = async () => {
    try {
      const data = Object.entries(keywords).map(([name, bookmark]) => ({
        name,
        expansion: bookmark.expansion,
        createdAt: new Date(bookmark.createdAt).toISOString(),
      }));
      const csv = await jsonToCSV(data);
      downloadAsFile(csv, "bookmarks.csv", "csv");
      toast.success(`Downloaded ${data.length} bookmarks as CSV`);
    } catch {
      toast.error("Failed to download CSV file");
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload(".json");
      const data = await uploadFile(file);
      const importedCount = importKeywords(data);
      if (importedCount > 0) {
        toast.success(`Successfully imported ${importedCount} bookmarks`);
      } else {
        toast.warning("No valid bookmarks found in the file");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload JSON file"
      );
    }
  };

  const handleUploadCSV = async () => {
    try {
      const file = await triggerFileUpload(".csv");
      const data = await uploadFile(file);
      const importedCount = importKeywords(data);
      if (importedCount > 0) {
        toast.success(`Successfully imported ${importedCount} bookmarks`);
      } else {
        toast.warning("No valid bookmarks found in the file");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload CSV file"
      );
    }
  };

  const handleClearAll = () => {
    showConfirmation({
      title: "Clear All Bookmarks",
      message: `Are you sure you want to delete all ${Object.keys(keywords).length} bookmarks? This action cannot be undone.`,
      confirmText: "Clear All",
      onConfirm: () => {
        clearKeywords();
        toast.success("All bookmarks cleared");
      },
    });
  };

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
      {/* Left: View mode toggle */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-0.5 p-0.5 bg-muted/50 dark:bg-muted/30 rounded-lg border border-border/60">
          {viewModeOptions.map((option) => {
            const isActive = bookmarkViewMode === option.mode;
            return (
              <button
                key={option.mode}
                onClick={() => setBookmarkViewMode(option.mode)}
                className={cn(
                  "relative z-10 flex items-center justify-center p-1.5 rounded-md transition-colors",
                  isActive
                    ? "text-primary bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
                title={option.label}
              >
                {option.icon}
              </button>
            );
          })}
        </div>
      </div>

      {/* Center: Search input */}
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          placeholder="Search bookmarks..."
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
              <span className="hidden sm:inline">{currentSort?.label}</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {sortOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setBookmarkSortBy(option.value)}
                className={cn(
                  bookmarkSortBy === option.value && "bg-muted"
                )}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Download/Upload dropdown */}
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
            <DropdownMenuItem 
              onClick={handleDownloadJSON}
              disabled={totalCount === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Download as JSON
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={handleDownloadCSV}
              disabled={totalCount === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Download as CSV
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleUploadJSON}>
              <Upload className="h-4 w-4 mr-2" />
              Upload JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleUploadCSV}>
              <Upload className="h-4 w-4 mr-2" />
              Upload CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Clear all button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearAll}
              disabled={totalCount === 0}
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear all bookmarks</TooltipContent>
        </Tooltip>
      </div>
    </motion.div>
  );
}
