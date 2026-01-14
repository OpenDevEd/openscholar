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
import { useUIStore, useSearchHistoryStore, HistorySortBy, ViewMode } from "@/lib/store";
import { showConfirmation } from "@/lib/confirmation";
import { toast } from "sonner";
import { jsonToCSV, downloadAsFile, uploadFile, triggerFileUpload } from "@/lib/utils";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { subtleSpring } from "./index";

// View mode toggle - adapted for history (reusing same icons as ViewModeToggleCompact)
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

const sortOptions: { value: HistorySortBy; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "oldest", label: "Oldest" },
  { value: "most", label: "Most Results" },
  { value: "least", label: "Least Results" },
];

interface HistoryToolbarProps {
  searchFilter: string;
  onSearchChange: (value: string) => void;
  totalCount: number;
}

export function HistoryToolbar({
  searchFilter,
  onSearchChange,
  totalCount,
}: HistoryToolbarProps) {
  const {
    historyViewMode,
    setHistoryViewMode,
    historySortBy,
    setHistorySortBy,
  } = useUIStore();
  const { searchHistory, clearSearchHistory, importSearchHistory } =
    useSearchHistoryStore();

  const currentSort = sortOptions.find((o) => o.value === historySortBy);

  // Download handlers
  const handleDownloadJSON = () => {
    try {
      const data = searchHistory.map((item) => {
        const { expandedQuery } = validateAndExpandKeywordsSilently(item.query);
        return {
          search_query: expandedQuery,
          count: item.count,
          field: item.field,
        };
      });
      downloadAsFile(JSON.stringify(data, null, 2), "search_history.json", "json");
      toast.success(`Downloaded ${data.length} search entries as JSON`);
    } catch {
      toast.error("Failed to download JSON file");
    }
  };

  const handleDownloadCSV = async () => {
    try {
      const data = searchHistory.map((item) => {
        const { expandedQuery } = validateAndExpandKeywordsSilently(item.query);
        return {
          search_query: expandedQuery,
          count: item.count,
          field: item.field,
        };
      });
      const csv = await jsonToCSV(data);
      downloadAsFile(csv, "search_history.csv", "csv");
      toast.success(`Downloaded ${data.length} search entries as CSV`);
    } catch {
      toast.error("Failed to download CSV file");
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload(".json");
      const data = await uploadFile(file);
      const importedCount = importSearchHistory(data);
      if (importedCount > 0) {
        toast.success(`Successfully imported ${importedCount} search entries`);
      } else {
        toast.warning("No valid search entries found in the file");
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
      const importedCount = importSearchHistory(data);
      if (importedCount > 0) {
        toast.success(`Successfully imported ${importedCount} search entries`);
      } else {
        toast.warning("No valid search entries found in the file");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload CSV file"
      );
    }
  };

  const handleClearAll = () => {
    showConfirmation({
      title: "Clear All Search History",
      message: `Are you sure you want to delete all ${searchHistory.length} search entries? This action cannot be undone.`,
      confirmText: "Clear All",
      onConfirm: () => {
        clearSearchHistory();
        toast.success("All search history cleared");
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
            const isActive = historyViewMode === option.mode;
            return (
              <button
                key={option.mode}
                onClick={() => setHistoryViewMode(option.mode)}
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
          placeholder="Search your history..."
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
                onClick={() => setHistorySortBy(option.value)}
                className={cn(
                  historySortBy === option.value && "bg-muted"
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
          <TooltipContent>Clear all history</TooltipContent>
        </Tooltip>
      </div>
    </motion.div>
  );
}
