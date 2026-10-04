"use client";

// Cards that stack over the assistant panel, the way iOS stacks them: a new card
// slides in from the right, and the one underneath steps back, shifts left so its
// edge peeks out, and dims. Each layer is its own card; nothing sits behind them.

import { useDeferredValue, useState, type ReactNode } from "react";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { motion, useReducedMotion } from "motion/react";
import { Building2, ChevronLeft, Radio, Search, SquarePen, UserRound } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo-mark";
import { WorkingText } from "./parts";

export type SheetKind = "history";

export const SHEET_SPRING = { type: "spring" as const, stiffness: 300, damping: 32, mass: 0.9 };

/** Where a card sits with `depth` cards on top of it: smaller, and nudged left so its edge shows. */
export const stackedUnder = (depth: number) => ({ scale: 1 - depth * 0.07, x: depth * -22 });

/** One stacked layer. `depth` counts the sheets above it; 0 is the top. */
export function Sheet({ index, depth, children }: { index: number; depth: number; children: ReactNode }) {
  return (
    <motion.div
      role="dialog"
      aria-modal="false"
      tabIndex={-1}
      // eslint-disable-next-line jsx-a11y/no-autofocus -- a new sheet takes focus, like a dialog
      autoFocus
      className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[-18px_0_48px_-18px_rgb(0_0_0/0.55)] outline-none"
      style={{ transformOrigin: "0% 50%", zIndex: 20 + index }}
      initial={{ x: "calc(100% + 24px)", scale: 1 }}
      animate={stackedUnder(depth)}
      exit={{ x: "calc(100% + 24px)", scale: 1 }}
      transition={SHEET_SPRING}
    >
      {children}
      <Dim on={depth > 0} />
    </motion.div>
  );
}

/** The shade over a layer that has another on top of it. */
export function Dim({ on }: { on: boolean }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 rounded-2xl bg-black ring-1 ring-inset ring-white/10"
      initial={false}
      animate={{ opacity: on ? 0.22 : 0 }}
      transition={{ duration: 0.35, ease: EASE }}
    />
  );
}

function SheetHeader({ title, detail, onBack }: { title: string; detail?: string; onBack: () => void }) {
  const t = useTranslations("assistant");
  return (
    <div className="flex items-center gap-2 border-b border-border/50 px-3 py-3">
      <TooltipHint label={t("back")}>
        <button type="button" aria-label={t("back")} onClick={onBack} className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronLeft className="size-4" />
        </button>
      </TooltipHint>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}

type ThreadId = Id<"assistantThreads">;
type Chat = FunctionReturnType<typeof api.assistant.threads.list>["page"][number];
type Member = Chat["members"][number];
type Scope = "all" | "mine" | "shared";

const CHATS_PER_PAGE = 20;
/** One tint per person, picked from their ID, so someone keeps their colour in every chat. */
const TINTS = ["#2dd4bf", "#a78bfa", "#fb923c", "#60a5fa", "#f472b6", "#34d399", "#facc15", "#818cf8"];
const tintOf = (id: string) => TINTS[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TINTS.length]!;

/** A member's initial; someone in the chat right now gets a ring that ripples outward. */
function Avatar({ member }: { member: Member }) {
  const reduceMotion = useReducedMotion();
  const tint = tintOf(member.userId);
  return (
    <span className="relative flex size-6 shrink-0">
      {member.here && !reduceMotion ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ boxShadow: `0 0 0 1.5px ${tint}` }}
          animate={{ scale: [1.15, 1.7], opacity: [0.6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}
      <span
        className="relative flex size-6 items-center justify-center rounded-full text-[11px] font-semibold ring-2 ring-card"
        style={{
          backgroundColor: `color-mix(in oklab, ${tint} 24%, var(--card))`,
          color: tint,
          boxShadow: member.here ? `0 0 0 2px var(--card), 0 0 0 3.5px ${tint}` : undefined,
        }}
      >
        {member.name ? member.name.slice(0, 1).toUpperCase() : <UserRound className="size-3" />}
      </span>
    </span>
  );
}

function Members({ members, organization }: { members: Member[]; organization?: string }) {
  const t = useTranslations("assistant");
  if (!members.length && !organization) return null;
  return (
    <span className="flex shrink-0 items-center -space-x-1.5">
      {organization ? (
        <TooltipHint label={t("everyoneIn", { organization })}>
          <span className="relative flex size-6 items-center justify-center rounded-full bg-[color-mix(in_oklab,#60a5fa_22%,var(--card))] text-[#60a5fa] ring-2 ring-card">
            <Building2 className="size-3" />
          </span>
        </TooltipHint>
      ) : null}
      {members.map((member) => (
        <Avatar key={member.userId} member={member} />
      ))}
    </span>
  );
}

/** What a chat's row says under its title: a reply being written, who is in it, or its newest message. */
function Status({ chat }: { chat: Chat }) {
  const t = useTranslations("assistant");
  const format = useFormatter();
  const here = chat.members.filter((member) => member.here).map((member) => member.name || t("someone"));
  if (chat.writing) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
        <LogoMark size={18} working />
        <WorkingText>{t("writingReply")}</WorkingText>
      </span>
    );
  }
  if (here.length) return <span className="truncate text-xs font-medium text-foreground/90">{t("here", { count: here.length, names: format.list(here, { type: "conjunction" }) })}</span>;
  return <span className="truncate text-xs text-muted-foreground">{chat.preview}</span>;
}

function ChatRow({ chat, index, current, when, onOpen }: { chat: Chat; index: number; current: boolean; when: string; onOpen: () => void }) {
  const t = useTranslations("assistant");
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      aria-current={current ? "true" : undefined}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay: 0.06 + Math.min(index, 12) * 0.03 }}
      className={cn("block w-full rounded-2xl px-3 py-3 text-left", current ? "bg-primary/[0.07] ring-1 ring-inset ring-primary/25" : "hover:bg-muted/50")}
    >
      <span className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{chat.title}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{current ? t("openNow") : when}</span>
      </span>
      <span className="mt-1 flex h-6 items-center gap-3">
        <span className="flex min-w-0 flex-1 items-center">
          <Status chat={chat} />
        </span>
        <Members members={chat.members} organization={chat.organization} />
      </span>
    </motion.button>
  );
}

const DAY = 86_400_000;

export function HistorySheet({ current, onBack, onOpen, onNew }: { current: ThreadId | null; onBack: () => void; onOpen: (id: ThreadId) => void; onNew: () => void }) {
  const t = useTranslations("assistant");
  const format = useFormatter();
  const now = useNow().getTime();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  // The list follows the typing a beat behind, so every keystroke doesn't ask for a new one.
  const text = useDeferredValue(query.trim());
  const { results, status, loadMore } = usePaginatedQuery(api.assistant.threads.list, { scope, ...(text ? { text } : {}) }, { initialNumItems: CHATS_PER_PAGE });

  const today = new Date(now).setHours(0, 0, 0, 0);
  const live = (chat: Chat) => chat.writing || chat.members.some((member) => member.here);
  const when = (at: number) =>
    at >= today ? format.dateTime(at, { hour: "numeric", minute: "2-digit" }) : at >= today - 6 * DAY ? format.dateTime(at, { weekday: "short" }) : format.dateTime(at, { day: "numeric", month: "short" });
  const groups = [
    { id: "now", label: t("groupNow"), live: true, chats: results.filter(live) },
    { id: "today", label: t("groupToday"), live: false, chats: results.filter((chat) => !live(chat) && chat.lastMessageAt >= today) },
    { id: "earlier", label: t("groupEarlier"), live: false, chats: results.filter((chat) => !live(chat) && chat.lastMessageAt < today) },
  ].filter((group) => group.chats.length);
  const happening = groups[0]?.live ? groups[0].chats.length : 0;
  let row = 0;

  return (
    <>
      <SheetHeader title={t("chats")} detail={happening ? t("happeningNow", { count: happening }) : undefined} onBack={onBack} />
      <div className="space-y-2.5 px-3 pt-3">
        <div className="flex items-center gap-2">
          <label className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-border/60 bg-background px-3 text-sm focus-within:border-primary/40">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchChats")}
              aria-label={t("searchChats")}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </label>
          <TooltipHint label={t("newChat")}>
            <button type="button" aria-label={t("newChat")} onClick={onNew} className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary hover:bg-primary/15">
              <SquarePen className="size-4" />
            </button>
          </TooltipHint>
        </div>
        <Segmented
          label={t("whichChats")}
          value={scope}
          onChange={setScope}
          fill
          options={[
            { id: "all", label: t("scopeAll") },
            { id: "mine", label: t("scopeMine") },
            { id: "shared", label: t("scopeShared") },
          ]}
        />
      </div>
      {/* A filter change mounts a fresh list that fades and staggers in, with no wait for the old one to leave. */}
      <ScrollArea shades className="min-h-0 flex-1">
        <div className="px-2 pb-3 pt-3">
          <motion.div key={`${scope}|${text}`} className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
            {groups.map((group) => (
              <section key={group.id} className="space-y-1">
                <h3 className="flex items-center gap-1.5 px-3 pb-0.5 text-xs font-medium text-muted-foreground">
                  {group.live ? <LiveIcon /> : null}
                  {group.label}
                </h3>
                {group.chats.map((chat) => (
                  <ChatRow key={chat._id} chat={chat} index={row++} current={chat._id === current} when={when(chat.lastMessageAt)} onOpen={() => onOpen(chat._id)} />
                ))}
              </section>
            ))}
            {/* Nothing is said about an empty list until the list has loaded. */}
            {status !== "LoadingFirstPage" && results.length === 0 ? <p className="px-3 py-6 text-sm text-muted-foreground">{text || scope !== "all" ? t("noChatsMatch") : t("noChats")}</p> : null}
            {status === "CanLoadMore" || status === "LoadingMore" ? (
              <button
                type="button"
                disabled={status === "LoadingMore"}
                onClick={() => loadMore(CHATS_PER_PAGE)}
                className="mx-3 flex h-8 items-center rounded-full px-3 text-xs font-medium text-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {t("moreChats")}
              </button>
            ) : null}
          </motion.div>
        </div>
      </ScrollArea>
    </>
  );
}

/** A radio-wave icon that breathes, for the live group. */
function LiveIcon() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span className="flex text-emerald-500" animate={reduceMotion ? undefined : { opacity: [1, 0.35, 1] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}>
      <Radio className="size-3.5" />
    </motion.span>
  );
}
