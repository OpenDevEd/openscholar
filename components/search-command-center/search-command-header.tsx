"use client";

import React, { useState } from "react";
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
import { appToast } from "@/lib/toast";
import { useSearchOptional } from "@/lib/search";
import { ModeTabs } from "./components/mode-tabs";
import { ViewModeToggleCompact } from "@/components/view-mode-toggle";
import { useIsTablet } from "@/lib/hooks";
import type { CommandCenterMode } from "./index";
import { cn } from "@/lib/utils";

interface SearchCommandHeaderProps {
  mode: CommandCenterMode;
  onModeChange: (mode: CommandCenterMode) => void;
  onDownloadAllJSON?: () => void;
  onDownloadAllCSV?: () => void;
  onDownloadAllEssentialJSON?: () => void;
  onDownloadAllEssentialCSV?: () => void;
  isLoading?: boolean;
}

export function SearchCommandHeader({
  mode,
  onModeChange,
  onDownloadAllJSON,
  onDownloadAllCSV,
  onDownloadAllEssentialJSON,
  onDownloadAllEssentialCSV,
  isLoading,
}: SearchCommandHeaderProps) {
  const [isCopied, setIsCopied] = useState(false);
  const search = useSearchOptional();
  const getShareableUrl = search?.getShareableUrl ?? (() => "");
  const isMobile = useIsTablet();

  const hasDownloadHandlers =
    onDownloadAllJSON ||
    onDownloadAllCSV ||
    onDownloadAllEssentialJSON ||
    onDownloadAllEssentialCSV;

  const handleCopyShareLink = async () => {
    try {
      const shareableUrl = getShareableUrl();
      await navigator.clipboard.writeText(shareableUrl);
      setIsCopied(true);
      appToast.clipboard.copied("Link");
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      appToast.clipboard.copyFailed("link");
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
        {!isMobile && <ViewModeToggleCompact />}

        {/* Download dropdown */}
        {hasDownloadHandlers && (
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
                  Download as JSON
                </DropdownMenuItem>
              )}
              {onDownloadAllCSV && (
                <DropdownMenuItem onClick={onDownloadAllCSV}>
                  Download as CSV
                </DropdownMenuItem>
              )}
              {onDownloadAllEssentialJSON && (
                <DropdownMenuItem onClick={onDownloadAllEssentialJSON}>
                  Download Essential Info (JSON)
                </DropdownMenuItem>
              )}
              {onDownloadAllEssentialCSV && (
                <DropdownMenuItem onClick={onDownloadAllEssentialCSV}>
                  Download Essential Info (CSV)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Share button */}
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
            <p>{isCopied ? "Copied!" : "Copy shareable link"}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
