"use client";

// Small pieces the screening mock's views share.
import { Check, CircleHelp, Star, TriangleAlert, X } from "lucide-react";
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

/** Counts as one bar split by outcome, with what's still to come at the end. */
export function OutcomeBar({ counts, total, className }: { counts: Record<Outcome, number>; total: number; className?: string }) {
  return (
    <div className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      {(Object.keys(OUTCOME) as Outcome[]).map((o) =>
        counts[o] ? (
          <span key={o} className={cn("h-full transition-[width] duration-500 ease-out motion-reduce:transition-none", OUTCOME[o].bar)} style={{ width: `${(counts[o] / total) * 100}%` }} />
        ) : null,
      )}
    </div>
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
