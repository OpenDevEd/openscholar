"use client";

// Parts shared by the entries of the history, bookmarks and extraction lists:
// a row in the list views, a cell in the grid views.

import type { ComponentProps, ReactNode } from "react";
import type { AppIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { getIdColor } from "@/lib/format";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";

export const isGrid = (viewMode: ViewMode) => viewMode === "grid-2" || viewMode === "grid-3";
/** Views with room for an entry's second line and its chips. */
export const isRoomy = (viewMode: ViewMode) => viewMode === "list-detail" || viewMode === "grid-2";

const LAYOUT: Record<ViewMode, string> = {
  "list-simple": "flex items-center gap-3 px-4 py-2.5",
  "list-detail": "flex flex-wrap gap-3 p-4 sm:flex-nowrap",
  "grid-2": "flex h-full flex-col gap-2.5 border-b border-r border-border-subtle p-4",
  "grid-3": "flex h-full flex-col gap-2 border-b border-r border-border-subtle p-4",
};

/** One entry. `active` keeps its actions shown while one of them has something open. */
export function Entry({ viewMode, active, className, children, ...props }: { viewMode: ViewMode; active?: boolean } & ComponentProps<"div">) {
  return (
    <div className={cn("fade-enter", isGrid(viewMode) && "h-full")}>
      <div
        data-entry
        data-active={active || undefined}
        className={cn("group/entry relative transition-colors hover:bg-muted", LAYOUT[viewMode], className)}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

/** For the entry's title button or link: its hit area covers the whole entry. */
export const ENTRY_OPEN =
  "rounded-sm text-left text-sm font-medium outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring";

/**
 * The entry's time, and the actions that take its place while the entry is
 * pointed at, focused or active, so nothing moves and no space sits empty. A
 * touch screen has no pointer to wait for, so it shows both.
 */
export function EntryAside({ meta, className, children }: { meta: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("relative flex min-w-[5.25rem] shrink-0 items-center justify-end gap-1", className)}>
      {children ? (
        <div className="z-10 flex items-center transition-opacity [@media(hover:hover)]:absolute [@media(hover:hover)]:right-0 [@media(hover:hover)]:[[data-entry]:not(:hover,:focus-within,[data-active])_&]:opacity-0">
          {children}
        </div>
      ) : null}
      <span
        className={cn(
          "whitespace-nowrap text-xs tabular-nums text-muted-foreground transition-opacity",
          children && "group-hover/entry:opacity-0 group-data-[active]/entry:opacity-0 [@media(hover:hover)]:group-focus-within/entry:opacity-0",
        )}
      >
        {meta}
      </span>
    </div>
  );
}

/** An icon button among an entry's actions. */
export function EntryAction({ label, icon: Icon, danger = false, className, ...props }: { label: string; icon: AppIcon; danger?: boolean } & ComponentProps<typeof Button>) {
  return (
    <TooltipHint label={label}>
      <Button variant="ghost" size="icon" aria-label={label} className={cn("size-7 text-muted-foreground", danger && "hover:text-destructive", className)} {...props}>
        <Icon className="size-3.5" />
      </Button>
    </TooltipHint>
  );
}

/** A tile in the colour that belongs to `id` everywhere in the app. */
export function EntryTile({ id, className, style, ...props }: { id: string } & ComponentProps<"span">) {
  const color = getIdColor(id);
  return (
    <span
      className={cn("flex h-7 shrink-0 items-center justify-center rounded-lg border px-2 text-xs font-semibold tabular-nums", className)}
      style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border, ...style }}
      {...props}
    />
  );
}
