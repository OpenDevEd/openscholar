"use client";

// What the assistant did in a turn, drawn like the AI settings routing map: the
// request at the top, a tinted curve out to each step's card, one card per step.

import { useEffect, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { ArrowRight, Check, ChevronRight, CircleHelp, CircleStop, Coins, Copy, ExternalLink, Folder, FolderPlus, Hourglass, Plus, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { EASE } from "@/components/settings/model-map";
import { KIND, OTHER_SCREENING, SCREEN_CREDITS, VERSIONS } from "./data";
import { LogoMark } from "./logo-mark";

/**
 * Text that a light sweeps across while work runs. It never drops below the muted
 * text colour, so the words stay readable mid-sweep; it holds still when motion is reduced.
 */
export function WorkingText({ children }: { children: string }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <span className="text-muted-foreground">{children}</span>;
  return (
    <motion.span
      className="bg-[linear-gradient(90deg,var(--muted-foreground)_0%,var(--muted-foreground)_38%,var(--foreground)_50%,var(--muted-foreground)_62%,var(--muted-foreground)_100%)] bg-[length:250%_100%] bg-clip-text text-transparent"
      animate={{ backgroundPosition: ["100% 0%", "-150% 0%"] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
    >
      {children}
    </motion.span>
  );
}

/** One fact on a card: an icon, a number and a short label, instead of a sentence. */
export type Fact = {
  icon?: ComponentType<{ className?: string }>;
  /** The icon's colour, such as a record kind's tint. */
  tint?: string;
  value?: ReactNode;
  label: string;
  /** `missing` is dashed and muted, `good` green, `warn` amber. */
  tone?: "missing" | "good" | "warn";
};

/** Facts as a row of small chips that never wraps; plain names truncate instead. */
export function Facts({ items }: { items: Fact[] }) {
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {items.map((fact, i) => (
        <span
          key={i}
          className={cn(
            "flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px]",
            fact.tone === "missing"
              ? "border border-dashed border-foreground/20 text-muted-foreground"
              : fact.tone === "good"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : fact.tone === "warn"
                  ? "bg-amber-500/12 text-amber-700 dark:text-amber-400"
                  : "bg-foreground/[0.06] text-muted-foreground",
          )}
        >
          {fact.icon ? (
            <span className="flex" style={fact.tint ? { color: fact.tint } : undefined}>
              <fact.icon className="size-3" />
            </span>
          ) : null}
          {fact.value !== undefined ? <span className="font-semibold tabular-nums text-foreground/90">{fact.value}</span> : null}
          {fact.label}
        </span>
      ))}
    </span>
  );
}

export type Step = {
  kind: keyof typeof KIND;
  title: string;
  detail: ReactNode;
  status: "working" | "done" | "undone" | "stopped";
  onUndo?: () => void;
};

const CARD = 56;
const GAP = 8;
const GUTTER = 36;
/** Room at the top for the tile the curves start from. */
const ORIGIN = 28;

/** A tinted icon square; the tile of the model cards, one size down. */
export function KindTile({ kind, size = "md", working }: { kind: keyof typeof KIND; size?: "sm" | "md"; working?: boolean }) {
  const { icon: Icon, tint } = KIND[kind]!;
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      animate={working && !reduceMotion ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={working ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      className={cn("flex shrink-0 items-center justify-center", size === "sm" ? "size-5 rounded-md" : "size-9 rounded-xl")}
      style={{ backgroundColor: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}
    >
      <Icon className={size === "sm" ? "size-3" : "size-4"} />
    </motion.span>
  );
}

/**
 * Steps hang off a small tile at the top, the way the settings map runs a curve
 * from each task to its model. `plain` drops the done checks, for a static map.
 */
export function RunMap({ steps, plain }: { steps: Step[]; plain?: boolean }) {
  const reduceMotion = useReducedMotion();
  const height = ORIGIN + steps.length * (CARD + GAP) - GAP;
  const y = (i: number) => ORIGIN + i * (CARD + GAP) + CARD / 2;
  return (
    <motion.div
      className="relative grid grid-cols-[36px_1fr]"
      initial={false}
      animate={{ height: Math.max(0, height) }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: EASE }}
    >
      <span className="absolute left-0.5 top-0 flex size-5 items-center justify-center rounded-md bg-primary/10">
        <LogoMark size={14} />
      </span>
      <svg className="overflow-visible" width={GUTTER} height={height} aria-hidden>
        {steps.map((s, i) => (
          <motion.path
            key={i}
            d={`M 12 22 C 12 ${22 + (y(i) - 22) * 0.75}, 16 ${y(i)}, ${GUTTER} ${y(i)}`}
            fill="none"
            stroke={KIND[s.kind]!.tint}
            strokeWidth={2}
            strokeLinecap="round"
            initial={reduceMotion ? false : { pathLength: 0 }}
            animate={{ pathLength: 1, opacity: s.status === "undone" || s.status === "stopped" ? 0.25 : 1 }}
            transition={{ duration: 0.5, ease: EASE }}
          />
        ))}
      </svg>
      <div className="relative">
        <AnimatePresence initial={false}>
          {steps.map((s, i) => (
            <motion.div
              key={i}
              className="absolute inset-x-0"
              style={{ top: ORIGIN + i * (CARD + GAP) }}
              initial={{ opacity: 0, x: -8, scale: 0.97 }}
              animate={{ opacity: s.status === "undone" || s.status === "stopped" ? 0.55 : 1, x: 0, scale: 1 }}
              transition={{ duration: 0.4, ease: EASE, delay: reduceMotion ? 0 : 0.15 }}
            >
              <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 px-3" style={{ height: CARD }}>
                <KindTile kind={s.kind} working={s.status === "working"} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className={cn("truncate text-sm font-semibold", s.status === "undone" && "line-through decoration-muted-foreground/60")}>
                    {s.status === "working" ? <WorkingText>{s.title}</WorkingText> : s.title}
                  </p>
                  <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                    {typeof s.detail === "string" ? <span className="truncate">{s.detail}</span> : s.detail}
                  </div>
                </div>
                {s.status === "done" && s.onUndo ? (
                  <button
                    type="button"
                    onClick={s.onUndo}
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Undo2 className="size-3" /> Undo
                  </button>
                ) : s.status === "done" && !plain ? (
                  <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" />
                ) : s.status === "stopped" ? (
                  <CircleStop className="size-4 shrink-0 text-muted-foreground" aria-label="Stopped" />
                ) : null}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** The versions the assistant tried as falling bars, with the one it kept filled in. */
export function VersionBars() {
  const max = VERSIONS[0]!.count;
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-4 items-end gap-[3px]" aria-hidden>
        {VERSIONS.map((v, i) => (
          <motion.span
            key={v.label}
            className={cn("w-[5px] rounded-full", i === VERSIONS.length - 1 ? "bg-[#60a5fa]" : "bg-foreground/15")}
            initial={{ height: 0 }}
            animate={{ height: 4 + (v.count / max) * 12 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.2 + i * 0.12 }}
          />
        ))}
      </span>
      <span className="tabular-nums">{VERSIONS.map((v) => v.count).join(" → ")}</span>
    </span>
  );
}

/**
 * A number that rolls to each new value, the way iOS counts a balance up. It
 * jumps straight there when motion is reduced.
 */
export function AnimatedNumber({ value }: { value: number }) {
  const reduceMotion = useReducedMotion();
  const spring = useSpring(value, { stiffness: 120, damping: 22 });
  const text = useTransform(spring, (n) => Math.round(n).toLocaleString());
  // The spring is an animation system outside React: point it at each new value.
  useEffect(() => {
    if (reduceMotion) spring.jump(value);
    else spring.set(value);
  }, [spring, value, reduceMotion]);
  return <motion.span className="tabular-nums">{text}</motion.span>;
}

/**
 * What an approval card asks for. `credits` is set when it spends them; `always`
 * offers the per-chat allowance; `queue` says it waits for the other screening.
 */
export type Ask = {
  kind: keyof typeof KIND;
  title: string;
  items: string[];
  credits?: number;
  always: boolean;
  confirm: string;
  decline: string;
  queue?: boolean;
};

/**
 * Asks before spending credits or making something public. When the balance can't
 * cover it, the buttons turn into a top-up, and turn back once the credits land.
 */
export function ApprovalCard({
  ask,
  status,
  balance,
  onAllow,
  onAlways,
  onDecline,
  onTopUp,
}: {
  ask: Ask;
  status: "pending" | "allowed" | "declined";
  balance: number;
  onAllow: () => void;
  onAlways: () => void;
  onDecline: () => void;
  onTopUp: () => void;
}) {
  const short = ask.credits !== undefined && ask.credits > balance;
  // The bar is your balance; the filled part is what this takes from it.
  const share = ask.credits ? Math.min(1, ask.credits / Math.max(balance, 1)) : 0;
  return (
    <div className="overflow-hidden rounded-2xl border border-primary/30 bg-primary/[0.04]">
      <div className="flex items-start gap-3 p-4">
        <KindTile kind={ask.kind} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{ask.title}</p>
          <ol className="mt-1.5 space-y-1 text-sm text-muted-foreground">
            {ask.items.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="tabular-nums text-foreground/50">{i + 1}</span> {item}
              </li>
            ))}
          </ol>
        </div>
        {status === "pending" ? (
          <TooltipHint label={ask.decline}>
            <button
              type="button"
              aria-label={ask.decline}
              onClick={onDecline}
              className="-mr-1 -mt-1 flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </TooltipHint>
        ) : null}
      </div>
      {ask.queue ? (
        // One left edge: what happens, which screening it waits for, and how far that one has got.
        <div className="mx-4 mb-3 space-y-1.5 rounded-xl bg-background/70 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium">Waits for your other screening</span>
            <Link href="/settings/billing" className="shrink-0 font-medium text-primary hover:underline">
              See plans
            </Link>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate">{OTHER_SCREENING.chat}</span>
            <span className="shrink-0 tabular-nums">
              {OTHER_SCREENING.start} of {OTHER_SCREENING.total}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
            <span
              className="block h-full rounded-full"
              style={{ width: `${(OTHER_SCREENING.start / OTHER_SCREENING.total) * 100}%`, backgroundColor: KIND.screening!.tint }}
            />
          </div>
        </div>
      ) : null}
      {ask.credits ? (
        <div className="space-y-2 px-4 pb-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Coins className="size-3.5 text-primary" />
            <span className="font-medium text-foreground">About {ask.credits} credits</span>
            <span className="ml-auto flex items-center gap-1.5">
              <AnimatedNumber value={balance} />
              <ArrowRight className="size-3" />
              {/* Both labels hold their place, so the row never reflows when the balance changes. */}
              <span className="grid font-medium [&>*]:col-start-1 [&>*]:row-start-1 [&>*]:text-right">
                <motion.span initial={false} animate={{ opacity: short ? 1 : 0 }} className="tabular-nums text-amber-600 dark:text-amber-400">
                  {ask.credits - balance > 0 ? ask.credits - balance : 0} short
                </motion.span>
                <motion.span initial={false} animate={{ opacity: short ? 0 : 1 }} className="text-foreground">
                  <AnimatedNumber value={Math.max(0, balance - ask.credits)} /> left
                </motion.span>
              </span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <motion.span
              className={cn("block h-full rounded-full", short ? "bg-amber-400" : "bg-primary")}
              initial={false}
              animate={{ width: `${share * 100}%` }}
              transition={{ type: "spring", stiffness: 170, damping: 26 }}
            />
          </div>
        </div>
      ) : (
        <p className="px-4 pb-4 text-xs text-muted-foreground">Visitors see this as soon as it's live. It asks every time.</p>
      )}
      <AnimatePresence initial={false}>
        {status === "pending" ? (
          <motion.div key="ask" exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE }} className="border-t border-primary/15">
            {/* The two sets of buttons share one cell and cross-fade, so the card keeps its height. */}
            <div className="grid p-3 [&>*]:col-start-1 [&>*]:row-start-1">
              <motion.div
                initial={false}
                animate={{ opacity: short ? 0 : 1, scale: short ? 0.98 : 1 }}
                transition={{ duration: 0.25, ease: EASE }}
                inert={short}
                className={cn("grid gap-2", ask.always ? "grid-cols-2" : "grid-cols-[1fr_auto]")}
              >
                <Button className="h-9" onClick={onAllow}>{ask.confirm}</Button>
                {ask.always ? (
                  <Button className="h-9" variant="secondary" onClick={onAlways}>Always allow in this chat</Button>
                ) : (
                  <Button className="h-9 px-4" variant="secondary" onClick={onDecline}>Not now</Button>
                )}
              </motion.div>
              <motion.div
                initial={false}
                animate={{ opacity: short ? 1 : 0, scale: short ? 1 : 0.98 }}
                transition={{ duration: 0.25, ease: EASE }}
                inert={!short}
                className="grid grid-cols-[1fr_auto] gap-2"
              >
                <Button className="h-9 gap-1.5" onClick={onTopUp}>
                  <Plus className="size-4" /> Add credits
                </Button>
                <Button className="h-9 px-4" variant="secondary" onClick={onDecline}>Not now</Button>
              </motion.div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * A screening job. It first waits for the other screening when the plan runs one
 * at a time, then fills in as papers are decided. Waiting and running share one
 * frame, cross-fading their bar and legend, so the card never changes size.
 */
export function JobCard({
  done,
  total,
  counts,
  waiting,
  stopped,
}: {
  done: number;
  total: number;
  counts: { include: number; exclude: number; unsure: number };
  /** How far the other screening has got, while this one waits for it. */
  waiting?: number;
  stopped?: boolean;
}) {
  const finished = done >= total;
  const queued = waiting !== undefined;
  const credits = Math.round((done / total) * SCREEN_CREDITS);
  const seg = (n: number) => `${(n / total) * 100}%`;
  const fade = (on: boolean) => ({ initial: false as const, animate: { opacity: on ? 1 : 0 }, transition: { duration: 0.3, ease: EASE } });
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
      <div className="flex items-center gap-3">
        <KindTile kind="screening" working={!finished && !stopped} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {queued && !stopped ? (
              <WorkingText>Waiting to screen 24 papers</WorkingText>
            ) : stopped ? (
              `Stopped at ${done} of ${total}`
            ) : finished ? (
              "Screened 24 papers"
            ) : (
              <WorkingText>Screening 24 papers</WorkingText>
            )}
          </p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Coins className="size-3" /> <span className="tabular-nums">{credits}</span> credits
          </p>
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {done}
          <span className="font-normal text-muted-foreground"> / {total}</span>
        </span>
      </div>
      <div className="mt-3 grid h-2 [&>*]:col-start-1 [&>*]:row-start-1">
        {/* The other screening's progress, in the screening tint. */}
        <motion.div {...fade(queued)} className="h-2 overflow-hidden rounded-full bg-foreground/10">
          <motion.span
            className="block h-full rounded-full"
            style={{ backgroundColor: KIND.screening!.tint }}
            initial={false}
            animate={{ width: `${((waiting ?? OTHER_SCREENING.total) / OTHER_SCREENING.total) * 100}%` }}
            transition={{ duration: 0.25, ease: EASE }}
          />
        </motion.div>
        {/* One track: included, excluded and unclear fill it from the left as papers are decided. */}
        <motion.div {...fade(!queued)} className="flex h-2 overflow-hidden rounded-full bg-foreground/10">
          <motion.span className="h-full bg-emerald-500" animate={{ width: seg(counts.include) }} transition={{ duration: 0.3, ease: EASE }} />
          <motion.span className="h-full bg-slate-400/70" animate={{ width: seg(counts.exclude) }} transition={{ duration: 0.3, ease: EASE }} />
          <motion.span className="h-full bg-amber-400" animate={{ width: seg(counts.unsure) }} transition={{ duration: 0.3, ease: EASE }} />
        </motion.div>
      </div>
      <div className="mt-2.5 grid text-xs text-muted-foreground [&>*]:col-start-1 [&>*]:row-start-1">
        <motion.div {...fade(queued)} inert={!queued} className="flex min-w-0 items-center gap-2">
          <Hourglass className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{OTHER_SCREENING.chat}</span>
          <span className="ml-auto shrink-0 tabular-nums">
            {waiting ?? OTHER_SCREENING.total} of {OTHER_SCREENING.total}
          </span>
        </motion.div>
        <motion.div {...fade(!queued)} inert={queued} className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Check className="size-3 text-emerald-600" /> <span className="tabular-nums">{counts.include}</span> included</span>
          <span className="flex items-center gap-1"><X className="size-3" /> <span className="tabular-nums">{counts.exclude}</span> excluded</span>
          <span className="flex items-center gap-1"><CircleHelp className="size-3 text-amber-600" /> <span className="tabular-nums">{counts.unsure}</span> unclear</span>
          <button type="button" className="ml-auto flex items-center gap-1 font-medium text-foreground/80 hover:text-foreground">
            Open <ExternalLink className="size-3" />
          </button>
        </motion.div>
      </div>
    </div>
  );
}

/** One way to answer a question the assistant asks back. */
export type Option = { id: string; name: string; detail: ReactNode };

/**
 * A question the assistant asks instead of guessing: tap an answer, or type one in
 * the composer. Once answered, the other options fold away and the pick stays.
 */
export function QuestionCard({
  question,
  hint,
  options,
  picked,
  typed,
  onPick,
}: {
  question: string;
  hint: string;
  options: readonly Option[];
  picked: string | null;
  /** What the person typed instead of tapping, if they did. */
  typed?: string;
  onPick: (id: string) => void;
}) {
  const shown = picked === null ? options : options.filter((o) => o.id === picked);
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-muted/40">
      <div className="flex items-center gap-3 px-4 pb-2 pt-4">
        <KindTile kind="collection" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{question}</p>
          <p className="truncate text-xs text-muted-foreground">{typed ? `You answered “${typed}”` : picked ? "Answered" : hint}</p>
        </div>
      </div>
      <ul className="px-2 pb-2">
        <AnimatePresence initial={false}>
          {shown.map((o, i) => (
            <motion.li
              key={o.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE, delay: 0.05 + i * 0.05 } }}
              exit={{ opacity: 0, height: 0, transition: { duration: 0.3, ease: EASE } }}
              className="overflow-hidden"
            >
              <button
                type="button"
                disabled={picked !== null}
                onClick={() => onPick(o.id)}
                className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-background/70 active:scale-[0.99] disabled:hover:bg-transparent"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background/80 text-muted-foreground">
                  {o.id === "new" ? <FolderPlus className="size-4" /> : <Folder className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{o.name}</span>
                  <span className="mt-0.5 flex">{o.detail}</span>
                </span>
                {picked === o.id ? (
                  <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}>
                    <Check className="size-4 text-primary" aria-label="Picked" />
                  </motion.span>
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                )}
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

/** A collection the assistant filled, by name and ID, with undo. */
export function CollectionCard({
  name,
  count,
  undone,
  canUndo,
  onUndo,
}: {
  name: string;
  count: number;
  undone: boolean;
  canUndo: boolean;
  onUndo: () => void;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 p-3 transition-opacity", undone && "opacity-50")}>
      <KindTile kind="collection" />
      <div className="min-w-0 flex-1">
        <TooltipHint label={name} onlyWhenClipped>
          <p className="truncate text-sm font-semibold">{name}</p>
        </TooltipHint>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{count} papers</span>
          <span className="flex items-center gap-1 rounded-md bg-foreground/6 px-1.5 py-0.5 font-mono text-[11px]">
            col_7f3kq2
            <TooltipHint label="Copy ID">
              <button type="button" aria-label="Copy ID" className="text-muted-foreground hover:text-foreground">
                <Copy className="size-3" />
              </button>
            </TooltipHint>
          </span>
        </p>
      </div>
      {undone ? (
        <span className="px-2 text-xs text-muted-foreground">Removed</span>
      ) : !canUndo ? null : (
        <button
          type="button"
          onClick={onUndo}
          className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Undo2 className="size-3" /> Undo
        </button>
      )}
    </div>
  );
}
