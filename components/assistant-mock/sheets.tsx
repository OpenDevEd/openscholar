"use client";

// Cards that stack over the assistant panel, the way iOS stacks them: a new card
// slides in from the right, and the one underneath steps back, shifts left so its
// edge peeks out, and dims. Each layer is its own card; nothing sits behind them.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormatter } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Building2, Check, ChevronLeft, CircleCheck, CircleHelp, CirclePause, Coins, Eye, Link2, Loader2, Lock, MessageSquare, Radio, Search, Share2, SquarePen, UserPlus } from "lucide-react";
import { useBillingCatalog } from "@/lib/billing/catalog-provider";
import { topUpBundles } from "@/lib/billing/catalog";
import { cn } from "@/lib/utils";
import { TooltipHint } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { Switch } from "@/components/ui/switch";
import { EASE } from "@/components/settings/model-map";
import { AnimatedNumber, KindTile, type Ask } from "./run-map";
import { LogoMark } from "./logo-mark";
import { JOB_CAPS, KIND, OTHER_SCREENING, RECENT_REPLIES, REPLY_CAPS, type Limit } from "./data";

const KIND_TINT = { screening: KIND.screening!.tint };

export type SheetKind = "history" | "share" | "topup" | "spending";

export const SHEET_SPRING = { type: "spring" as const, stiffness: 300, damping: 32, mass: 0.9 };

/** Where a card sits with `depth` cards on top of it: smaller, and nudged left so its edge shows. */
export const stackedUnder = (depth: number) => ({ scale: 1 - depth * 0.07, x: depth * -22 });

/** One stacked layer. `depth` counts the sheets above it; 0 is the top. */
export function Sheet({
  index,
  depth,
  children,
}: {
  index: number;
  depth: number;
  children: ReactNode;
}) {
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
  return (
    <div className="flex items-center gap-2 border-b border-border/50 px-3 py-3">
      <TooltipHint label="Back">
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
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

type Member = { initial: string; name: string; tint: string; here?: boolean };
type Chat = {
  id: string;
  title: string;
  last: string;
  when: string;
  members?: Member[];
  org?: string;
  mine: boolean;
  current?: boolean;
  /** The assistant is running a job in this chat right now. */
  running?: { label: string; total: number; start: number };
};

const JOSEPH: Member = { initial: "J", name: "Joseph", tint: "#2dd4bf" };
const SARA: Member = { initial: "S", name: "Sara", tint: "#a78bfa" };
const AMINA: Member = { initial: "A", name: "Amina", tint: "#fb923c" };
const MARC: Member = { initial: "M", name: "Marc", tint: "#60a5fa" };

// Past chats and people are made up for the mock.
const CHATS: Array<{ group: string; live?: boolean; chats: Chat[] }> = [
  {
    group: "Happening now",
    live: true,
    chats: [
      {
        id: "c3", title: "Mother-tongue instruction, Kenya and Uganda", last: "Tightened the search to 2015 onwards", when: "Mon", mine: false, org: "OpenDevEd",
        members: [{ ...JOSEPH, here: true }, { ...SARA, here: true }, AMINA],
      },
      {
        id: "c5", title: "Teacher coaching cost-effectiveness", last: "Screened 140 papers, 38 included", when: "14 Sep", mine: true,
        members: [JOSEPH, SARA],
        running: { label: "Screening", total: OTHER_SCREENING.total, start: OTHER_SCREENING.start },
      },
    ],
  },
  {
    group: "Today",
    chats: [
      {
        id: "c1", title: "Structured pedagogy in sub-Saharan Africa", last: "Saved 4 included studies to a new collection", when: "Now", mine: true, current: true,
      },
      {
        id: "c2", title: "Retrieval practice in secondary maths", last: "Extracted effect sizes and sample sizes", when: "09:12", mine: true,
      },
    ],
  },
  {
    group: "Earlier",
    chats: [
      {
        id: "c4", title: "EGRA validity studies", last: "Compared 12 instruments across countries", when: "Sun", mine: true,
      },
      {
        id: "c6", title: "Digital literacy tools in Malawi", last: "Found 3 recent reviews", when: "2 Sep", mine: false,
        members: [MARC],
      },
      { id: "c7", title: "Pre-primary teacher training in Rwanda", last: "Screened 62 papers, 11 included", when: "28 Aug", mine: true },
      { id: "c8", title: "Girls' secondary school completion", last: "Built a collection of 19 studies", when: "21 Aug", mine: true },
      {
        id: "c9", title: "Tutoring at scale in Latin America", last: "Compared costs per learner", when: "14 Aug", mine: false, org: "OpenDevEd",
        members: [SARA],
      },
      { id: "c10", title: "School feeding and attendance", last: "Extracted sample sizes from 40 trials", when: "2 Aug", mine: true },
      { id: "c11", title: "Mobile phone numeracy lessons", last: "Tightened the search to 2018 onwards", when: "19 Jul", mine: true },
    ],
  },
];

type Scope = "all" | "mine" | "shared";

/** A member's initial; someone in the chat right now gets a ring that ripples outward. */
function Avatar({ member }: { member: Member }) {
  const reduceMotion = useReducedMotion();
  return (
    <span className="relative flex size-6 shrink-0">
      {member.here && !reduceMotion ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ boxShadow: `0 0 0 1.5px ${member.tint}` }}
          animate={{ scale: [1.15, 1.7], opacity: [0.6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}
      <span
        className="relative flex size-6 items-center justify-center rounded-full text-[11px] font-semibold ring-2 ring-card"
        style={{
          backgroundColor: `color-mix(in oklab, ${member.tint} 24%, var(--card))`,
          color: member.tint,
          boxShadow: member.here ? `0 0 0 2px var(--card), 0 0 0 3.5px ${member.tint}` : undefined,
        }}
      >
        {member.initial}
      </span>
    </span>
  );
}

function Members({ members, org }: { members?: Member[]; org?: string }) {
  if (!members?.length && !org) return null;
  return (
    <span className="flex shrink-0 items-center -space-x-1.5">
      {org ? (
        <TooltipHint label={`Everyone in ${org}`}>
          <span className="relative flex size-6 items-center justify-center rounded-full bg-[color-mix(in_oklab,#60a5fa_22%,var(--card))] text-[#60a5fa] ring-2 ring-card">
            <Building2 className="size-3" />
          </span>
        </TooltipHint>
      ) : null}
      {members?.map((m) => <Avatar key={m.name} member={m} />)}
    </span>
  );
}

/** A job the assistant is running in another chat, ticking along while you watch. */
function Running({ running }: { running: NonNullable<Chat["running"]> }) {
  const [done, setDone] = useState(running.start);
  // A timer stands in for the job's live progress.
  useEffect(() => {
    const id = setInterval(() => setDone((d) => (d >= running.total ? d : d + 1)), 260);
    return () => clearInterval(id);
  }, [running.total]);
  const finished = done >= running.total;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      <LogoMark size={18} working={!finished} />
      <span className="shrink-0 font-medium text-foreground/90">
        {finished ? "Screened" : running.label} <span className="tabular-nums">{done}</span>
        <span className="text-muted-foreground"> of {running.total}</span>
      </span>
      <span className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-foreground/10">
        <motion.span
          className="block h-full rounded-full"
          style={{ backgroundColor: KIND_TINT.screening }}
          initial={false}
          animate={{ width: `${(done / running.total) * 100}%` }}
          transition={{ duration: 0.25, ease: EASE }}
        />
      </span>
    </span>
  );
}

function Status({ chat }: { chat: Chat }) {
  const here = chat.members?.filter((m) => m.here) ?? [];
  if (chat.running) return <Running running={chat.running} />;
  if (here.length) {
    const names = here.map((m) => m.name);
    return (
      <span className="truncate text-xs font-medium text-foreground/90">
        {names.length === 1 ? `${names[0]} is here` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are here`}
      </span>
    );
  }
  return <span className="truncate text-xs text-muted-foreground">{chat.last}</span>;
}

function ChatRow({ chat, index, onShare }: { chat: Chat; index: number; onShare: (title: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay: 0.06 + index * 0.03 }}
      className={cn(
        "group relative rounded-2xl px-3 py-3",
        chat.current ? "bg-primary/[0.07] ring-1 ring-inset ring-primary/25" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-baseline gap-3">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{chat.title}</p>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground group-hover:invisible">
          {chat.current ? "Open now" : chat.when}
        </span>
      </div>
      <div className="mt-1 flex h-6 items-center gap-3">
        <span className="flex min-w-0 flex-1 items-center">
          <Status chat={chat} />
        </span>
        <Members members={chat.members} org={chat.org} />
      </div>
      {/* Out of the flow, so the hover action never adds height to the row. */}
      <div className="absolute right-2 top-2 hidden group-hover:block">
        <TooltipHint label="Share">
          <button
            type="button"
            aria-label={`Share ${chat.title}`}
            onClick={() => onShare(chat.title)}
            className="flex size-7 items-center justify-center rounded-full bg-card text-muted-foreground shadow-xs hover:text-foreground"
          >
            <Share2 className="size-3.5" />
          </button>
        </TooltipHint>
      </div>
    </motion.div>
  );
}

export function HistorySheet({ onBack, onShare }: { onBack: () => void; onShare: (title: string) => void }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const q = query.trim().toLowerCase();
  const keep = (c: Chat) =>
    (scope === "all" || (scope === "mine" ? c.mine : !c.mine)) && (!q || c.title.toLowerCase().includes(q) || c.last.toLowerCase().includes(q));
  const groups = CHATS.map((g) => ({ ...g, chats: g.chats.filter(keep) })).filter((g) => g.chats.length);
  let row = 0;
  return (
    <>
      <SheetHeader title="Chats" detail="2 happening now" onBack={onBack} />
      <div className="space-y-2.5 px-3 pt-3">
        <div className="flex items-center gap-2">
          <label className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-border/60 bg-background px-3 text-sm focus-within:border-primary/40">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </label>
          <TooltipHint label="New chat">
            <button type="button" aria-label="New chat" className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary hover:bg-primary/15">
              <SquarePen className="size-4" />
            </button>
          </TooltipHint>
        </div>
        <Segmented
          label="Which chats"
          value={scope}
          onChange={setScope}
          fill
          options={[
            { id: "all", label: "All" },
            { id: "mine", label: "Mine" },
            { id: "shared", label: "Shared with me" },
          ]}
        />
      </div>
      {/*
        A filter change mounts a fresh list that fades and staggers in. No exit wait: waiting
        for the old list to leave stranded a stale list when the filter changed quickly.
      */}
      <ScrollArea shades className="min-h-0 flex-1">
        <div className="px-2 pb-3 pt-3">
            <motion.div
              key={`${scope}|${q}`}
              className="space-y-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18 }}
            >
              {groups.map(({ group, live, chats }) => (
                <section key={group} className="space-y-1">
                  <h3 className="flex items-center gap-1.5 px-3 pb-0.5 text-xs font-medium text-muted-foreground">
                    {live ? <LiveIcon /> : null}
                    {group}
                  </h3>
                  {chats.map((c) => (
                    <ChatRow key={c.id} chat={c} index={row++} onShare={onShare} />
                  ))}
                </section>
              ))}
              {groups.length === 0 ? <p className="px-3 py-6 text-sm text-muted-foreground">No chats match.</p> : null}
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
    <motion.span
      className="flex text-emerald-500"
      animate={reduceMotion ? undefined : { opacity: [1, 0.35, 1] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    >
      <Radio className="size-3.5" />
    </motion.span>
  );
}

type Access = "view" | "chat";
type Person = { id: string; name: string; detail: string; tint: string; org?: boolean; owner?: boolean; access: Access };

// People are made up for the mock.
const PEOPLE: Person[] = [
  { id: "me", name: "You", detail: "Owner", tint: "#fb923c", owner: true, access: "chat" },
  { id: "org", name: "Everyone in OpenDevEd", detail: "14 members", tint: "#60a5fa", org: true, access: "view" },
  { id: "p1", name: "Joseph Okello", detail: "joseph@example.org", tint: "#2dd4bf", access: "chat" },
  { id: "p2", name: "Sara Haddad", detail: "sara@example.org", tint: "#a78bfa", access: "view" },
];

export function ShareSheet({ chat, onBack }: { chat: string; onBack: () => void }) {
  const [people, setPeople] = useState(PEOPLE);
  const [copied, setCopied] = useState(false);
  return (
    <>
      <SheetHeader title="Share this chat" detail={chat} onBack={onBack} />
      <ScrollArea shades className="min-h-0 flex-1">
        <div className="space-y-4 px-3 py-3">
          <label className="flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-background px-3 text-sm focus-within:border-primary/40">
            <UserPlus className="size-4 text-muted-foreground" />
            <input placeholder="Add people or an organization" aria-label="Add people or an organization" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
          </label>
          <ul className="space-y-1">
            {people.map((p, i) => (
              <motion.li
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE, delay: 0.12 + i * 0.05 }}
                className="flex items-center gap-3 rounded-xl px-2 py-2"
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  style={{ backgroundColor: `color-mix(in oklab, ${p.tint} 20%, transparent)`, color: p.tint }}
                >
                  {p.org ? <Building2 className="size-4" /> : p.name.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.detail}</p>
                </div>
                {p.owner ? (
                  <span className="px-2 text-xs text-muted-foreground">Can chat</span>
                ) : (
                  <Segmented
                    label={`${p.name}'s access`}
                    value={p.access}
                    onChange={(access) => setPeople((all) => all.map((x) => (x.id === p.id ? { ...x, access } : x)))}
                    options={[
                      { id: "view", label: "View", icon: Eye },
                      { id: "chat", label: "Chat", icon: MessageSquare },
                    ]}
                  />
                )}
              </motion.li>
            ))}
          </ul>
          <p className="px-2 text-xs leading-relaxed text-muted-foreground">
            They see this conversation. Searches, collections and libraries in it keep their own access. People who can chat send messages as themselves, and the assistant acts for them with their own access and credits.
          </p>
        </div>
      </ScrollArea>
      <div className="border-t border-border/50 p-3">
        <button
          type="button"
          onClick={() => setCopied(true)}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-muted/60 text-sm font-medium hover:bg-muted"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={copied ? "copied" : "copy"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="flex items-center gap-2"
            >
              {copied ? <Check className="size-4 text-emerald-500" /> : <Link2 className="size-4" />}
              {copied ? "Link copied" : "Copy link for people with access"}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </>
  );
}


/**
 * Adds credits without leaving the chat, from the same bundles as the billing page.
 * Buying rolls the balance up, shows a check, then the sheet closes by itself.
 */
export function TopUpSheet({
  balance,
  need,
  purpose,
  onBack,
  onBought,
}: {
  balance: number;
  need: number;
  /** The ask the credits are for. */
  purpose?: Ask;
  onBack: () => void;
  /** Credits land the moment the check shows, so closing the sheet early keeps them. */
  onBought: (credits: number) => void;
}) {
  const format = useFormatter();
  const catalog = useBillingCatalog();
  const real = catalog ? topUpBundles(catalog) : [];
  // Before Autumn's first sync there are no prices, so the mock falls back to plain amounts.
  const bundles: Array<{ credits: number; amount?: number }> = real.length ? real : [500, 2000, 5000].map((credits) => ({ credits }));
  const [buying, setBuying] = useState<number | null>(null);
  const [bought, setBought] = useState<number | null>(null);
  const timers = useRef<number[]>([]);
  // Timers stand in for checkout; clear them if the sheet goes first.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const buy = (credits: number) => {
    setBuying(credits);
    timers.current.push(
      window.setTimeout(() => {
        setBuying(null);
        setBought(credits);
        onBought(credits);
      }, 900),
      window.setTimeout(onBack, 2000),
    );
  };
  const money = (amount: number) =>
    format.number(amount, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", trailingZeroDisplay: "stripIfInteger" });
  const shown = balance + (bought ?? 0);
  return (
    <>
      <SheetHeader title="Add credits" detail="Without leaving the chat" onBack={onBack} />
      <ScrollArea shades className="min-h-0 flex-1">
        <div className="space-y-5 px-4 py-5">
          <div>
            <p className="text-4xl font-semibold tracking-tight">
              <AnimatedNumber value={shown} />
            </p>
            <div className="mt-1 flex h-5 items-center text-sm text-muted-foreground">
              <AnimatePresence mode="popLayout" initial={false}>
                {bought ? (
                  <motion.span
                    key="added"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400"
                  >
                    <Check className="size-4" /> Added {format.number(bought)} credits
                  </motion.span>
                ) : (
                  <motion.span key="need" exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: EASE }}>
                    credits, <span className="font-medium text-amber-600 dark:text-amber-400">{need} short</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
          {purpose ? (
            <div className="flex items-center gap-3 rounded-2xl bg-muted/40 px-3 py-2.5">
              <KindTile kind={purpose.kind} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{purpose.title}</span>
                <span className="block text-xs text-muted-foreground">Waiting in the chat</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">Up to {purpose.credits} credits</span>
            </div>
          ) : null}
          <div className="rounded-2xl border border-border/60 bg-muted/20 p-1.5">
            {bundles.map((bundle, i) => (
              <motion.button
                key={bundle.credits}
                type="button"
                disabled={buying !== null || bought !== null}
                onClick={() => buy(bundle.credits)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: bought !== null && bought !== bundle.credits ? 0.4 : 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE, delay: bought === null ? 0.08 + i * 0.05 : 0 }}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/60 disabled:hover:bg-transparent"
              >
                <span className="flex-1 text-sm font-semibold tabular-nums">+{format.number(bundle.credits)}</span>
                {bundle.amount !== undefined ? <span className="text-sm tabular-nums text-muted-foreground">{money(bundle.amount)}</span> : null}
                <span className="flex size-4 items-center justify-center">
                  {buying === bundle.credits ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
                  ) : bought === bundle.credits ? (
                    <motion.span initial={{ scale: 0.3 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 26 }}>
                      <Check className="size-4 text-emerald-500" />
                    </motion.span>
                  ) : (
                    <ArrowRight className="size-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                  )}
                </span>
              </motion.button>
            ))}
          </div>
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">The assistant still asks before it spends them.</p>
        </div>
      </ScrollArea>
    </>
  );
}

/** A slow, drifting glow on the screen's right edge while the assistant is open. */
export function EdgeGlow({ open, working }: { open: boolean; working: boolean }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="glow"
          aria-hidden
          className="pointer-events-none fixed inset-y-0 right-0 z-0 w-[560px] overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: working ? 1 : 0.7 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <motion.div
            className="absolute -right-40 top-[-10%] h-[70%] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgb(255_120_40/0.32),transparent)] blur-3xl"
            animate={{ y: ["0%", "45%", "0%"], x: [0, -40, 0] }}
            transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute -right-48 bottom-[-15%] h-[70%] w-[440px] rounded-full bg-[radial-gradient(closest-side,rgb(150_110_255/0.28),transparent)] blur-3xl"
            animate={{ y: ["0%", "-40%", "0%"], x: [0, -30, 0] }}
            transition={{ duration: 17, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-orange-400/70 to-transparent"
            animate={{ opacity: working ? [0.4, 1, 0.4] : 0.5 }}
            transition={working ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.6 }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Spending allowed without asking in one chat, for one person; `cap` is the most one job may hold. */
export type Allowance = { on: boolean; cap: Limit };
/** Digits a custom limit takes: the most a number holds exactly. */
const CUSTOM_DIGITS = 15;

/**
 * Picks a spending limit, the same way for a reply and for a job: the listed ones, then
 * Custom, which opens a field for any whole number from 1, then No limit.
 */
function LimitPicker({ label, listed, value, onChange }: { label: string; listed: readonly number[]; value: Limit; onChange: (limit: Limit) => void }) {
  const format = useFormatter();
  // Custom is on while the limit is the person's own number, even one that matches a listed limit.
  const [custom, setCustom] = useState(value !== null && !listed.includes(value));
  // The person's own number, kept while another limit is picked, and what its field holds as it's typed in.
  const [own, setOwn] = useState(value ?? listed[0]);
  const [typed, setTyped] = useState(String(own));
  const field = useRef<HTMLInputElement>(null);
  const open = custom && value !== null;
  return (
    <div>
      <div className="flex items-center gap-3 pl-1">
        <span className="shrink-0 text-xs text-muted-foreground">Up to</span>
        <div className="min-w-0 flex-1">
          <Segmented
            fill="labels"
            label={label}
            value={value === null ? "none" : custom ? "custom" : String(value)}
            onChange={(picked) => {
              if (picked === "none") return onChange(null);
              if (picked !== "custom") {
                setCustom(false);
                return onChange(Number(picked));
              }
              // Custom starts from the limit in force, or from the person's last own number when there's none.
              const start = value ?? own;
              setCustom(true);
              setOwn(start);
              setTyped(String(start));
              onChange(start);
              // The field takes the keyboard once it's open, its number selected to type over.
              requestAnimationFrame(() => field.current?.select());
            }}
            options={[...listed.map((limit) => ({ id: String(limit), label: format.number(limit) })), { id: "custom", label: "Custom" }, { id: "none", label: "No limit" }]}
          />
        </div>
      </div>
      {/* The field opens under the row: the frame grows, its content laid out at full size, and its gap is inside it. */}
      <motion.div
        inert={!open}
        initial={false}
        animate={open ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="overflow-hidden"
      >
        <label className="mt-2 flex h-9 items-center gap-2 rounded-xl border border-border/60 bg-background px-3 text-sm focus-within:border-primary/40">
          <Coins className="size-3.5 text-muted-foreground" />
          <input
            ref={field}
            inputMode="numeric"
            value={typed}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, CUSTOM_DIGITS);
              setTyped(digits);
              if (!digits) return;
              setOwn(Number(digits));
              onChange(Number(digits));
            }}
            // Left empty, it goes back to the number in force.
            onBlur={() => setTyped(String(own))}
            aria-label={`${label}, your own number`}
            className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
          />
          <span className="shrink-0 text-xs text-muted-foreground">credits</span>
        </label>
      </motion.div>
    </div>
  );
}
/** The reply chart's top: just above the largest reply; a higher cap sits on the top edge. */
const CHART_MAX = Math.max(...RECENT_REPLIES) * 1.15;

/**
 * What this chat may spend without stopping to ask, for the person looking. A reply pauses
 * at its limit, where it has one; a job either asks every time or runs without asking up
 * to its own. Both limits are picked the same way.
 */
export function SpendingSheet({
  chat,
  replyCap,
  onReplyCap,
  allowance,
  onAllowance,
  forNewChats,
  onForNewChats,
  jobs,
  onBack,
}: {
  chat: string;
  /** What a reply may spend before it pauses; null is no limit. */
  replyCap: Limit;
  onReplyCap: (cap: Limit) => void;
  allowance: Allowance;
  onAllowance: (allowance: Allowance) => void;
  forNewChats: boolean;
  onForNewChats: (on: boolean) => void;
  /** The jobs this chat runs, with what each holds. */
  jobs: Ask[];
  onBack: () => void;
}) {
  const paused = replyCap === null ? 0 : RECENT_REPLIES.filter((spent) => spent > replyCap).length;
  // The number the headline holds while there's no limit and it's faded out: the last one there was.
  const [number, setNumber] = useState(replyCap ?? REPLY_CAPS[0]);
  return (
    <>
      <SheetHeader title="Spending" detail={chat} onBack={onBack} />
      <ScrollArea shades className="min-h-0 flex-1">
        <div className="space-y-6 px-3 py-4">
          <Zone label="Each reply">
            <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
              {/* Both headlines hold one cell, so the card never changes size between a limit and none. */}
              <div className="grid px-1 [&>*]:col-start-1 [&>*]:row-start-1">
                <motion.div initial={false} animate={{ opacity: replyCap === null ? 0 : 1 }} aria-hidden={replyCap === null} className="flex min-w-0 items-baseline gap-2">
                  <span className="text-3xl font-semibold tracking-tight">
                    <AnimatedNumber value={number} />
                  </span>
                  <span className="min-w-0 truncate text-sm text-muted-foreground">credits, then it pauses and asks</span>
                </motion.div>
                <motion.div initial={false} animate={{ opacity: replyCap === null ? 1 : 0 }} aria-hidden={replyCap !== null} className="flex min-w-0 items-baseline gap-2">
                  <span className="whitespace-nowrap text-3xl font-semibold tracking-tight">No limit</span>
                  <span className="min-w-0 truncate text-sm text-muted-foreground">it runs while you have credits</span>
                </motion.div>
              </div>
              {/* Your last replies against the limit: the ones over the line would have paused. */}
              <div className="relative mt-4 flex h-20 items-end gap-1 px-1" aria-hidden>
                {RECENT_REPLIES.map((spent, i) => (
                  <span
                    key={i}
                    className={cn("flex-1 rounded-t-[3px] transition-colors duration-300", replyCap !== null && spent > replyCap ? "bg-amber-400" : "bg-foreground/15")}
                    style={{ height: `${(Math.min(spent, CHART_MAX) / CHART_MAX) * 100}%` }}
                  />
                ))}
                <motion.span
                  className="absolute inset-x-0 border-t border-dashed border-foreground/40"
                  initial={false}
                  animate={{ bottom: `${Math.min(1, number / CHART_MAX) * 100}%`, opacity: replyCap === null ? 0 : 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 30 }}
                />
              </div>
              <p className="mt-2 flex h-4 items-center gap-1.5 px-1 text-xs text-muted-foreground">
                <CirclePause className={cn("size-3.5", paused ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/60")} />
                <span className="tabular-nums">
                  {paused} of your last {RECENT_REPLIES.length} replies would have paused
                </span>
              </p>
              <div className="mt-3">
                <LimitPicker
                  label="Credits a reply may spend"
                  listed={REPLY_CAPS}
                  value={replyCap}
                  onChange={(cap) => {
                    if (cap !== null) setNumber(cap);
                    onReplyCap(cap);
                  }}
                />
              </div>
            </div>
          </Zone>

          <Zone label="Jobs that spend credits">
            <div className="space-y-2.5">
              <Segmented
                fill
                label="Before a job spends credits"
                value={allowance.on ? "allow" : "ask"}
                onChange={(v) => onAllowance({ ...allowance, on: v === "allow" })}
                options={[
                  { id: "ask", label: "Ask every time", icon: CircleHelp },
                  { id: "allow", label: "Allow without asking", icon: CircleCheck },
                ]}
              />
              {/* The limit opens under the switch: the frame grows, its content laid out at full size.
                  It stays in the page, so while it closes it can't be picked and turn allowing back on.
                  Its gap to the list is inside it, so a closed row adds none. */}
              <motion.div
                inert={!allowance.on}
                initial={false}
                animate={allowance.on ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="!my-0 overflow-hidden"
              >
                <div className="pb-2.5">
                  <LimitPicker label="Most one job may hold without asking" listed={JOB_CAPS} value={allowance.cap} onChange={(cap) => onAllowance({ ...allowance, cap })} />
                </div>
              </motion.div>
              <ul className={LIST}>
                {jobs.map((job) => {
                  const runs = allowance.on && (allowance.cap === null || (job.credits ?? 0) <= allowance.cap);
                  return (
                    <li key={job.title} className="flex items-center gap-3 px-3 py-2.5">
                      <KindTile kind={job.kind} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{job.title}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">Holds up to {job.credits} credits</span>
                      </span>
                      <JobRule runs={runs} />
                    </li>
                  );
                })}
                <li className="flex items-center gap-3 px-3 py-2.5">
                  <KindTile kind="publish" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">Publishing a library</span>
                    <span className="block text-xs text-muted-foreground">Visitors see it at once</span>
                  </span>
                  <span className="flex w-20 shrink-0 items-center justify-end gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5" /> Asks
                  </span>
                </li>
              </ul>
            </div>
          </Zone>

          <div className={LIST}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-3">
              <span className="min-w-0 flex-1 text-sm font-medium">Use these for my new chats</span>
              <Switch checked={forNewChats} onCheckedChange={onForNewChats} />
            </label>
          </div>
          <p className="px-2 text-xs leading-relaxed text-muted-foreground">
            These are yours in this chat. People you share it with set their own, and spend their own credits.
          </p>
        </div>
      </ScrollArea>
    </>
  );
}

/** Whether a job runs without asking. Both labels hold one cell, so the row never reflows. */
function JobRule({ runs }: { runs: boolean }) {
  return (
    <span className="grid w-20 shrink-0 text-xs [&>*]:col-start-1 [&>*]:row-start-1 [&>*]:justify-end">
      <motion.span initial={false} animate={{ opacity: runs ? 1 : 0 }} aria-hidden={!runs} className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="size-3.5" /> Runs
      </motion.span>
      <motion.span initial={false} animate={{ opacity: runs ? 0 : 1 }} aria-hidden={runs} className="flex items-center gap-1.5 text-muted-foreground">
        <CircleHelp className="size-3.5" /> Asks
      </motion.span>
    </span>
  );
}
