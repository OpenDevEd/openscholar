"use client";

// A list's Run by in an organization (#656): who made what, as faces ringed by their share, and a
// filter to one person's. The ring and count are the server's per-member counts
// (convex/workspaces/makers.ts); the list reads one person's with `by`. A person's own workspace
// is all theirs, so its lists have none.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Search, type AppIcon } from "@/components/icons";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { PersonName, tintOf } from "@/components/ui/identity";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Ring } from "@/components/ui/progress-ring";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useProtectedPaginatedQuery, useProtectedQuery } from "@/lib/auth/use-auth-query";
import { SHEET_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useWorkspaceSlug } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";

export type RunByTable = "searches" | "queryShortcuts" | "screeningJobs" | "extractionJobs" | "collections" | "assistantThreads";
type Member = FunctionReturnType<typeof api.workspaces.makers.counts>["page"][number];

/** The words for a count of each list's items. */
const NOUN = { searches: "searches", queryShortcuts: "bookmarks", screeningJobs: "screenings", extractionJobs: "extractions", collections: "collections", assistantThreads: "chats" } as const;

/** Members read for the filter at a time; "+N" reads more. You come first, on the first page. */
const MEMBERS = 100;
/** How many a search of everyone lists at once; typing narrows it. */
const LISTED = 50;

/**
 * A list's Run by in an organization: `by`, the person the list is narrowed to, for its read, and
 * `filter`, the row that picks them. The row is there from the first frame on an organization's
 * page, its faces arriving into it. A pick holds in the workspace it was made in.
 */
export function useRunBy(table: RunByTable, { label = "runBy", compact = false }: { label?: "runBy" | "startedBy" | "addedBy"; compact?: boolean } = {}) {
  const workspaceId = useWorkspace();
  const org = useWorkspaceSlug() !== undefined;
  const members = useProtectedPaginatedQuery(api.workspaces.makers.counts, inWorkspace(org ? workspaceId : undefined, { table }), { initialNumItems: MEMBERS });
  // Everyone's count is the organization's, those who've left included; chats keep none, so theirs is the members' sum.
  const { data: total } = useProtectedQuery(api.workspaces.makers.total, inWorkspace(org ? workspaceId : undefined, { table }));
  const people = members.status === "LoadingFirstPage" ? undefined : members.results;
  const more = members.status === "CanLoadMore" || members.status === "LoadingMore" ? { loading: members.status === "LoadingMore", load: () => members.loadMore(MEMBERS) } : undefined;
  const [picked, setPicked] = useState<{ workspaceId?: string; by: Id<"users"> | null }>({ by: null });
  const by = workspaceId && picked.workspaceId === workspaceId ? picked.by : null;
  const control = <RunByFilter people={people} total={total ?? undefined} more={more} noun={NOUN[table]} label={label} compact={compact} value={by} onChange={(next) => setPicked({ workspaceId, by: next })} />;
  return {
    by: by ?? undefined,
    filter: org ? (compact ? control : <RunByRow>{control}</RunByRow>) : null,
    /** Takes the filter off, for a "show everything" that shows everything. */
    clear: () => setPicked({ workspaceId, by: null }),
    /** How many one member made, once the counts are read. */
    countOf: (person: Id<"users">) => people?.find((member) => member.userId === person)?.count,
  };
}

/** A member's face in place of a row's icon: one component per person, so a row doesn't remount as it renders again. */
const FACES = new Map<string, AppIcon>();
export function faceOf(maker: { name: string; imageUrl?: string }): AppIcon {
  const key = `${maker.name}\n${maker.imageUrl ?? ""}`;
  let face = FACES.get(key);
  if (!face) {
    face = function Face({ className }: { className?: string }) {
      return (
        <span className={cn("flex", className)}>
          <IdentityAvatar name={maker.name} imageUrl={maker.imageUrl} className="size-5" />
        </span>
      );
    };
    FACES.set(key, face);
  }
  return face;
}

/** The filter as a list's own first row, scrolling sideways when it's crowded. */
function RunByRow({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto px-4 py-3 [scrollbar-width:none]">{children}</div>;
}

type More = { loading: boolean; load: () => void } | undefined;

function RunByFilter({ people, total: kept, more, noun, label, compact, value, onChange }: { people: Member[] | undefined; total: number | undefined; more: More; noun: (typeof NOUN)[RunByTable]; label: "runBy" | "startedBy" | "addedBy"; compact: boolean; value: Id<"users"> | null; onChange: (person: Id<"users"> | null) => void }) {
  const t = useTranslations("workspaces.runBy");
  const reduce = useReducedMotion();
  const members = people ?? [];
  const total = kept ?? members.reduce((sum, member) => sum + member.count, 0);
  const chosen = value ? members.find((member) => member.userId === value) : undefined;
  const shown = chosen ? chosen.count : total;
  const fit = compact ? 5 : 6;
  const busiest = [...members].sort((a, b) => b.count - a.count);
  // You first, then the busiest, while there's room; the rest behind "+N".
  const top = members.length > fit + 2 ? [...new Set([...members.filter((member) => member.you), ...busiest])].slice(0, fit) : members;
  const faces = chosen && !top.includes(chosen) ? [...top.slice(0, fit - 1), chosen] : top;
  const others = busiest.filter((member) => !faces.includes(member));
  // The thumb under the picked segment; one shared layout id, so it slides between them.
  const thumb = <motion.span layoutId={`run-by-thumb-${label}`} aria-hidden className="absolute inset-0 rounded-full bg-segment-active shadow-sm" transition={reduce ? { duration: 0 } : SHEET_SPRING} />;
  return (
    // In rem, so only large text wraps: at normal text the row keeps its one line while members arrive.
    <div className={compact ? "min-w-0" : "@container w-full min-w-0"}>
      <div className={cn("flex min-w-0 items-center gap-3", !compact && "@max-[15rem]:flex-wrap")}>
        {compact ? null : <span className="shrink-0 text-xs font-medium text-muted-foreground">{t(label)}</span>}
        <div role="radiogroup" aria-label={t(label)} className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full bg-segment p-0.5", compact ? "h-9" : "h-10")}>
          <button
            type="button"
            role="radio"
            aria-checked={value === null}
            onClick={() => onChange(null)}
            className={cn("relative rounded-full text-xs font-medium transition-colors", compact ? "h-8 px-3" : "h-9 px-3.5", value === null ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {value === null ? thumb : null}
            <span className="relative">{t("everyone")}</span>
          </button>
          {/* The members arrive into the row, each face fading in. */}
          <AnimatePresence initial={false}>
            {faces.map((member) => {
              // The one picked stands out; with no one picked, only those who made nothing step back.
              const back = value ? value !== member.userId : !member.count;
              return (
                <motion.span key={member.userId} className="flex" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={reduce ? { duration: 0 } : SHEET_SPRING}>
                  <TooltipHint label={member.name}>
                    <button type="button" role="radio" aria-checked={value === member.userId} aria-label={`${member.name}, ${t(noun, { count: member.count })}`} onClick={() => onChange(value === member.userId ? null : member.userId)} className={cn("relative flex rounded-full", compact ? "size-8" : "size-9")}>
                      {value === member.userId ? thumb : null}
                      <motion.span
                        className={cn("relative flex items-center justify-center", compact ? "size-8" : "size-9")}
                        initial={false}
                        animate={{ opacity: back ? 0.4 : 1 }}
                        whileHover={reduce ? { opacity: 1 } : { opacity: 1, scale: 1.08 }}
                        whileTap={reduce ? undefined : { scale: 0.94 }}
                        transition={reduce ? { duration: 0 } : SHEET_SPRING}
                      >
                        <Ring value={total ? member.count / total : 0} color={tintOf(member.userId)} />
                        <IdentityAvatar name={member.name} imageUrl={member.imageUrl} className={compact ? "size-6" : "size-7"} />
                      </motion.span>
                    </button>
                  </TooltipHint>
                </motion.span>
              );
            })}
          </AnimatePresence>
          {others.length || more ? <Everyone people={others} more={more} noun={noun} onPick={onChange} compact={compact} /> : null}
        </div>
        {/* One readout that changes with the pick, so nothing beside the control moves. */}
        {compact || !people ? null : (
          <span key={value ?? "everyone"} className="fade-enter flex min-w-0 items-baseline gap-1.5 truncate text-xs" aria-live="polite">
            {chosen ? <PersonName name={chosen.name} you={chosen.you} className="font-medium text-foreground" /> : null}
            <span className="shrink-0 tabular-nums text-muted-foreground">{t(noun, { count: shown })}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** "+N": everyone the faces leave out, busiest first, with a search, in a popover. */
function Everyone({ people, more: moreToRead, noun, onPick, compact }: { people: Member[]; more: More; noun: (typeof NOUN)[RunByTable]; onPick: (person: Id<"users">) => void; compact: boolean }) {
  const t = useTranslations("workspaces.runBy");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const matches = people.filter((member) => !text.trim() || member.name.toLowerCase().includes(text.trim().toLowerCase()));
  const more = t("more", { count: people.length });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipHint label={more}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={more} className={cn("flex shrink-0 items-center justify-center rounded-full px-2 text-2xs font-medium tabular-nums text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground", compact ? "h-8 min-w-8" : "h-9 min-w-9")}>
            +{people.length || ""}
          </button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border/50 p-2">
          <label className="flex h-9 items-center gap-2 rounded-lg bg-muted/60 px-2.5 text-sm">
            <Search className="size-3.5 text-muted-foreground" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the popover opens to find someone */}
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t("find")} aria-label={t("find")} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
          </label>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1">
          {matches.slice(0, LISTED).map((member) => (
            <li key={member.userId}>
              <button
                type="button"
                onClick={() => {
                  onPick(member.userId);
                  setOpen(false);
                  setText("");
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted"
              >
                <IdentityAvatar name={member.name} imageUrl={member.imageUrl} className="size-6" />
                <PersonName name={member.name} you={member.you} className="flex-1" />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-label={t(noun, { count: member.count })}>
                  {member.count}
                </span>
              </button>
            </li>
          ))}
          {!matches.length ? <li className="px-2 py-3 text-sm text-muted-foreground">{t("noOne")}</li> : null}
        </ul>
        {matches.length > LISTED ? <p className="border-t border-border/50 px-3 py-2 text-xs text-muted-foreground">{t("busiest", { listed: LISTED, count: matches.length })}</p> : null}
        {/* An organization past the first page of members reads the rest here. */}
        {moreToRead ? (
          <div className="border-t border-border/50 p-1">
            <button type="button" disabled={moreToRead.loading} onClick={moreToRead.load} className="flex h-8 w-full items-center justify-center rounded-md text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60">
              {t("showMore")}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
