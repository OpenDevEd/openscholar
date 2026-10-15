"use client";

import {
  Download,
} from "@/components/icons";
import { useTranslations } from "next-intl";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { AnimatedCount } from "@/components/search-command-center/components/animated-count";
import { LibrarySearchBar } from "./library-search-bar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipHint } from "@/components/ui/tooltip";
import type { LibraryViewMode } from "@/lib/library/search-params";
import { ViewModeSwitch } from "@/components/view-mode-toggle";

interface LibraryCommandCenterProps {
  rawSearch: string;
  onSearchChange: (value: string) => void;
  totalCount?: number;
  filteredCount?: number;
  /** The filtered count stopped before the end, so it's shown as "1,000+". */
  filteredCountIsAtLeast?: boolean;
  activeFilterLabels: string[];
  viewMode: LibraryViewMode;
  onViewModeChange: (mode: LibraryViewMode) => void;
  onExportCSV: () => void;
  onExportJSON: () => void;
  hasExportableResults: boolean;
  /** What the library is showing: a collection's name, or the library's; undefined while an opened collection's name is read. */
  title: string | undefined;
  /** Beside the count, such as whose collection it is. */
  meta?: React.ReactNode;
  /** At the heading's end, such as sharing a collection. */
  actions?: React.ReactNode;
}

export function LibraryCommandCenter({
  rawSearch,
  onSearchChange,
  totalCount,
  filteredCount,
  filteredCountIsAtLeast = false,
  activeFilterLabels,
  viewMode,
  onViewModeChange,
  onExportCSV,
  onExportJSON,
  hasExportableResults,
  title,
  meta,
  actions,
}: LibraryCommandCenterProps) {
  const t = useTranslations("libraryPage");
  const tc = useTranslations("common");

  // Two rows: what you're looking at with its count, filters and actions; then search and how it's shown.
  return (
    <CommandCenterContainer className="overflow-hidden">
      <div className="relative space-y-3 p-4">
        {/* Its height holds while an opened collection's name is read; then the row comes whole, so nothing in it moves. */}
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
          {title === undefined ? null : (
            <>
              <h2 className="min-w-0 max-w-full truncate text-base font-semibold tracking-tight">{title}</h2>
              {totalCount !== undefined && (
                <span className="flex shrink-0 items-baseline gap-1 text-sm text-muted-foreground">
                  {filteredCount !== undefined && filteredCount !== totalCount ? (
                    <>
                      <AnimatedCount value={filteredCount} atLeast={filteredCountIsAtLeast} className="font-semibold tabular-nums text-foreground" />
                      <span className="tabular-nums">/ {totalCount}</span>
                    </>
                  ) : (
                    <AnimatedCount value={totalCount} className="font-semibold tabular-nums text-foreground" />
                  )}
                  <span>{tc("results").toLowerCase()}</span>
                </span>
              )}
              {meta || activeFilterLabels.length ? (
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {meta}
                  {activeFilterLabels.map((label) => (
                    <span key={label} className="inline-flex h-6 items-center rounded-full border border-border-subtle bg-inset px-2.5 text-xs text-muted-foreground">
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}
              {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LibrarySearchBar
            value={rawSearch}
            onChange={onSearchChange}
            className="min-w-56 flex-1"
            inputClassName="h-10 rounded-xl border-border-subtle bg-field text-sm shadow-sm"
            clearButtonClassName="h-7 w-7 rounded-lg"
          />
          <ViewModeSwitch value={viewMode} onChange={onViewModeChange} />
          {/* There from the first frame, so the search beside it doesn't narrow when the records arrive. */}
          <DropdownMenu>
            <TooltipHint label={t("exportLibrary")}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  aria-label={t("exportLibrary")}
                  disabled={!hasExportableResults}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipHint>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onExportCSV}>{t("exportAsCSV")}</DropdownMenuItem>
              <DropdownMenuItem onClick={onExportJSON}>{t("exportAsJSON")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </CommandCenterContainer>
  );
}
