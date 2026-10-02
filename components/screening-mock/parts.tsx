"use client";

// Small pieces the screening mock's views share.
import type { ReactNode } from "react";
import { Check, CircleHelp, Star, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Answer, Outcome } from "./data";

export const OUTCOME: Record<Outcome, { label: string; bar: string; text: string; icon: typeof Check }> = {
  included: { label: "Included", bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", icon: Check },
  unclear: { label: "Unclear", bar: "bg-amber-400", text: "text-amber-600 dark:text-amber-400", icon: CircleHelp },
  excluded: { label: "Excluded", bar: "bg-muted-foreground/35", text: "text-muted-foreground", icon: X },
  failed: { label: "Failed", bar: "bg-destructive", text: "text-destructive", icon: TriangleAlert },
};

export const ANSWER: Record<Answer, { label: string; icon: typeof Check; className: string }> = {
  yes: { label: "Yes", icon: Check, className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" },
  no: { label: "No", icon: X, className: "bg-muted text-muted-foreground" },
  unclear: { label: "Unclear", icon: CircleHelp, className: "bg-amber-500/12 text-amber-700 dark:text-amber-400" },
};

/** One answer as a small square with its sign; the label is its name. */
export function AnswerMark({ answer, changed, label }: { answer: Answer; changed?: boolean; label: string }) {
  const { icon: Icon, className } = ANSWER[answer];
  return (
    <span
      role="img"
      aria-label={`${label}: ${ANSWER[answer].label}${changed ? ", changed by you" : ""}`}
      className={cn("inline-flex size-6 items-center justify-center rounded-md", className, changed && "ring-1 ring-primary/60")}
    >
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

/**
 * Counts as one bar split by outcome, then the papers being screened right now as a
 * striped part, then what's still to come.
 */
export function OutcomeBar({ counts, total, flight = 0, className }: { counts: Record<Outcome, number>; total: number; flight?: number; className?: string }) {
  const settled = Object.values(counts).reduce((a, b) => a + b, 0);
  const rest = Math.max(0, total - settled - flight);
  const part = "h-full basis-0 rounded-full transition-[flex-grow] duration-500 ease-out motion-reduce:transition-none";
  return (
    <div className={cn("flex h-2.5 w-full gap-0.5", className)}>
      {(Object.keys(OUTCOME) as Outcome[]).map((o) =>
        counts[o] ? <span key={o} className={cn(part, OUTCOME[o].bar)} style={{ flexGrow: counts[o] }} /> : null,
      )}
      {flight ? (
        <span
          className={cn(part, "animate-pulse motion-reduce:animate-none")}
          style={{ flexGrow: flight, backgroundImage: "repeating-linear-gradient(-45deg, var(--primary) 0 3px, color-mix(in oklab, var(--primary) 30%, transparent) 3px 7px)" }}
        />
      ) : null}
      {rest ? <span className={cn(part, "bg-muted")} style={{ flexGrow: rest }} /> : null}
    </div>
  );
}

/** How far a screening has got, as a ring; a check once it's done. */
export function ProgressRing({ value, max, status }: { value: number; max: number; status: "running" | "waiting" | "completed" | "cancelled" }) {
  const size = 56;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const f = max ? value / max : 0;
  const stroke = status === "completed" ? "stroke-emerald-500" : status === "cancelled" ? "stroke-muted-foreground/50" : status === "waiting" ? "stroke-amber-400" : "stroke-primary";
  return (
    <span className="relative inline-flex size-14 shrink-0" role="img" aria-label={`${value} of ${max} papers screened`}>
      <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={5} className="stroke-foreground/[0.08]" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          className={cn("transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none", stroke)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
        {status === "completed" ? <Check className="size-5 text-emerald-500" /> : `${Math.round(f * 100)}%`}
      </span>
    </span>
  );
}

/** A small fact chip: an icon, then a short label. */
export function Chip({ icon: Icon, children, className }: { icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-foreground/[0.06] px-2 text-xs tabular-nums text-muted-foreground", className)}>
      {Icon ? <Icon className="size-3.5" /> : null}
      {children}
    </span>
  );
}

export function Stars({ count, of = 5 }: { count: number; of?: number }) {
  return (
    <span role="img" aria-label={`${count} of ${of} stars`} className="inline-flex shrink-0 items-center gap-0.5">
      {Array.from({ length: of }, (_, i) => (
        <Star key={i} aria-hidden className={cn("size-3", i < count ? "fill-primary text-primary" : "text-muted-foreground/30")} />
      ))}
    </span>
  );
}

/** A thin meter, filled to `value` of `max`. */
export function Meter({ value, max, className, fill = "bg-primary" }: { value: number; max: number; className?: string; fill?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", fill)} style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} />
    </div>
  );
}
