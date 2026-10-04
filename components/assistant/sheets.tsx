"use client";

// Cards that stack over the assistant panel, the way iOS stacks them: a new card
// slides in from the right, and the one underneath steps back, shifts left so its
// edge peeks out, and dims. Each layer is its own card; nothing sits behind them.

import { useDeferredValue, useState, type ReactNode } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Building2, Check, ChevronLeft, Eye, Link2, MessageSquare, Radio, Search, Share2, SquarePen, UserPlus, UserRound, X } from "@/components/icons";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipHint } from "@/components/ui/tooltip";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo-mark";
import { IconButton, WorkingText } from "./parts";

/** A sheet open over the panel. */
export type OpenSheet = { kind: "history" } | { kind: "share"; threadId: Id<"assistantThreads">; title: string; role: Role };
type Role = "owner" | "write" | "read";

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
        {/* The line keeps its height while empty, so the header doesn't grow when its text arrives. */}
        <p className="h-4 truncate text-xs text-muted-foreground">{detail}</p>
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
        className="relative flex size-6 items-center justify-center rounded-full text-2xs font-semibold ring-2 ring-card"
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
          <span className="relative flex size-6 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--info)_22%,var(--card))] text-info ring-2 ring-card">
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

function ChatRow({ chat, index, current, when, onOpen, onShare }: { chat: Chat; index: number; current: boolean; when: string; onOpen: () => void; onShare: () => void }) {
  const t = useTranslations("assistant");
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay: 0.06 + Math.min(index, 12) * 0.03 }}
      className={cn("group relative rounded-2xl", current ? "bg-primary/[0.07] ring-1 ring-inset ring-primary/25" : "hover:bg-muted/50")}
    >
      <button type="button" onClick={onOpen} aria-current={current ? "true" : undefined} className="block w-full rounded-2xl px-3 py-3 text-left">
        <span className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{chat.title}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground group-focus-within:invisible group-hover:invisible">{current ? t("openNow") : when}</span>
        </span>
        <span className="mt-1 flex h-6 items-center gap-3">
          <span className="flex min-w-0 flex-1 items-center">
            <Status chat={chat} />
          </span>
          <Members members={chat.members} organization={chat.organization} />
        </span>
      </button>
      {/* Out of the flow, so the hover action never adds height to the row. */}
      <div className="absolute right-2 top-2 hidden group-focus-within:block group-hover:block">
        <TooltipHint label={t("share")}>
          <button
            type="button"
            aria-label={t("shareNamed", { title: chat.title })}
            onClick={onShare}
            className="flex size-7 items-center justify-center rounded-full bg-card text-muted-foreground shadow-xs hover:text-foreground"
          >
            <Share2 className="size-3.5" />
          </button>
        </TooltipHint>
      </div>
    </motion.div>
  );
}

const DAY = 86_400_000;

export function HistorySheet({
  current,
  onBack,
  onOpen,
  onNew,
  onShare,
}: {
  current: ThreadId | null;
  onBack: () => void;
  onOpen: (id: ThreadId) => void;
  onNew: () => void;
  onShare: (id: ThreadId, title: string, role: Role) => void;
}) {
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
                  <ChatRow
                    key={chat._id}
                    chat={chat}
                    index={row++}
                    current={chat._id === current}
                    when={when(chat.lastMessageAt)}
                    onOpen={() => onOpen(chat._id)}
                    onShare={() => onShare(chat._id, chat.title, chat.role)}
                  />
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
    <motion.span className="flex text-success" animate={reduceMotion ? undefined : { opacity: [1, 0.35, 1] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}>
      <Radio className="size-3.5" />
    </motion.span>
  );
}

type Access = FunctionReturnType<typeof api.assistant.sharing.listAccess>["page"][number];
type Principal = Access["principal"];
/** A chat is shared with at most 50 people and organizations, so one page holds them all with its owner. */
const ACCESS_ROWS = 51;
const CANDIDATES_PER_PAGE = 8;
/** An organization's members are counted to here; past it the sheet says "100+". */
const MEMBERS_COUNTED = 100;
const keyOf = (principal: Principal) => (principal.kind === "user" ? principal.userId : principal.organizationId);

/** The round tile beside a person or an organization. */
function Tile({ principal, name }: { principal: Principal; name: string }) {
  const tint = principal.kind === "organization" ? "var(--info)" : tintOf(principal.userId);
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold" style={{ backgroundColor: `color-mix(in oklab, ${tint} 20%, transparent)`, color: tint }}>
      {principal.kind === "organization" ? <Building2 className="size-4" /> : name ? name.slice(0, 1).toUpperCase() : <UserRound className="size-4" />}
    </span>
  );
}

export function ShareSheet({ threadId, title, role, onBack }: { threadId: ThreadId; title: string; role: Role; onBack: () => void }) {
  const t = useTranslations("assistant");
  const toast = useAppToast();
  const { results } = usePaginatedQuery(api.assistant.sharing.listAccess, { threadId }, { initialNumItems: ACCESS_ROWS });
  // The owner first, then organizations, then people.
  const rank = (person: Access) => (person.role === "owner" ? 0 : person.principal.kind === "organization" ? 1 : 2);
  const people = [...results].sort((a, b) => rank(a) - rank(b));
  // The chat's owner shares it. The role came with the chat, so the sheet has its final layout from its first frame.
  const owner = role === "owner";
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const text = useDeferredValue(query.trim());
  const found = usePaginatedQuery(api.assistant.sharing.candidates, owner && adding ? (text ? { text } : {}) : "skip", { initialNumItems: CANDIDATES_PER_PAGE });
  const grant = useMutation(api.assistant.sharing.grant);
  const revoke = useMutation(api.assistant.sharing.revoke);
  const failed = (error: unknown) => toast.error(t("shareFailed"), getErrorMessage(error, ""));

  // Whoever is in the chat already is left out, and someone in several organizations shows once.
  const has = new Set(people.map((person) => keyOf(person.principal)));
  const suggestions = found.results.filter((candidate) => !has.has(keyOf(candidate.principal)) && has.add(keyOf(candidate.principal)));
  const loaded = found.status !== "LoadingFirstPage";
  const shownName = (person: { principal: Principal; name: string; email?: string }) =>
    person.principal.kind === "organization" ? t("everyoneIn", { organization: person.name }) : person.name || person.email || t("someone");
  const add = (principal: Principal) => {
    setQuery("");
    setActive(0);
    grant({ threadId, principal, role: "read" }).catch(failed);
  };
  const copy = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("chat", threadId);
    navigator.clipboard.writeText(url.toString()).then(() => setCopied(true), failed);
  };

  return (
    <>
      <SheetHeader title={t("shareChat")} detail={title} onBack={onBack} />
      <ScrollArea shades className="min-h-0 flex-1">
        <div className="space-y-4 px-3 py-3">
          {owner ? (
            // The suggestions open over the list below, at the box's width, so nothing under them moves.
            // They stay open while focus is anywhere in here, so Tab reaches them too.
            <div
              className="relative"
              onFocus={() => setAdding(true)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setAdding(false);
              }}
            >
              <label className="flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-background px-3 text-sm focus-within:border-primary/40">
                <UserPlus className="size-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => {
                    if (!suggestions.length) return;
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      add(suggestions[Math.min(active, suggestions.length - 1)]!.principal);
                    }
                  }}
                  role="combobox"
                  aria-expanded={adding && loaded}
                  aria-controls="assistant-share-suggestions"
                  placeholder={t("addPeople")}
                  aria-label={t("addPeople")}
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </label>
              {adding && loaded ? (
                <ul
                  id="assistant-share-suggestions"
                  role="listbox"
                  className="absolute inset-x-0 top-full z-20 mt-1 rounded-2xl border border-border/60 bg-popover p-1.5 shadow-[0_18px_50px_-18px_rgb(0_0_0/0.45)]"
                >
                  {suggestions.map((candidate, i) => (
                    <li key={keyOf(candidate.principal)} role="option" aria-selected={i === active}>
                      <button
                        type="button"
                        // Keeps focus in the box, so the list stays open for the next pick.
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => add(candidate.principal)}
                        className={cn("flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left", i === active && "bg-muted")}
                      >
                        <Tile principal={candidate.principal} name={candidate.name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{shownName(candidate)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{candidate.principal.kind === "organization" ? t("organization") : candidate.name ? candidate.email : ""}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {suggestions.length === 0 && found.status === "Exhausted" ? <li className="px-2.5 py-2 text-sm text-muted-foreground">{t("noCandidates")}</li> : null}
                  {/* A page looks through only so many members, so more may follow even after an empty one. */}
                  {found.status === "CanLoadMore" || found.status === "LoadingMore" ? (
                    <li>
                      <button
                        type="button"
                        disabled={found.status === "LoadingMore"}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => found.loadMore(CANDIDATES_PER_PAGE)}
                        className="flex h-8 w-full items-center rounded-xl px-2.5 text-xs font-medium text-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        {t("morePeople")}
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}
          <ul className="space-y-1">
            {people.map((person, i) => {
              const name = person.role === "owner" && owner ? t("you") : shownName(person);
              const detail =
                person.role === "owner"
                  ? t("owner")
                  : person.principal.kind === "organization"
                    ? (person.members ?? 0) > MEMBERS_COUNTED
                      ? t("membersMany", { count: MEMBERS_COUNTED })
                      : t("members", { count: person.members ?? 0 })
                    : person.name
                      ? (person.email ?? "")
                      : "";
              return (
                <motion.li
                  key={keyOf(person.principal)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE, delay: 0.12 + Math.min(i, 8) * 0.05 }}
                  className="flex items-center gap-3 rounded-xl px-2 py-2"
                >
                  <Tile principal={person.principal} name={person.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="truncate text-xs text-muted-foreground">{detail}</p>
                  </div>
                  {person.role === "owner" ? (
                    <span className="px-2 text-xs text-muted-foreground">{t("canChat")}</span>
                  ) : owner ? (
                    <>
                      <Segmented
                        label={t("accessOf", { name })}
                        value={person.role}
                        onChange={(role) => grant({ threadId, principal: person.principal, role }).catch(failed)}
                        options={[
                          { id: "read", label: t("view"), icon: Eye },
                          { id: "write", label: t("chat"), icon: MessageSquare },
                        ]}
                      />
                      <IconButton small label={t("remove")} icon={<X className="size-3.5" />} onClick={() => revoke({ threadId, principal: person.principal }).catch(failed)} />
                    </>
                  ) : (
                    <span className="px-2 text-xs text-muted-foreground">{person.role === "write" ? t("canChat") : t("canView")}</span>
                  )}
                </motion.li>
              );
            })}
          </ul>
          <p className="px-2 text-xs leading-relaxed text-muted-foreground">{t("shareNote")}</p>
        </div>
      </ScrollArea>
      <div className="border-t border-border/50 p-3">
        <button type="button" onClick={copy} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-muted/60 text-sm font-medium hover:bg-muted">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={copied ? "copied" : "copy"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="flex items-center gap-2"
            >
              {copied ? <Check className="size-4 text-success" /> : <Link2 className="size-4" />}
              {copied ? t("linkCopied") : t("copyLink")}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </>
  );
}
