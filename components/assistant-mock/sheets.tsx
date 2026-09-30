"use client";

// Cards that stack over the assistant panel, the way iOS stacks them: a new card
// slides in from the right, and the one underneath steps back, shifts left so its
// edge peeks out, and dims. Each layer is its own card; nothing sits behind them.

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Building2, Check, ChevronLeft, Eye, Link2, MessageSquare, Radio, Search, Share2, SquarePen, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TooltipHint } from "@/components/ui/tooltip";
import { Segmented } from "@/components/settings/parts";
import { EASE } from "@/components/settings/model-map";
import { KindTile } from "./run-map";
import { LogoMark } from "./logo-mark";
import { KIND } from "./data";

const KIND_TINT = { screening: KIND.screening!.tint };

export type SheetKind = "history" | "share";

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

type Record = { kind: keyof typeof KIND; label: string };
type Member = { initial: string; name: string; tint: string; here?: boolean };
type Chat = {
  id: string;
  title: string;
  last: string;
  when: string;
  records: Record[];
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
        records: [{ kind: "search", label: "142 results" }],
        members: [{ ...JOSEPH, here: true }, { ...SARA, here: true }, AMINA],
      },
      {
        id: "c5", title: "Teacher coaching cost-effectiveness", last: "Screened 140 papers, 38 included", when: "14 Sep", mine: true,
        records: [{ kind: "search", label: "140 results" }, { kind: "screening", label: "140 papers" }],
        members: [JOSEPH, SARA],
        running: { label: "Screening", total: 140, start: 58 },
      },
    ],
  },
  {
    group: "Today",
    chats: [
      {
        id: "c1", title: "Structured pedagogy in sub-Saharan Africa", last: "Saved 4 included studies to a new collection", when: "Now", mine: true, current: true,
        records: [{ kind: "search", label: "24 results" }, { kind: "screening", label: "24 screened" }, { kind: "collection", label: "4 papers" }],
      },
      {
        id: "c2", title: "Retrieval practice in secondary maths", last: "Extracted effect sizes and sample sizes", when: "09:12", mine: true,
        records: [{ kind: "search", label: "86 results" }, { kind: "extraction", label: "31 papers" }],
      },
    ],
  },
  {
    group: "Earlier",
    chats: [
      {
        id: "c4", title: "EGRA validity studies", last: "Compared 12 instruments across countries", when: "Sun", mine: true,
        records: [{ kind: "collection", label: "12 papers" }, { kind: "extraction", label: "12 papers" }],
      },
      {
        id: "c6", title: "Digital literacy tools in Malawi", last: "Found 3 recent reviews", when: "2 Sep", mine: false,
        records: [{ kind: "search", label: "57 results" }],
        members: [MARC],
      },
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
      <div className="mt-1 flex h-5 items-center">
        <Status chat={chat} />
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {chat.records.map((r, i) => (
          <span key={i} className="flex h-6 items-center gap-1.5 rounded-full bg-muted/60 pl-0.5 pr-2 text-[11px] font-medium text-foreground/80">
            <KindTile kind={r.kind} size="sm" />
            <span className="tabular-nums">{r.label}</span>
          </span>
        ))}
        <span className="ml-auto">
          <Members members={chat.members} org={chat.org} />
        </span>
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
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 pt-3">
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

/** The records that come with access to a chat. */
function Includes({ chat }: { chat: string }) {
  const records = CHATS.flatMap((g) => g.chats).find((c) => c.title === chat)?.records ?? [];
  if (!records.length) return null;
  return (
    <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
      <p className="text-xs font-medium text-muted-foreground">They can also open</p>
      <div className="flex flex-wrap gap-1.5">
        {records.map((r, i) => (
          <span key={i} className="flex h-7 items-center gap-1.5 rounded-full bg-background/60 pl-1 pr-2.5 text-xs font-medium">
            <KindTile kind={r.kind} size="sm" />
            <span className="tabular-nums">{r.label}</span>
          </span>
        ))}
      </div>
    </div>
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
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 py-3">
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
        <Includes chat={chat} />
        <p className="px-2 text-xs leading-relaxed text-muted-foreground">
          People who can chat send messages as themselves. Anything the assistant does for them runs with their own access and credits.
        </p>
      </div>
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
