"use client";

import { Fragment, type ReactNode } from "react";
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
  /** Held in place unseen while the page doesn't yet know whether it has anything to search. */
  pending?: boolean;
}

interface CommandCenterFileActionsProps {
  onDownloadJSON?: () => void;
  onDownloadCSV?: () => Promise<void>;
  onUploadJSON?: () => Promise<void>;
  onUploadCSV?: () => Promise<void>;
  onClearAll?: () => void;
  clearTooltip?: string;
  totalCount?: number;
  disabled?: boolean;
}

/** A command center's search and sort, as siblings so a page bar or card toolbar can lay them out. Both are pills, as the tabs beside them are. */
export function CommandCenterFilters<TSort extends string>({
  sortOptions,
  currentSort,
  onSortChange,
  searchFilter,
  onSearchChange,
  placeholder,
  pending = false,
}: CommandCenterFiltersProps<TSort>) {
  const t = useTranslations("libraryPage");
  const Frame = pending ? Unseen : Fragment;
  return (
    <Frame>
      <ListSearch
        aria-label={placeholder}
        placeholder={placeholder}
        value={searchFilter}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-56 rounded-full"
      />
      <Select value={currentSort} onValueChange={(value) => onSortChange(value as TSort)}>
        <SelectTrigger size="sm" aria-label={t("sortBy")} className={cn("w-auto min-w-40 rounded-full px-3.5", LIST_FILTER)}>
          <ArrowUpDown className="size-3.5" />
          {/* As wide as its longest order, whichever is picked: no label is cut, and picking another moves nothing beside it. */}
          <span className="grid flex-1 text-start">
            <span className="[grid-area:1/1]"><SelectValue /></span>
            {sortOptions.map((option) => <span key={option.value} aria-hidden className="invisible whitespace-nowrap [grid-area:1/1]">{option.label}</span>)}
          </span>
        </SelectTrigger>
        {/* Under its field and as wide as it, as every field's list opens. */}
        <SelectContent position="popper" className="w-(--radix-select-trigger-width) min-w-0">
          {sortOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Frame>
  );
}

/** Its children keep their room in the bar's layout, unseen and out of reach of the keyboard. */
function Unseen({ children }: { children: ReactNode }) {
  return <div aria-hidden className="invisible contents">{children}</div>;
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
  disabled = false,
}: CommandCenterFileActionsProps) {
  const tc = useTranslations("common");
  const hasDownloadUpload = onDownloadJSON || onDownloadCSV || onUploadJSON || onUploadCSV;
  return (
    <>
      {hasDownloadUpload && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={disabled} aria-label={tc("downloadAsJson")} className="size-8 text-muted-foreground hover:text-foreground">
              <Download className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onDownloadJSON && (
              <DropdownMenuItem onClick={onDownloadJSON} disabled={disabled || totalCount === 0}>
                <Download className="h-4 w-4 me-2" />
                {tc("downloadAsJson")}
              </DropdownMenuItem>
            )}
            {onDownloadCSV && (
              <DropdownMenuItem onClick={onDownloadCSV} disabled={disabled || totalCount === 0}>
                <Download className="h-4 w-4 me-2" />
                {tc("downloadAsCsv")}
              </DropdownMenuItem>
            )}
            {(onDownloadJSON || onDownloadCSV) && (onUploadJSON || onUploadCSV) && (
              <DropdownMenuSeparator />
            )}
            {onUploadJSON && (
              <DropdownMenuItem onClick={onUploadJSON} disabled={disabled}>
                <Upload className="h-4 w-4 me-2" />
                {tc("uploadJson")}
              </DropdownMenuItem>
            )}
            {onUploadCSV && (
              <DropdownMenuItem onClick={onUploadCSV} disabled={disabled}>
                <Upload className="h-4 w-4 me-2" />
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
              disabled={disabled || totalCount === 0}
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
