"use client";

import { ensureQueryShortcuts } from "@/lib/keyword-validation-browser";
import { ItemPresence } from "@/components/workspaces/presence";
import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Share2, Check, Download, History, MoreHorizontal } from "@/components/icons";
import { ActivitySheet } from "@/components/workspaces/activity";
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
  /** The search shown, whose Activity the bar opens. */
  searchId?: string;
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
  searchId,
}: SearchCommandHeaderProps) {
  const tc = useTranslations("common");
  const td = useTranslations("downloads");
  const toast = useAppToast();
  const tsc = useTranslations("searchCommand");
  const [isCopied, setIsCopied] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const ta = useTranslations("workspaces.activity");
  // A search's Activity (#656), where the bar shows one.
  const hasActivity = !queryOnly && Boolean(searchId);
  const search = useSearchOptional();
  const getShareableUrl = search?.getShareableUrl ?? (() => "");
  const isMobile = useIsTablet();
  const { viewMode, setViewMode } = useUIStore();
  // A phone has no room for the bar's icons: downloading and sharing share one menu, shown below md as useIsMobile counts a phone.
  const downloads = [
    { run: onDownloadAllJSON, label: tc("downloadAsJson") },
    { run: onDownloadAllCSV, label: tc("downloadAsCsv") },
    { run: onDownloadAllEssentialJSON, label: td("downloadEssentialJSON") },
    { run: onDownloadAllEssentialCSV, label: td("downloadEssentialCSV") },
  ].filter((item): item is { run: () => void; label: string } => item.run !== undefined);

  const handleCopyShareLink = async ({ fromMenu = false } = {}) => {
    try {
      // The link carries the query with its shortcuts expanded, so they're read first.
      await ensureQueryShortcuts(search?.params.q);
      const shareableUrl = getShareableUrl();
      await navigator.clipboard.writeText(shareableUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      // Picked from the phone's menu, which closes, the copy is confirmed apart.
      if (fromMenu) sonnerToast.success(tsc("copied"));
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
        {!queryOnly ? (
          <DropdownMenu>
            <TooltipHint label={tc("more")}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={tc("more")} className="h-8 w-8 text-muted-foreground hover:text-foreground md:hidden">
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
              {hasActivity ? (
                <DropdownMenuItem onSelect={() => setActivityOpen(true)}>
                  <History className="size-4" />
                  {ta("title")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => handleCopyShareLink({ fromMenu: true })}>
                <Share2 className="size-4" />
                {tsc("copyShareLink")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {/* Download dropdown */}
        {downloads.length > 0 && !queryOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden h-8 w-8 text-muted-foreground hover:text-foreground md:inline-flex"
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

        {/* Who else has the search open (#657), beside its Activity. */}
        {hasActivity && searchId ? <ItemPresence kind="search" id={searchId} /> : null}
        {hasActivity ? (
          <TooltipHint label={ta("title")}>
            <Button variant="ghost" size="icon" aria-label={ta("title")} onClick={() => setActivityOpen(true)} className="hidden h-8 w-8 text-muted-foreground hover:text-foreground md:inline-flex">
              <History className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
        {hasActivity && searchId ? <ActivitySheet open={activityOpen} onOpenChange={setActivityOpen} kind="search" id={searchId} name={search?.params.q || tsc("currentQuery")} /> : null}

        {/* Share button */}
        {!queryOnly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleCopyShareLink()}
                className="hidden h-8 w-8 text-muted-foreground hover:text-foreground md:inline-flex"
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
