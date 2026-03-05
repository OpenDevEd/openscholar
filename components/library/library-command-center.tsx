"use client";

import {
  Download,
  LayoutGrid,
  LayoutList,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { LibrarySearchBar } from "./library-search-bar";
import { Badge } from "@/components/ui/badge";
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
  const viewModeOptions = [
    {
      value: "list" as const,
      icon: <LayoutList className="h-4 w-4" />,
      label: t("viewList"),
    },
    {
      value: "grid" as const,
      icon: <LayoutGrid className="h-4 w-4" />,
      label: t("viewGrid"),
    },
  ];

  return (
    <CommandCenterContainer className="overflow-hidden">
      <div className="relative space-y-5 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {t("title")}
              </h1>
              {totalCount !== undefined && (
                <Badge
                  variant="secondary"
                  className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs font-medium"
                >
                  {t("paperCount", { count: totalCount })}
                </Badge>
              )}
              {filteredCount !== undefined &&
                totalCount !== undefined &&
                filteredCount !== totalCount && (
                  <Badge
                    variant="outline"
                    className="rounded-full border-border/60 bg-background/70 px-3 py-1 text-xs font-medium"
                  >
                    {filteredCount}/{totalCount}
                  </Badge>
                )}
            </div>

            {activeFilterLabels.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {activeFilterLabels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
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
