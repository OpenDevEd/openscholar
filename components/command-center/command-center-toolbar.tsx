"use client";

import { useTranslations } from "next-intl";
import { Trash2, Download, Upload, ArrowUpDown } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { LIST_FILTER, ListSearch } from "@/components/evidence-libraries/list-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

interface CommandCenterFiltersProps<TSort extends string> {
  sortOptions: SortOption<TSort>[];
  currentSort: TSort;
  onSortChange: (sort: TSort) => void;
  searchFilter: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
}

interface CommandCenterFileActionsProps {
  onDownloadJSON?: () => void;
  onDownloadCSV?: () => Promise<void>;
  onUploadJSON?: () => Promise<void>;
  onUploadCSV?: () => Promise<void>;
  onClearAll?: () => void;
  clearTooltip?: string;
  totalCount?: number;
}

/** A command center's search and sort, as siblings so a page bar or card toolbar can lay them out. */
export function CommandCenterFilters<TSort extends string>({
  sortOptions,
  currentSort,
  onSortChange,
  searchFilter,
  onSearchChange,
  placeholder,
}: CommandCenterFiltersProps<TSort>) {
  const t = useTranslations("libraryPage");
  return (
    <>
      <ListSearch
        aria-label={placeholder}
        placeholder={placeholder}
        value={searchFilter}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-56"
      />
      <Select value={currentSort} onValueChange={(value) => onSortChange(value as TSort)}>
        <SelectTrigger size="sm" aria-label={t("sortBy")} className={cn("w-40", LIST_FILTER)}>
          <ArrowUpDown className="size-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

/** Import, export and clear-all, as icon buttons. */
export function CommandCenterFileActions({
  onDownloadJSON,
  onDownloadCSV,
  onUploadJSON,
  onUploadCSV,
  onClearAll,
  clearTooltip,
  totalCount,
}: CommandCenterFileActionsProps) {
  const tc = useTranslations("common");
  const hasDownloadUpload = onDownloadJSON || onDownloadCSV || onUploadJSON || onUploadCSV;
  return (
    <>
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
    </>
  );
}

/**
 * A command center's toolbar as one row inside its card, for the history
 * chooser, which sits in a dialog without a page bar.
 */
export function CommandCenterToolbar<TSort extends string>({
  viewMode,
  onViewModeChange,
  ...props
}: CommandCenterFiltersProps<TSort> & CommandCenterFileActionsProps & {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle p-4">
      <ViewModeSwitch value={viewMode} onChange={onViewModeChange} />
      <div className="flex flex-wrap items-center gap-2">
        <CommandCenterFilters {...props} />
        <CommandCenterFileActions {...props} />
      </div>
    </div>
  );
}
