"use client";

import { ensureQueryShortcuts } from "@/lib/keyword-validation-browser";
import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Share2, Check, Download, MoreHorizontal } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipHint,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast as sonnerToast } from "sonner";
import { useAppToast } from "@/lib/toast";
import { useSearchOptional } from "@/lib/search";
import { ModeTabs } from "./components/mode-tabs";
import { ViewModeSwitch } from "@/components/view-mode-toggle";
import { useUIStore } from "@/lib/store";
import { useIsMobile, useIsTablet } from "@/lib/hooks";
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
  // A phone has no room for the bar's icons: downloading and sharing share one menu.
  const isPhone = useIsMobile();
  const downloads = [
    { run: onDownloadAllJSON, label: tc("downloadAsJson") },
    { run: onDownloadAllCSV, label: tc("downloadAsCsv") },
    { run: onDownloadAllEssentialJSON, label: td("downloadEssentialJSON") },
    { run: onDownloadAllEssentialCSV, label: td("downloadEssentialCSV") },
  ].filter((item): item is { run: () => void; label: string } => item.run !== undefined);

  const handleCopyShareLink = async () => {
    try {
      // The link carries the query with its shortcuts expanded, so they're read first.
      await ensureQueryShortcuts(search?.params.q);
      const shareableUrl = getShareableUrl();
      await navigator.clipboard.writeText(shareableUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      // On a phone it's picked from a menu that closes, so the copy is confirmed apart.
      if (isPhone) sonnerToast.success(tsc("copied"));
    } catch {
      toast.clipboard.copyFailed(tsc("link"));
    }
  };

  return (
    <div
      className={cn(
        "relative flex items-center justify-between gap-4 px-4 py-3",
        "border-b border-border-subtle"
      )}
    >
      {/* Mode tabs */}
      <ModeTabs mode={mode} onChange={onModeChange} disabled={isLoading} />

      {/* Global actions */}
      <div className="flex items-center gap-2">
        {/* View mode toggle - desktop only */}
        {!isMobile && <ViewModeSwitch value={viewMode} onChange={setViewMode} />}

        {/* On a phone: one menu with the downloads and the share link */}
        {isPhone && !queryOnly ? (
          <DropdownMenu>
            <TooltipHint label={tc("more")}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={tc("more")} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipHint>
            <DropdownMenuContent align="end" className="min-w-52">
              {downloads.length ? (
                <>
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{tc("download")}</DropdownMenuLabel>
                  {downloads.map((item) => (
                    <DropdownMenuItem key={item.label} onSelect={item.run}>
                      <Download className="size-4" />
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem onSelect={handleCopyShareLink}>
                <Share2 className="size-4" />
                {tsc("copyShareLink")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {/* Download dropdown */}
        {downloads.length > 0 && !queryOnly && !isPhone && (
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
        {!queryOnly && !isPhone && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopyShareLink}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                {isCopied ? (
                  <Check className="h-4 w-4 text-success" />
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
