"use client";

// Small pieces the screening page's views share.
import { useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { BookMarked, Check, CircleHelp, FolderOpen, ListChecks, Search, Star, TriangleAlert, X, type AppIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { OUTCOMES, type Answer, type Outcome, type PaperSet, type Phase } from "@/lib/screening/setup";

export const OUTCOME: Record<Outcome, { bar: string; text: string; icon: AppIcon }> = {
  included: { bar: "bg-success", text: "ink-success", icon: Check },
  unclear: { bar: "bg-warning", text: "ink-warning", icon: CircleHelp },
  excluded: { bar: "bg-muted-foreground/35", text: "text-muted-foreground", icon: X },
  failed: { bar: "bg-destructive", text: "text-destructive", icon: TriangleAlert },
};

export const ANSWER: Record<Answer, { icon: AppIcon; className: string }> = {
  yes: { icon: Check, className: "bg-success/12 ink-success" },
  no: { icon: X, className: "bg-muted text-muted-foreground" },
  unclear: { icon: CircleHelp, className: "bg-warning/12 ink-warning" },
};

export const SOURCE_ICON: Record<PaperSet["kind"], AppIcon> = { search: Search, collection: FolderOpen, saved: BookMarked, screening: ListChecks };

/** One answer as a small square with its sign; `label` names its question. */
export function AnswerMark({ answer, changed, label }: { answer: Answer; changed?: boolean; label: string }) {
  const t = useTranslations("screeningPage");
  const { icon: Icon, className } = ANSWER[answer];
  return (
    <span
      role="img"
      aria-label={t(changed ? "answerMarkChanged" : "answerMark", { question: label, answer: t(`answer.${answer}`) })}
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
      {OUTCOMES.map((o) => (counts[o] ? <span key={o} className={cn(part, OUTCOME[o].bar)} style={{ flexGrow: counts[o] }} /> : null))}
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
export function ProgressRing({ value, max, phase }: { value: number; max: number; phase: Exclude<Phase, "processing"> }) {
  const t = useTranslations("screeningPage");
  const size = 56;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const f = max ? value / max : 0;
  const stroke =
    phase === "completed" ? "stroke-success" : phase === "running" ? "stroke-primary" : phase === "waiting" ? "stroke-warning" : phase === "cancelled" ? "stroke-muted-foreground/50" : "stroke-destructive";
  return (
    <span className="relative inline-flex size-14 shrink-0" role="img" aria-label={t("screenedOf", { done: value, total: max })}>
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
        {phase === "completed" ? (
          <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }}>
            <Check className="size-5 text-success" />
          </motion.span>
        ) : (
          <span><AnimatedNumber value={Math.round(f * 100)} />%</span>
        )}
      </span>
    </span>
  );
}

/** A small fact chip: an icon, then a short label. */
export function Chip({ icon: Icon, children, className }: { icon?: AppIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-foreground/[0.06] px-2 text-xs tabular-nums text-muted-foreground", className)}>
      {Icon ? <Icon className="size-3.5" /> : null}
      {children}
    </span>
  );
}

export function Stars({ count, of = 5 }: { count: number; of?: number }) {
  const t = useTranslations("screeningPage");
  return (
    <span role="img" aria-label={t("starsOf", { count, of })} className="inline-flex shrink-0 items-center gap-0.5">
      {Array.from({ length: of }, (_, i) => (
        <Star key={i} aria-hidden className={cn("size-3", i < count ? "fill-rating text-rating" : "text-muted-foreground/30")} />
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

/**
 * A number that rolls to each new value, the way iOS counts a balance up, as the
 * assistant's numbers do. It jumps straight there when motion is reduced.
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
