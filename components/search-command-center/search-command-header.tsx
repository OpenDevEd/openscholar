"use client";

import { ensureQueryShortcuts } from "@/lib/keyword-validation-browser";
import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Share2, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppToast } from "@/lib/toast";
import { useSearchOptional } from "@/lib/search";
import { ModeTabs } from "./components/mode-tabs";
import { ViewModeSwitch } from "@/components/view-mode-toggle";
import { useUIStore } from "@/lib/store";
import { useIsTablet } from "@/lib/hooks";
import type { CommandCenterMode } from "./types";
import { cn } from "@/lib/utils";

interface SearchCommandHeaderProps {
  mode: CommandCenterMode;
  onModeChange: (mode: CommandCenterMode) => void;
  onDownloadAllJSON?: () => void;
  onDownloadAllCSV?: () => void;
  onDownloadAllEssentialJSON?: () => void;
  onDownloadAllEssentialCSV?: () => void;
  isLoading?: boolean;
  queryOnly?: boolean;
}

export function SearchCommandHeader({
  mode,
  onModeChange,
  onDownloadAllJSON,
  onDownloadAllCSV,
  onDownloadAllEssentialJSON,
  onDownloadAllEssentialCSV,
  isLoading,
  queryOnly = false,
}: SearchCommandHeaderProps) {
  const tc = useTranslations("common");
  const td = useTranslations("downloads");
  const toast = useAppToast();
  const tsc = useTranslations("searchCommand");
  const [isCopied, setIsCopied] = useState(false);
  const search = useSearchOptional();
  const getShareableUrl = search?.getShareableUrl ?? (() => "");
  const isMobile = useIsTablet();
  const { viewMode, setViewMode } = useUIStore();

  const hasDownloadHandlers =
    onDownloadAllJSON ||
    onDownloadAllCSV ||
    onDownloadAllEssentialJSON ||
    onDownloadAllEssentialCSV;

  const handleCopyShareLink = async () => {
    try {
      // The link carries the query with its shortcuts expanded, so they're read first.
      await ensureQueryShortcuts(search?.params.q);
      const shareableUrl = getShareableUrl();
      await navigator.clipboard.writeText(shareableUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      toast.clipboard.copyFailed(tsc("link"));
    }
  };

  return (
    <div
      className={cn(
        "relative flex items-center justify-between gap-4 px-4 py-3",
        "border-b border-border/40"
      )}
    >
      {/* Mode tabs */}
      <ModeTabs mode={mode} onChange={onModeChange} disabled={isLoading} />

      {/* Global actions */}
      <div className="flex items-center gap-2">
        {/* View mode toggle - desktop only */}
        {!isMobile && <ViewModeSwitch value={viewMode} onChange={setViewMode} />}

        {/* Download dropdown */}
        {hasDownloadHandlers && !queryOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <Download className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onDownloadAllJSON && (
                <DropdownMenuItem onClick={onDownloadAllJSON}>
                  {tc("downloadAsJson")}
                </DropdownMenuItem>
              )}
              {onDownloadAllCSV && (
                <DropdownMenuItem onClick={onDownloadAllCSV}>
                  {tc("downloadAsCsv")}
                </DropdownMenuItem>
              )}
              {onDownloadAllEssentialJSON && (
                <DropdownMenuItem onClick={onDownloadAllEssentialJSON}>
                  {td("downloadEssentialJSON")}
                </DropdownMenuItem>
              )}
              {onDownloadAllEssentialCSV && (
                <DropdownMenuItem onClick={onDownloadAllEssentialCSV}>
                  {td("downloadEssentialCSV")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Share button */}
        {!queryOnly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopyShareLink}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                {isCopied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isCopied ? tsc("copied") : tsc("copyShareLink")}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
