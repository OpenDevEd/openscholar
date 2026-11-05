"use client";

import { ensureQueryShortcuts } from "@/lib/keyword-validation-browser";
import { ItemPresence } from "@/components/workspaces/presence";
import React, { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Share2, Check, Copy, Download, History, MoreHorizontal, Move } from "@/components/icons";
import { ActivitySheet } from "@/components/workspaces/activity";
import { MoveDialog } from "@/components/workspaces/move-dialog";
import { useCurrentWorkspace } from "@/components/workspaces/parts";
import { SearchOrigin } from "@/components/workspaces/search-origin";
import { ShareButton } from "@/components/workspaces/share-dialog";
import { useResearchSession, useSearchAccess } from "@/lib/research/reads";
import { buildResultsUrl } from "@/lib/search-params";
import { paramsToSearchResult, searchResultToParams } from "@/lib/search-params/converters";
import { useSearchHistoryStore } from "@/lib/store";
import type { SearchResult } from "@/lib/types";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
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
  const [moveOpen, setMoveOpen] = useState(false);
  const ta = useTranslations("workspaces.activity");
  const tm = useTranslations("workspaces.move");
  const [shareOpen, setShareOpen] = useState(false);
  const tw = useTranslations("workspaces.share");
  const router = useWorkspaceRouter();
  const search = useSearchOptional();
  // Who ran the search and how it's shared, from the page's own read of it (#653).
  const access = useSearchAccess(queryOnly ? undefined : searchId);
  const guest = access?.guest !== undefined;
  // A search's Activity (#656), presence and Move, where the bar shows them: they are its workspace's, not a guest's.
  const hasActivity = !queryOnly && Boolean(searchId) && !guest;
  // An account's search in its own workspace is shared from here; signed out, and for a guest, the link is copied as before.
  const workspace = useCurrentWorkspace();
  const shares = useResearchSession() !== null && hasActivity && access !== undefined;
  // Someone else's search, a member's or one shared with you: as it shows now, saved as your own in the workspace you're in.
  const [copying, startCopy] = useTransition();
  const saveCopy = access && (guest || (access.by && !access.by.you)) && search
    ? () => {
        // A second press while the copy opens makes no second copy.
        if (copying) return;
        const entry = paramsToSearchResult(search.params);
        const id = useSearchHistoryStore.getState().addSearchResult(entry);
        startCopy(() => router.push(buildResultsUrl(id, searchResultToParams({ ...entry, id } as SearchResult))));
      }
    : null;
  const getShareableUrl = search?.getShareableUrl ?? (() => "");
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
        "relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3",
        "border-b border-border-subtle"
      )}
    >
      {/* Mode tabs, and beside them whose search this is when it isn't simply yours */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex shrink-0">
          <ModeTabs mode={mode} onChange={onModeChange} disabled={isLoading} />
        </span>
        {/* It takes the room the actions leave, cut short where there's little. */}
        {!queryOnly && searchId ? (
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <SearchOrigin searchId={searchId} />
          </span>
        ) : null}
      </div>

      {/* Global actions */}
      <div className="ms-auto flex items-center gap-2">
        {/* Who else has the search open (#657): first in this right-aligned group, so arriving faces move none of its controls. */}
        {hasActivity && searchId ? <ItemPresence kind="search" id={searchId} /> : null}
        {/* View mode toggle - desktop only */}
        <ViewModeSwitch value={viewMode} onChange={setViewMode} />

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
              {saveCopy ? (
                <DropdownMenuItem onSelect={saveCopy}>
                  <Copy className="size-4" />
                  {tsc("saveCopy")}
                </DropdownMenuItem>
              ) : null}
              {hasActivity ? (
                <DropdownMenuItem onSelect={() => setActivityOpen(true)}>
                  <History className="size-4" />
                  {ta("title")}
                </DropdownMenuItem>
              ) : null}
              {hasActivity ? (
                <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                  <Move className="size-4" />
                  {tm("toAnother")}
                </DropdownMenuItem>
              ) : null}
              {shares ? (
                <DropdownMenuItem onSelect={() => setShareOpen(true)}>
                  <Share2 className="size-4" />
                  {tw("shareThis.search")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => handleCopyShareLink({ fromMenu: true })}>
                  <Share2 className="size-4" />
                  {tsc("copyShareLink")}
                </DropdownMenuItem>
              )}
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
                aria-label={tc("download")}
                className="hidden h-8 w-8 text-muted-foreground hover:text-foreground md:inline-flex"
              >
                <Download className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* It downloads what's loaded, not the whole search. */}
              {search?.results.length ? <DropdownMenuLabel className="font-normal text-muted-foreground">{td("pageOnly", { count: search.results.length })}</DropdownMenuLabel> : null}
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

        {saveCopy ? (
          <TooltipHint label={tsc("saveCopy")}>
            <Button variant="ghost" size="icon" aria-label={tsc("saveCopy")} onClick={saveCopy} className="hidden h-8 w-8 text-muted-foreground hover:text-foreground md:inline-flex">
              <Copy className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
        {hasActivity ? (
          <TooltipHint label={ta("title")}>
            <Button variant="ghost" size="icon" aria-label={ta("title")} onClick={() => setActivityOpen(true)} className="hidden h-8 w-8 text-muted-foreground hover:text-foreground md:inline-flex">
              <History className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
        {hasActivity && searchId ? <ActivitySheet open={activityOpen} onOpenChange={setActivityOpen} kind="search" id={searchId} name={search?.params.q || tsc("currentQuery")} /> : null}
        {hasActivity ? (
          <TooltipHint label={tm("toAnother")}>
            <Button variant="ghost" size="icon" aria-label={tm("toAnother")} onClick={() => setMoveOpen(true)} className="hidden h-8 w-8 text-muted-foreground hover:text-foreground md:inline-flex">
              <Move className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
        {hasActivity && searchId ? <MoveDialog open={moveOpen} onOpenChange={setMoveOpen} kind="search" id={searchId} name={search?.params.q || tsc("currentQuery")} /> : null}

        {/* Share: its guests and its link, which carries the query with its shortcuts expanded, and an OQL query after its #. */}
        {shares && searchId ? (
          <ShareButton
            compact
            className="hidden md:inline-flex"
            open={shareOpen}
            onOpenChange={setShareOpen}
            kind="search"
            id={searchId}
            name={search?.params.q || tsc("currentQuery")}
            guests={access?.guests ?? 0}
            link={async () => {
              await ensureQueryShortcuts(search?.params.q);
              return getShareableUrl();
            }}
            note={workspace?.kind === "organization" ? tsc("linkOpensIn", { workspace: workspace.name }) : tsc("linkOpens")}
          />
        ) : null}
        {!queryOnly && !shares && (
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
