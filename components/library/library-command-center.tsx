"use client";

import {
  Download,
  Grid3X3,
  LayoutGrid,
  LayoutList,
  List,
} from "lucide-react";
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
import type { LibraryViewMode } from "@/lib/library/search-params";
import { CompactIconToggleGroup } from "@/components/view-mode-toggle";

interface LibraryCommandCenterProps {
  rawSearch: string;
  onSearchChange: (value: string) => void;
  totalCount?: number;
  filteredCount?: number;
  activeFilterLabels: string[];
  viewMode: LibraryViewMode;
  onViewModeChange: (mode: LibraryViewMode) => void;
  onExportCSV: () => void;
  onExportJSON: () => void;
  hasExportableResults: boolean;
}

export function LibraryCommandCenter({
  rawSearch,
  onSearchChange,
  totalCount,
  filteredCount,
  activeFilterLabels,
  viewMode,
  onViewModeChange,
  onExportCSV,
  onExportJSON,
  hasExportableResults,
}: LibraryCommandCenterProps) {
  const t = useTranslations("libraryPage");
  const tc = useTranslations("common");
  const viewModeOptions = [
    {
      value: "list-simple" as const,
      icon: <List className="h-4 w-4" />,
      label: t("viewListSimple"),
    },
    {
      value: "list-detail" as const,
      icon: <LayoutList className="h-4 w-4" />,
      label: t("viewListDetail"),
    },
    {
      value: "grid-2" as const,
      icon: <LayoutGrid className="h-4 w-4" />,
      label: t("viewGrid2"),
    },
    {
      value: "grid-3" as const,
      icon: <Grid3X3 className="h-4 w-4" />,
      label: t("viewGrid3"),
    },
  ];

  return (
    <CommandCenterContainer className="overflow-hidden">
      <div className="relative space-y-5 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {totalCount !== undefined && (
              <div className="flex items-center gap-1.5">
                {filteredCount !== undefined && filteredCount !== totalCount ? (
                  <>
                    <AnimatedCount
                      value={filteredCount}
                      className="text-lg font-semibold text-foreground"
                    />
                    <span className="text-muted-foreground">/ {totalCount} {tc("results")}</span>
                  </>
                ) : (
                  <>
                    <AnimatedCount
                      value={totalCount}
                      className="text-lg font-semibold text-foreground"
                    />
                    <span className="text-muted-foreground">{tc("results")}</span>
                  </>
                )}
              </div>
            )}
            {activeFilterLabels.map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CompactIconToggleGroup
              value={viewMode}
              onChange={onViewModeChange}
              options={viewModeOptions}
            />

            {hasExportableResults && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    title={t("exportLibrary")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onExportCSV}>
                    {t("exportAsCSV")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onExportJSON}>
                    {t("exportAsJSON")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <LibrarySearchBar
          value={rawSearch}
          onChange={onSearchChange}
          className="w-full"
          inputClassName="h-12 rounded-xl border-border/60 bg-background/85 text-sm shadow-sm sm:text-base"
          clearButtonClassName="h-8 w-8 rounded-lg"
        />
      </div>
    </CommandCenterContainer>
  );
}
