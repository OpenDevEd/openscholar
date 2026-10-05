"use client";

// Cards that stack over the assistant panel, the way iOS stacks them: a new card
// slides in from the right, and the one underneath steps back, shifts left so its
// edge peeks out, and dims. Each layer is its own card; nothing sits behind them.

import { useDeferredValue, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Building2, Check, ChevronLeft, CircleCheck, CircleHelp, CirclePause, Coins, Eye, Link2, Loader2, Lock, MessageSquare, Radio, Search, Share2, SquarePen, UserPlus, UserRound, X } from "@/components/icons";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { EASE } from "@/components/settings/model-map";
import { AnimatedNumber } from "@/components/screening/parts";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { ASSISTANT_JOB_CAPS } from "@/convex/lib/constants";
import { viewOf } from "@/lib/assistant/actions";
import { topUpBundles } from "@/lib/billing/catalog";
import { useBillingCatalog } from "@/lib/billing/catalog-provider";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { OrbitMark } from "./orbit-mark";
import { IconButton, WorkingText } from "./parts";
import { KindTile, type Waiting } from "./steps";

/** A sheet open over the panel. */
export type OpenSheet =
  | { kind: "history" }
  | { kind: "share"; threadId: Id<"assistantThreads">; title: string; role: Role }
  | { kind: "spending"; threadId: Id<"assistantThreads">; title: string }
  | { kind: "topUp"; waiting: Waiting };
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
        <OrbitMark size={18} motion="thinking" />
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

/** A spending limit, in credits; null is none. */
type Limit = number | null;
/** The limits a reply's picker lists before Custom and No limit. */
const REPLY_LIMITS = [10, 15, 25, 50] as const;
/** Digits a person's own limit can have: what the server takes, and a number holds exactly. */
const CUSTOM_DIGITS = 15;
/** Jobs the Spending sheet lists at first, and with each "More jobs". */
const JOBS_FIRST = 5;
const JOBS_MORE = 20;
/** Replies the chart has room for: what the server keeps (convex/assistant/validators.ts). */
const CHART_REPLIES = 12;

/**
 * Picks a spending limit: the listed ones, then Custom, which opens a field for any whole
 * number from 1, then No limit. The mock's picker, which a job's limit will use too (#328).
 */
function LimitPicker({ label, listed, value, onChange }: { label: string; listed: readonly number[]; value: Limit; onChange: (limit: Limit) => void }) {
  const t = useTranslations("assistant.spendingSheet");
  const format = useFormatter();
  // Custom was picked, or its field typed in: it stays on for a number that matches a listed limit.
  const [chosen, setChosen] = useState(value !== null && !listed.includes(value));
  // A limit that isn't listed is the person's own wherever it came from, a change here that didn't save included.
  const custom = value !== null && (chosen || !listed.includes(value));
  // The person's own number, kept while another limit is picked.
  const [own, setOwn] = useState(value ?? listed[0]!);
  // What the field holds while it's typed in. Left alone, it shows the limit in force.
  const [typed, setTyped] = useState<string | null>(null);
  const number = value !== null && custom ? value : own;
  const field = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex items-center gap-3 pl-1">
        <span className="shrink-0 text-xs text-muted-foreground">{t("upTo")}</span>
        <div className="min-w-0 flex-1">
          <Segmented
            fill="labels"
            label={label}
            value={value === null ? "none" : custom ? "custom" : String(value)}
            onChange={(picked) => {
              if (picked === "none") return onChange(null);
              if (picked !== "custom") {
                setChosen(false);
                return onChange(Number(picked));
              }
              // Custom starts from the limit in force, or from the person's last own number when there's none.
              const start = value ?? own;
              setChosen(true);
              setOwn(start);
              setTyped(null);
              onChange(start);
              // The field takes the keyboard once it's open, its number selected to type over.
              requestAnimationFrame(() => field.current?.select());
            }}
            options={[...listed.map((limit) => ({ id: String(limit), label: format.number(limit) })), { id: "custom", label: t("custom") }, { id: "none", label: t("noLimit") }]}
          />
        </div>
      </div>
      {/* The field opens under the row: the frame grows, its content laid out at full size, and its gap is inside it. */}
      <motion.div inert={!custom} initial={false} animate={custom ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
        <label className="mt-2 flex h-9 items-center gap-2 rounded-xl border border-border/60 bg-background px-3 text-sm focus-within:border-primary/40">
          <Coins className="size-3.5 text-muted-foreground" />
          <input
            ref={field}
            inputMode="numeric"
            value={typed ?? String(number)}
            onChange={(e) => {
              const digits = e.target.value.replace(/^0+/, "");
              // Whole numbers only, as they were typed: "1.5" pasted in isn't read as 15, and a number too long isn't cut into another.
              if (!/^\d*$/.test(digits) || digits.length > CUSTOM_DIGITS) return;
              setChosen(true);
              setTyped(digits);
              if (!digits) return;
              setOwn(Number(digits));
              onChange(Number(digits));
            }}
            // Left, it shows the number in force: what was typed if it saved, the limit as it was if it didn't.
            onBlur={() => setTyped(null)}
            aria-label={t("own", { label })}
            className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
          />
          <span className="shrink-0 text-xs text-muted-foreground">{t("credits", { count: number })}</span>
        </label>
      </motion.div>
    </div>
  );
}

/** What jobs that spend credits may hold without asking; null when each one asks. */
type Allowance = { cap: Limit } | null;
type Limits = { replyLimit: Limit; allowance: Allowance };
const sameAllowance = (a: Allowance, b: Allowance) => (a === null) === (b === null) && a?.cap === b?.cap;
/** New chats start with this chat's limits, and go on taking them as they change here: the server's rule (convex/assistant/spending.ts). */
const takenByNewChats = (now: Limits & { newChats?: Limits }) => now.newChats !== undefined && now.newChats.replyLimit === now.replyLimit && sameAllowance(now.newChats.allowance, now.allowance);
/** A change to this chat's limits, as it shows at once: new chats that take them take the change too. */
export const changed = <Read extends Limits & { newChats?: Limits }>(now: Read, change: Partial<Limits>): Read => {
  const next = { ...now, ...change };
  return takenByNewChats(now) ? { ...next, newChats: { replyLimit: next.replyLimit, allowance: next.allowance } } : next;
};

/**
 * What the person lets the assistant spend in this chat (#346): how many credits a reply
 * may spend before it pauses and asks, against what their last replies cost. The limits on
 * jobs that spend credits join it with the jobs themselves (#328).
 */
export function SpendingSheet({ threadId, title, onBack }: { threadId: ThreadId; title: string; onBack: () => void }) {
  const t = useTranslations("assistant.spendingSheet");
  const toast = useAppToast();
  // The panel reads this for the open chat too, so the sheet opens with it in hand.
  const spending = useQuery(api.assistant.spending.get, { threadId });
  // A pick shows at once, ahead of the server's copy.
  const setLimit = useMutation(api.assistant.spending.setReplyLimit).withOptimisticUpdate((store, args) => {
    const now = store.getQuery(api.assistant.spending.get, { threadId: args.threadId });
    if (now) store.setQuery(api.assistant.spending.get, { threadId: args.threadId }, changed(now, { replyLimit: args.limit }));
  });
  const setAllowance = useMutation(api.assistant.spending.setAllowance).withOptimisticUpdate((store, args) => {
    const now = store.getQuery(api.assistant.spending.get, { threadId: args.threadId });
    if (now) store.setQuery(api.assistant.spending.get, { threadId: args.threadId }, changed(now, { allowance: args.allowance }));
  });
  const setForNewChats = useMutation(api.assistant.spending.setForNewChats).withOptimisticUpdate((store, args) => {
    const now = store.getQuery(api.assistant.spending.get, { threadId: args.threadId });
    if (!now) return;
    const { newChats: _was, ...rest } = now;
    store.setQuery(api.assistant.spending.get, { threadId: args.threadId }, args.on ? { ...rest, newChats: { replyLimit: now.replyLimit, allowance: now.allowance } } : rest);
  });
  const failed = (error: unknown) => toast.error(t("failed"), getErrorMessage(error, ""));
  const limit = spending?.replyLimit ?? null;
  // Oldest first, in the chart's last slots: the newest reply is on the right.
  const recent = spending?.recent ?? [];
  const paused = limit === null ? 0 : recent.filter((spent) => spent > limit).length;
  // The number the headline holds while there's no limit and it's faded out: the last one there was.
  const [number, setNumber] = useState<number>(REPLY_LIMITS[0]);
  const shown = limit ?? number;
  // The chart's top: just above the largest reply, so a higher limit sits on its top edge.
  const top = Math.max(...recent, 1) * 1.15;
  const allowance = spending?.allowance ?? null;
  // What one job may hold, kept while every job asks, so allowing them again starts from it.
  const [kept, setKept] = useState<Limit>(ASSISTANT_JOB_CAPS[0]);
  const cap = allowance ? allowance.cap : kept;
  // The chat's calls that held credits, the largest first, more of them when the person asks.
  const jobs = usePaginatedQuery(api.assistant.spending.jobs, { threadId }, { initialNumItems: JOBS_FIRST });
  const account = useQuery(api.billing.accounts.mine, {});
  // The server's rule (convex/assistant/spending.ts): allowed, within what one may hold, and covered by the balance.
  const runs = (credits: number) => allowance !== null && (allowance.cap === null || credits <= allowance.cap) && credits <= Math.floor(account?.balance ?? 0);
  const ta = useTranslations("assistant");
  return (
    <>
      <SheetHeader title={t("title")} detail={title} onBack={onBack} />
      <ScrollArea shades className="min-h-0 flex-1">
        {/* Laid out from the first frame at its size; what it says shows once it's known. */}
        <div inert={spending === undefined} className={cn("space-y-6 px-3 py-4 transition-opacity duration-200", spending === undefined && "opacity-0")}>
          <Zone label={t("eachReply")}>
            <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
              {/* Both headlines hold one cell, so the card never changes size between a limit and none. */}
              <div className="grid px-1 [&>*]:col-start-1 [&>*]:row-start-1">
                <motion.div initial={false} animate={{ opacity: limit === null ? 0 : 1 }} aria-hidden={limit === null} className="flex min-w-0 items-baseline gap-2">
                  <span className="text-3xl font-semibold tracking-tight">
                    <AnimatedNumber value={shown} />
                  </span>
                  <span className="min-w-0 truncate text-sm text-muted-foreground">{t("limit", { count: shown })}</span>
                </motion.div>
                <motion.div initial={false} animate={{ opacity: limit === null ? 1 : 0 }} aria-hidden={limit !== null} className="flex min-w-0 items-baseline gap-2">
                  <span className="whitespace-nowrap text-3xl font-semibold tracking-tight">{t("noLimit")}</span>
                  <span className="min-w-0 truncate text-sm text-muted-foreground">{t("noLimitDetail")}</span>
                </motion.div>
              </div>
              {/* The person's last replies against the limit: the ones over the line would have paused. */}
              <div className="relative mt-4 flex h-20 items-end gap-1 px-1" aria-hidden>
                {Array.from({ length: CHART_REPLIES }, (_, slot) => {
                  const spent = recent[slot - (CHART_REPLIES - recent.length)];
                  return (
                    <span
                      key={slot}
                      className={cn("flex-1 rounded-t-[3px] transition-colors duration-300", spent !== undefined && limit !== null && spent > limit ? "bg-amber-400" : "bg-foreground/15")}
                      style={{ height: spent === undefined ? 0 : `${(Math.min(spent, top) / top) * 100}%` }}
                    />
                  );
                })}
                <motion.span
                  className="absolute inset-x-0 border-t border-dashed border-foreground/40"
                  initial={false}
                  animate={{ bottom: `${Math.min(1, shown / top) * 100}%`, opacity: limit === null ? 0 : 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 30 }}
                />
              </div>
              {/* The line keeps its room when there's nothing to say yet, and takes a second one in a narrow panel. */}
              <p className="mt-2 flex min-h-4 items-start gap-1.5 px-1 text-xs text-muted-foreground">
                {recent.length ? (
                  <>
                    <CirclePause className={cn("mt-px size-3.5 shrink-0", paused ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/60")} />
                    <span className="tabular-nums">{t("wouldPause", { paused, count: recent.length })}</span>
                  </>
                ) : null}
              </p>
              <div className="mt-3">
                <LimitPicker
                  // The picker starts from the chat's own limit, once that is known.
                  key={spending === undefined ? "loading" : "known"}
                  label={t("pickerLabel")}
                  listed={REPLY_LIMITS}
                  value={limit}
                  onChange={(next) => {
                    if (next !== null) setNumber(next);
                    setLimit({ threadId, limit: next }).catch(failed);
                  }}
                />
              </div>
            </div>
          </Zone>

          <Zone label={t("jobs")}>
            {/* One box, as the reply's is: the switch and its limit, and under a hairline the jobs they decide for, edge to edge. */}
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-muted/20">
              <div className="p-3">
                <Segmented
                  fill
                  label={t("beforeJob")}
                  value={allowance ? "allow" : "ask"}
                  onChange={(picked) => {
                    if (allowance) setKept(allowance.cap);
                    setAllowance({ threadId, allowance: picked === "allow" ? { cap } : null }).catch(failed);
                  }}
                  options={[
                    { id: "ask", label: t("askEveryTime"), icon: CircleHelp },
                    { id: "allow", label: t("allowWithoutAsking"), icon: CircleCheck },
                  ]}
                />
                {/* The limit opens under the switch: the frame grows, its content laid out at full size. It stays in the
                    page, so while it closes it can't be picked and turn allowing back on. Its gap to the switch is inside it. */}
                <motion.div inert={!allowance} initial={false} animate={allowance ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                  <div className="pt-3">
                    <LimitPicker
                      key={spending === undefined ? "loading" : "known"}
                      label={t("jobPickerLabel")}
                      listed={ASSISTANT_JOB_CAPS}
                      value={cap}
                      onChange={(next) => {
                        setKept(next);
                        setAllowance({ threadId, allowance: { cap: next } }).catch(failed);
                      }}
                    />
                  </div>
                </motion.div>
              </div>
              <ul className="divide-y divide-border/40 border-t border-border/40">
                {jobs.results.map((job) => {
                  const { kind, words } = viewOf(job.action);
                  const name = `steps.${words}.ask` as "steps.other.ask";
                  return (
                    <li key={job.id} className="flex items-center gap-3 px-3 py-2.5">
                      <KindTile kind={kind} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{job.subject ?? (ta.has(name) ? ta(name) : ta("steps.other.ask"))}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">{t("holds", { credits: job.credits })}</span>
                      </span>
                      <JobRule runs={runs(job.credits)} />
                    </li>
                  );
                })}
                {jobs.status === "CanLoadMore" || jobs.status === "LoadingMore" ? (
                  <li>
                    <button type="button" disabled={jobs.status === "LoadingMore"} onClick={() => jobs.loadMore(JOBS_MORE)} className="flex w-full items-center justify-center px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-60">
                      {t("moreJobs")}
                    </button>
                  </li>
                ) : null}
                <li className="flex items-center gap-3 px-3 py-2.5">
                  <KindTile kind="other" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t("publishing")}</span>
                    <span className="block text-xs text-muted-foreground">{t("publishingDetail")}</span>
                  </span>
                  <span className="flex w-20 shrink-0 items-center justify-end gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5" /> {t("asks")}
                  </span>
                </li>
              </ul>
            </div>
          </Zone>

          <div className={LIST}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-3">
              <span className="min-w-0 flex-1 text-sm font-medium">{t("forNewChats")}</span>
              <Switch checked={spending !== undefined && takenByNewChats(spending)} onCheckedChange={(on) => setForNewChats({ threadId, on }).catch(failed)} />
            </label>
          </div>
          <p className="px-2 text-xs leading-relaxed text-muted-foreground">{t("yours")}</p>
        </div>
      </ScrollArea>
    </>
  );
}

/** Whether a job runs without asking. Both labels hold one cell, so the row never reflows. */
function JobRule({ runs }: { runs: boolean }) {
  const t = useTranslations("assistant.spendingSheet");
  return (
    <span className="grid w-20 shrink-0 text-xs [&>*]:col-start-1 [&>*]:row-start-1 [&>*]:justify-end">
      <motion.span initial={false} animate={{ opacity: runs ? 1 : 0 }} aria-hidden={!runs} className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="size-3.5" /> {t("runs")}
      </motion.span>
      <motion.span initial={false} animate={{ opacity: runs ? 0 : 1 }} aria-hidden={runs} className="flex items-center gap-1.5 text-muted-foreground">
        <CircleHelp className="size-3.5" /> {t("asks")}
      </motion.span>
    </span>
  );
}

/** A purchase of credits from the panel: the bundle being bought, the last one bought since the sheet opened, and the way to buy one. */
export type Purchase = { buying: number | null; bought: number | null; buy: (credits: number) => void };

/**
 * Adds credits without leaving the chat, for a call that waits on a balance too low for it
 * (#328): the balance and how far short it is, the call that waits, and the bundles the
 * account can buy. A purchase that needs a checkout page goes to it, and the tab comes back
 * to this chat. The mock's Add credits sheet.
 */
export function TopUpSheet({ waiting, purchase, onBack }: { waiting: Waiting; /** The purchase under way and the last one made, which the panel keeps: a sheet closed and opened again finds a purchase still on its way, and can't start a second. */ purchase: Purchase; onBack: () => void }) {
  const t = useTranslations("assistant.topUp");
  const format = useFormatter();
  const router = useRouter();
  const account = useQuery(api.billing.accounts.mine, {});
  const topUps = useFeatureFlag("credits.topups");
  const catalog = useBillingCatalog();
  const bundles = catalog && topUps ? topUpBundles(catalog) : [];
  const { buying, bought, buy } = purchase;
  const balance = Math.floor(account?.balance ?? 0);
  const need = Math.max(0, waiting.credits - balance);
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", trailingZeroDisplay: "stripIfInteger" });
  return (
    <>
      <SheetHeader title={t("title")} detail={t("detail")} onBack={onBack} />
      <ScrollArea shades className="min-h-0 flex-1">
        {/* Laid out from the first frame at its size; what it says shows once the balance is known. */}
        <div inert={account === undefined} className={cn("space-y-5 px-4 py-5 transition-opacity duration-200", account === undefined && "opacity-0")}>
          <div>
            <p className="text-4xl font-semibold tracking-tight">
              <AnimatedNumber value={balance} />
            </p>
            <div className="mt-1 flex h-5 items-center text-sm text-muted-foreground">
              <AnimatePresence mode="popLayout" initial={false}>
                {bought ? (
                  <motion.span key="added" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }} className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="size-4" /> {t("added", { credits: bought })}
                  </motion.span>
                ) : (
                  <motion.span key="need" exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: EASE }}>
                    {t.rich(need > 0 ? "short" : "enough", { need, s: (chunks) => <span className="font-medium text-amber-600 dark:text-amber-400">{chunks}</span> })}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-muted/40 px-3 py-2.5">
            <KindTile kind={waiting.kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{waiting.title}</span>
              <span className="block text-xs text-muted-foreground">{t("waiting")}</span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("upTo", { credits: waiting.credits })}</span>
          </div>
          {bundles.length ? (
            <div className="rounded-2xl border border-border/60 bg-muted/20 p-1.5">
              {bundles.map((bundle, i) => (
                <motion.button
                  key={bundle.credits}
                  type="button"
                  disabled={buying !== null}
                  onClick={() => buy(bundle.credits)}
                  aria-label={t("buy", { credits: bundle.credits, price: money(bundle.amount) })}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE, delay: 0.08 + i * 0.05 }}
                  className="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/60 disabled:hover:bg-transparent"
                >
                  <span className="flex-1 text-sm font-semibold tabular-nums">+{format.number(bundle.credits)}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{money(bundle.amount)}</span>
                  <span className="flex size-4 items-center justify-center">
                    {buying === bundle.credits ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
                    ) : bought === bundle.credits ? (
                      <Check className="size-4 text-emerald-500" />
                    ) : (
                      <ArrowRight className="size-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                    )}
                  </span>
                </motion.button>
              ))}
            </div>
          ) : (
            // An account that can't buy bundles here adds credits with its plan.
            <button type="button" onClick={() => router.push("/settings/billing")} className="group flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/60">
              <span className="flex-1">{t("plans")}</span>
              <ArrowRight className="size-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
            </button>
          )}
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("note")}</p>
        </div>
      </ScrollArea>
    </>
  );
}
