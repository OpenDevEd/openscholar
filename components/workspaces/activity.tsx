"use client";

// An item's Activity (#656): every change to it, by whom, newest first, a page at a time, and
// the row that opens it at the top of an item's card, with who started the item in an organization.

import { useState, type ReactNode } from "react";
import { ItemPresence } from "./presence";
import { GuestChips, type From } from "./shared";
import { MoveDialog, type Movable } from "./move-dialog";
import { usePaginatedQuery, type UsePaginatedQueryReturnType } from "convex/react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { AiIcon, ArrowRight, FileSearch, FolderPlus, History, ListChecks, Move, Pause, PenLine, Play, Plus, RotateCcw, Share2, Square, Star, Trash2, type AppIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { PersonTag, YouTag } from "@/components/ui/identity";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { GuestRole } from "@/convex/sharing/validators";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";

export type ItemKind = "collection" | "search" | "screening" | "extraction" | "author";
type Row = FunctionReturnType<typeof api.activity.queries.list>["page"][number];
type Happened = Row["happened"];

const LOOK: Record<Happened, { icon: AppIcon; tint: string; counted: boolean }> = {
  created: { icon: FolderPlus, tint: "#94a3b8", counted: false },
  renamed: { icon: PenLine, tint: "#a78bfa", counted: false },
  edited: { icon: PenLine, tint: "#d9a27c", counted: false },
  added: { icon: Plus, tint: "#34d399", counted: true },
  removed: { icon: Trash2, tint: "#f87171", counted: true },
  rated: { icon: Star, tint: "#facc15", counted: true },
  answered: { icon: ListChecks, tint: "#2dd4bf", counted: true },
  screened: { icon: ListChecks, tint: "#2dd4bf", counted: true },
  extracted: { icon: FileSearch, tint: "#818cf8", counted: true },
  paused: { icon: Pause, tint: "#fbbf24", counted: false },
  resumed: { icon: Play, tint: "#34d399", counted: false },
  retried: { icon: RotateCcw, tint: "#60a5fa", counted: true },
  stopped: { icon: Square, tint: "#f87171", counted: false },
  moved: { icon: ArrowRight, tint: "#fb923c", counted: false },
  shared: { icon: Share2, tint: "#60a5fa", counted: false },
};

/** Changes one page of Activity shows, and each page more. */
const PAGE = 20;
const DAY = 86_400_000;

/**
 * The first row of an item's card: in an organization who started it (`started`, such as "Run by"),
 * then who has it open, its Activity and Move, and its Share where the page gives one (`share`).
 * For a guest of the item (`guest`, #653) the row says whose it is and what they may do with it:
 * the rest is its workspace's. `className` fits it to the card's edges.
 */
export function ItemBar({ kind, id, name, started, className, share, guest }: { kind: ItemKind; id: string; name: string; started: "runBy" | "madeBy"; className?: string; share?: ReactNode; guest?: { from: From; role: GuestRole } }) {
  const t = useTranslations("workspaces.activity");
  const workspaceId = useWorkspace();
  // Null in your own workspace, where everything is yours.
  const { data: by } = useProtectedQuery(api.activity.queries.startedBy, inWorkspace(workspaceId, guest ? "skip" : { kind, id }));
  return (
    <div className={cn("flex min-h-13 min-w-0 items-center gap-2 border-b border-border-subtle px-4 py-2.5", className)}>
      {guest ? (
        <GuestChips from={guest.from} role={guest.role} person votes={kind === "screening"} />
      ) : (
        <>
          {by ? <PersonTag name={by.name} imageUrl={by.imageUrl} you={by.you} before={t(started)} /> : null}
          {/* One element pushes the rest right, so an empty room costs no gap that who started it needs on a phone. */}
          <span className="ms-auto flex">
            <ItemPresence kind={kind} id={id} />
          </span>
          <ActivityButton kind={kind} id={id} name={name} />
          <MoveButton kind={kind} id={id} name={name} />
          {share}
        </>
      )}
    </div>
  );
}

/** An item's Move button (#654), and the dialog it opens. On a phone the item's buttons are icons, so who ran it keeps its room. */
export function MoveButton({ kind, id, name }: { kind: Movable; id: string; name: string }) {
  const t = useTranslations("workspaces.move");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" className="h-8 shrink-0 max-sm:w-8 max-sm:px-0" onClick={() => setOpen(true)}>
        <Move />
        <span className="max-sm:sr-only">{t("move")}</span>
      </Button>
      <MoveDialog open={open} onOpenChange={setOpen} kind={kind} id={id} name={name} />
    </>
  );
}

/** An item's Activity button, and the sheet it opens. An open collection has it at the end of the library's heading. */
export function ActivityButton({ kind, id, name }: { kind: ItemKind; id: string; name: string }) {
  const t = useTranslations("workspaces.activity");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" className="h-8 shrink-0 max-sm:w-8 max-sm:px-0" onClick={() => setOpen(true)}>
        <History />
        <span className="max-sm:sr-only">{t("title")}</span>
      </Button>
      <ActivitySheet open={open} onOpenChange={setOpen} kind={kind} id={id} name={name} />
    </>
  );
}

export function ActivitySheet({ open, onOpenChange, kind, id, name }: { open: boolean; onOpenChange: (open: boolean) => void; kind: ItemKind; id: string; name: string }) {
  const t = useTranslations("workspaces.activity");
  const workspaceId = useWorkspace();
  // Read here, while the sheet is shut, so it opens with its rows in it.
  const rows = usePaginatedQuery(api.activity.queries.list, inWorkspace(workspaceId, { kind, id }), { initialNumItems: PAGE });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border/50 px-5 py-4">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription className="truncate">{name}</SheetDescription>
        </SheetHeader>
        <ActivityRows rows={rows} />
      </SheetContent>
    </Sheet>
  );
}

function ActivityRows({ rows: { results, status, loadMore } }: { rows: UsePaginatedQueryReturnType<typeof api.activity.queries.list> }) {
  const t = useTranslations("workspaces.activity");
  const now = useNow();
  // The sheet opens with its rows. Opened before they were read, they fade in when they come.
  const [late] = useState(status === "LoadingFirstPage");
  // Calendar days, from this morning's midnight: 23:00 last night is yesterday at 01:00.
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const dayOf = (at: number) => (at >= midnight ? "today" : at >= midnight - DAY ? "yesterday" : at >= midnight - 6 * DAY ? "thisWeek" : "earlier");
  const groups = results.reduce<Array<{ day: ReturnType<typeof dayOf>; rows: Row[] }>>((all, row) => {
    const day = dayOf(row.at);
    const last = all.at(-1);
    if (last?.day === day) last.rows.push(row);
    else all.push({ day, rows: [row] });
    return all;
  }, []);
  if (status === "LoadingFirstPage") return <div className="flex-1" aria-busy />;
  return (
    <>
      <ScrollArea shades className={cn("min-h-0 flex-1", late && "animate-in fade-in-0 duration-200")}>
        {results.length ? (
          <div className="space-y-5 px-3 py-4">
            {groups.map((group) => (
              <section key={group.day} className="space-y-1">
                <h3 className="px-2 text-xs font-medium text-muted-foreground">{t(group.day)}</h3>
                <ul>
                  {group.rows.map((row) => (
                    <li key={row._id}>
                      <ActivityRow row={row} now={now} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("none")}</p>
        )}
      </ScrollArea>
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <div className="border-t border-border/50 p-3">
          <Button variant="ghost" className="h-9 w-full" disabled={status === "LoadingMore"} onClick={() => loadMore(PAGE)}>
            {t("showEarlier")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function ActivityRow({ row, now }: { row: Row; now: Date }) {
  const t = useTranslations("workspaces.activity");
  const format = useFormatter();
  const look = LOOK[row.happened];
  const Icon = look.icon;
  // A renamed item shows the name it had beside the verb, a moved one the workspace it came from, a shared one who it went to; other details sit in a chip under it.
  const inline = (row.happened === "renamed" || row.happened === "moved" || row.happened === "shared") && row.detail;
  return (
    <div className="flex gap-3 rounded-xl px-2 py-2.5">
      <span className="relative mt-0.5 shrink-0 self-start">
        <IdentityAvatar name={row.by.name} imageUrl={row.by.imageUrl} className="size-8" />
        <span className="absolute -bottom-1 -end-1 flex size-4 items-center justify-center rounded-full ring-2 ring-background" style={{ backgroundColor: `color-mix(in oklab, ${look.tint} 30%, var(--background))`, color: look.tint }}>
          <Icon className="size-2.5" />
        </span>
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm leading-snug">
          <span className="font-medium">{row.by.name}</span>
          {row.by.you ? <YouTag className="ms-1.5 inline-block align-[1px]" /> : null}{" "}
          <span className="text-muted-foreground">{look.counted ? t(row.happened, { count: row.count ?? 1 }) : t(row.happened)}</span>
          {inline ? <span className="font-medium"> {row.detail}</span> : null}
        </p>
        {(row.detail && !inline) || row.viaAssistant ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {row.detail && !inline ? <span className="inline-flex h-6 min-w-0 max-w-full items-center truncate rounded-full bg-muted px-2.5 text-xs">{row.detail}</span> : null}
            {row.viaAssistant ? (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-xs text-primary">
                <AiIcon className="size-3.5" /> {t("viaAssistant")}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <span className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{format.relativeTime(row.at, now)}</span>
    </div>
  );
}
