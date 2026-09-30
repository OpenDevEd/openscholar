"use client";

// What the assistant did in a turn, drawn like the AI settings routing map: the
// request at the top, a tinted curve out to each step's card, one card per step.

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, CircleHelp, Coins, Copy, ExternalLink, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { EASE } from "@/components/settings/model-map";
import { BALANCE, COLLECTED, COLLECTION_NAME, KIND, SCREEN_CREDITS, VERSIONS } from "./data";
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

export type Step = {
  kind: keyof typeof KIND;
  title: string;
  detail: ReactNode;
  status: "working" | "done" | "undone";
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
            animate={{ pathLength: 1, opacity: s.status === "undone" ? 0.25 : 1 }}
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
              animate={{ opacity: s.status === "undone" ? 0.5 : 1, x: 0, scale: 1 }}
              transition={{ duration: 0.4, ease: EASE, delay: reduceMotion ? 0 : 0.15 }}
            >
              <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 px-3" style={{ height: CARD }}>
                <KindTile kind={s.kind} working={s.status === "working"} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className={cn("truncate text-sm font-semibold", s.status === "undone" && "line-through decoration-muted-foreground/60")}>
                    {s.status === "working" ? <WorkingText>{s.title}</WorkingText> : s.title}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">{s.detail}</div>
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

/** Asks before spending credits. */
/** What an approval card asks for. `credits` is set when it spends them; `always` offers the per-chat allowance. */
export type Ask = {
  kind: keyof typeof KIND;
  title: string;
  items: string[];
  credits?: number;
  always: boolean;
  confirm: string;
  decline: string;
};

/** Asks before spending credits or making something public. */
export function ApprovalCard({
  ask,
  status,
  onAllow,
  onAlways,
  onDecline,
}: {
  ask: Ask;
  status: "pending" | "allowed" | "declined";
  onAllow: () => void;
  onAlways: () => void;
  onDecline: () => void;
}) {
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
      {ask.credits ? (
        <div className="flex items-center gap-2 px-4 pb-4 text-xs text-muted-foreground">
          <Coins className="size-3.5 text-primary" />
          <span className="font-medium text-foreground">About {ask.credits} credits</span>
          <span className="ml-auto flex items-center gap-1.5 tabular-nums">
            {BALANCE.toLocaleString()}
            <ArrowRight className="size-3" />
            <span className="font-medium text-foreground">{(BALANCE - ask.credits).toLocaleString()}</span> left
          </span>
        </div>
      ) : (
        <p className="px-4 pb-4 text-xs text-muted-foreground">Visitors see this as soon as it's live. It asks every time.</p>
      )}
      <AnimatePresence initial={false} mode="wait">
        {status === "pending" ? (
          <motion.div
            key="ask"
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className={cn("grid gap-2 border-t border-primary/15 p-3", ask.always ? "grid-cols-2" : "grid-cols-[1fr_auto]")}
          >
            <Button className="h-9" onClick={onAllow}>{ask.confirm}</Button>
            {ask.always ? (
              <Button className="h-9" variant="secondary" onClick={onAlways}>Always allow in this chat</Button>
            ) : (
              <Button className="h-9 px-4" variant="secondary" onClick={onDecline}>Not now</Button>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** A running screening, updating as papers are decided. */
export function JobCard({ done, total, counts }: { done: number; total: number; counts: { include: number; exclude: number; unsure: number } }) {
  const finished = done >= total;
  const credits = Math.round((done / total) * SCREEN_CREDITS);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
      <div className="flex items-center gap-3">
        <KindTile kind="screening" working={!finished} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {finished ? "Screened 24 papers" : <WorkingText>Screening 24 papers</WorkingText>}
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
      {/* One track: included, excluded and unclear fill it from the left as papers are decided. */}
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-foreground/10">
        <motion.span className="h-full bg-emerald-500" animate={{ width: seg(counts.include) }} transition={{ duration: 0.3, ease: EASE }} />
        <motion.span className="h-full bg-slate-400/70" animate={{ width: seg(counts.exclude) }} transition={{ duration: 0.3, ease: EASE }} />
        <motion.span className="h-full bg-amber-400" animate={{ width: seg(counts.unsure) }} transition={{ duration: 0.3, ease: EASE }} />
      </div>
      <div className="mt-2.5 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Check className="size-3 text-emerald-600" /> <span className="tabular-nums">{counts.include}</span> included</span>
        <span className="flex items-center gap-1"><X className="size-3" /> <span className="tabular-nums">{counts.exclude}</span> excluded</span>
        <span className="flex items-center gap-1"><CircleHelp className="size-3 text-amber-600" /> <span className="tabular-nums">{counts.unsure}</span> to check</span>
        <button type="button" className="ml-auto flex items-center gap-1 font-medium text-foreground/80 hover:text-foreground">
          Open <ExternalLink className="size-3" />
        </button>
      </div>
    </div>
  );
}

/** A collection the assistant made, by name and ID, with undo. */
export function CollectionCard({ undone, canUndo, onUndo }: { undone: boolean; canUndo: boolean; onUndo: () => void }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 p-3 transition-opacity", undone && "opacity-50")}>
      <KindTile kind="collection" />
      <div className="min-w-0 flex-1">
        <TooltipHint label={COLLECTION_NAME} onlyWhenClipped>
          <p className="truncate text-sm font-semibold">{COLLECTION_NAME}</p>
        </TooltipHint>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{COLLECTED} papers</span>
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
