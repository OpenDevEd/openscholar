"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useRouter } from "next/navigation";
import { Trash2, Pencil, Check, X, Copy } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { Entry, EntryAction, EntryAside, EntryTile, ENTRY_OPEN, FullTextToggle, isGrid } from "@/components/command-center/entry";
import { useFullText } from "@/components/evidence-libraries/configuration/disclosure-button";
import { cn, createDefaultFilters } from "@/lib/utils";
import type { ViewMode } from "@/lib/types";
import { useAppToast } from "@/lib/toast";
import { submitNewSearch } from "@/lib/search/actions";
import type { BookmarkEntry } from "./types";

interface BookmarksItemProps {
  bookmark: BookmarkEntry;
  viewMode: ViewMode;
  isEditing: boolean;
  onEdit: () => void;
  onSaveEdit: (newExpansion: string) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

export function BookmarksItem({ bookmark, viewMode, isEditing, onEdit, onSaveEdit, onCancelEdit, onDelete }: BookmarksItemProps) {
  const toast = useAppToast();
  const tb = useTranslations("bookmarksPage");
  const tc = useTranslations("common");
  const tToast = useTranslations("toast");
  const format = useFormatter();
  const router = useRouter();
  const [editValue, setEditValue] = useState(bookmark.expansion);
  const expansionText = useFullText<HTMLButtonElement>(`${viewMode}|${isEditing}|${bookmark.expansion}`);
  const grid = isGrid(viewMode);
  const simple = viewMode === "list-simple";

  const save = () => {
    if (editValue.trim()) onSaveEdit(editValue.trim());
  };
  const cancel = () => {
    setEditValue(bookmark.expansion);
    onCancelEdit();
  };
  const startEdit = () => {
    setEditValue(bookmark.expansion);
    onEdit();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmark.expansion);
    } catch {
      toast.clipboard.copyFailed(tToast("entityExpansion"));
    }
  };

  // A search for the bookmark as it is typed: the name, then three periods.
  const useInSearch = () => {
    router.push(submitNewSearch(`${bookmark.name}...`, createDefaultFilters()).url);
  };

  // The bookmark's name, in its own colour. In the list views it sits in a column, so the expansions line up.
  // It sits above the entry's hit area so its full name can show when clipped; a click still uses it.
  const name = (
    <span className={cn("flex min-w-0", grid ? "flex-1" : "w-36 shrink-0")}>
      <TooltipHint label={bookmark.name} onlyWhenClipped>
        <EntryTile id={bookmark.name} className="relative z-10 inline-flex min-w-0 shrink font-mono font-medium" onClick={isEditing ? undefined : useInSearch}>
          <span className="truncate">{bookmark.name}</span>
        </EntryTile>
      </TooltipHint>
    </span>
  );

  const aside = (
    <EntryAside
      meta={
        <time dateTime={new Date(bookmark.createdAt).toISOString()} className={cn(simple && "max-sm:hidden")}>
          {format.dateTime(new Date(bookmark.createdAt), { month: "short", day: "numeric", year: "numeric" })}
        </time>
      }
      className={cn(!grid && "h-7 self-start")}
    >
      <EntryAction label={tb("copyExpansion")} icon={Copy} onClick={copy} />
      <EntryAction label={tc("edit")} icon={Pencil} onClick={startEdit} />
      <EntryAction label={tc("delete")} icon={Trash2} danger onClick={onDelete} />
    </EntryAside>
  );

  // What the bookmark expands to, cut to `clamp` until it is asked for in full.
  const open = (clamp: string, shape?: string) => (
    <button
      ref={expansionText.ref}
      type="button"
      aria-label={`${tb("useInSearchTooltip")}: ${bookmark.name}`}
      className={cn(ENTRY_OPEN, "font-normal", shape, !expansionText.expanded && clamp)}
      onClick={useInSearch}
    >
      {bookmark.expansion}
    </button>
  );

  const editor = simple ? (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Input
        aria-label={tb("expandsTo")}
        value={editValue}
        onChange={(event) => setEditValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") cancel();
        }}
        autoFocus
        className="h-8 font-mono text-sm"
      />
      <EntryAction label={tc("save")} icon={Check} onClick={save} />
      <EntryAction label={tc("cancel")} icon={X} onClick={cancel} />
    </div>
  ) : (
    <div className="min-w-0 flex-1 space-y-2">
      <Textarea
        aria-label={tb("expandsTo")}
        value={editValue}
        onChange={(event) => setEditValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") cancel();
        }}
        autoFocus
        className="max-h-72 min-h-24 font-mono text-sm"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={!editValue.trim()}>
          {tc("save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={cancel}>
          {tc("cancel")}
        </Button>
      </div>
    </div>
  );

  return (
    // In the one-line view everything lines up on the expansion's first line, also when it is shown in full.
    <Entry viewMode={viewMode} active={isEditing} className={cn(simple && !isEditing && "items-start")}>
      {grid ? (
        <>
          <div className="flex items-center gap-2">
            {name}
            {!isEditing && aside}
          </div>
          {isEditing ? editor : (
            <>
              {open(viewMode === "grid-2" ? "line-clamp-4" : "line-clamp-3")}
              <FullTextToggle text={expansionText} className="-ml-1.5 self-start" />
            </>
          )}
        </>
      ) : (
        <>
          {name}
          {isEditing ? editor : (
            <>
              {simple ? (
                <>
                  <span className="min-w-0">{open("truncate", "block w-full py-1")}</span>
                  <FullTextToggle text={expansionText} iconOnly className="mt-0.5" />
                  <span className="flex-1" />
                </>
              ) : (
                <div className="min-w-0 flex-1">
                  {open("line-clamp-3")}
                  <FullTextToggle text={expansionText} className="-ml-1.5 mt-1 flex" />
                </div>
              )}
              {aside}
            </>
          )}
        </>
      )}
    </Entry>
  );
}
