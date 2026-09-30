"use client";

// The results page beside the assistant, reduced to what the mock needs. It
// renders from the same state the assistant changes, so edits show up live.

import { useEffect, type Ref } from "react";
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { Check, CircleHelp, FolderCheck, Quote, Search, SlidersHorizontal, Undo2, X } from "lucide-react";
import { LogoMark } from "./logo-mark";
import { cn } from "@/lib/utils";
import { EASE } from "@/components/settings/model-map";
import {
  ORIGINAL_COUNT, ORIGINAL_PAPERS, ORIGINAL_QUERY, TIGHT_COUNT, TIGHT_FILTERS, TIGHT_PAPERS, TIGHT_QUERY,
  type Decision, type Paper,
} from "./data";

export type PageState = {
  optimized: boolean;
  /** The assistant's additions glow for a moment after it changes the query. */
  highlight: boolean;
  /** How many rows, from the top, have a screening decision. */
  decided: number;
  collected: boolean;
};

/** A number that counts to its new value instead of jumping. */
function Count({ value }: { value: number }) {
  const reduceMotion = useReducedMotion();
  const spring = useSpring(value, { stiffness: 90, damping: 22 });
  const shown = useTransform(spring, (v) => Math.round(v).toLocaleString());
  // The spring is motion's animation system: point it at the new value.
  useEffect(() => {
    if (reduceMotion) spring.jump(value);
    else spring.set(value);
  }, [value, spring, reduceMotion]);
  return <motion.span className="tabular-nums">{shown}</motion.span>;
}

const DECISION: Record<Decision, { icon: typeof Check; label: string; className: string }> = {
  include: { icon: Check, label: "Included", className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  exclude: { icon: X, label: "Excluded", className: "bg-foreground/6 text-muted-foreground" },
  unsure: { icon: CircleHelp, label: "To check", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
};

/** `ref` comes from AnimatePresence, which needs it to lift exiting rows out of the flow. */
function PaperRow({
  paper, decision, collected, index, ref,
}: { paper: Paper; decision?: Decision; collected?: boolean; index: number; ref?: Ref<HTMLLIElement> }) {
  const d = decision ? DECISION[decision] : null;
  return (
    <motion.li
      ref={ref}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.4, ease: EASE, delay: index * 0.04 }}
      className="rounded-2xl border border-border/60 bg-card px-5 py-4 shadow-xs"
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="text-[15px] font-semibold leading-snug text-foreground">
            {paper.title} <span className="font-normal text-muted-foreground">({paper.year})</span>
          </h3>
          <p className="truncate text-sm text-muted-foreground">{paper.authors.join(", ")}</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="truncate italic">{paper.venue}</span>
            <span className="flex shrink-0 items-center gap-1 text-orange-600 dark:text-orange-400">
              <Quote className="size-3" /> {paper.cites}
            </span>
          </div>
        </div>
        {/* The decision column is always there, so a badge arriving never moves the title. */}
        <div className="flex w-24 shrink-0 flex-col items-end gap-1.5">
          <AnimatePresence initial={false}>
            {d ? (
              <motion.span
                key={decision}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", d.className)}
              >
                <d.icon className="size-3" /> {d.label}
              </motion.span>
            ) : null}
            {collected ? (
              <motion.span
                key="collected"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 28, delay: index * 0.05 }}
                className="flex items-center gap-1 rounded-full bg-teal-500/12 px-2 py-0.5 text-xs font-medium text-teal-700 dark:text-teal-300"
              >
                <FolderCheck className="size-3" /> Saved
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </motion.li>
  );
}

export function ResultsPane({ page, onUndo }: { page: PageState; onUndo: () => void }) {
  const papers: Array<Paper & { decision?: Decision }> = page.optimized ? TIGHT_PAPERS : ORIGINAL_PAPERS;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="rounded-2xl border border-border/60 bg-card shadow-sm">
        <div className="flex items-center gap-1 p-3">
          <span className="flex h-8 items-center gap-1.5 rounded-lg bg-background px-3 text-sm font-medium shadow-xs ring-1 ring-border/60">
            <Search className="size-3.5" /> Search
          </span>
          <span className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground">
            <SlidersHorizontal className="size-3.5" /> Adjust
          </span>
        </div>
        <div className="px-4 pb-4">
          <div className="relative rounded-xl border border-border/60 bg-background px-3 pb-3 pt-6">
            <span className="absolute left-3 top-1.5 text-xs text-muted-foreground">Keywords</span>
            {/* Two lines reserved, so a longer query never pushes the results down. */}
            <div className="flex min-h-[calc(2lh)] items-start gap-2 text-sm leading-relaxed">
              <Search className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={page.optimized ? "tight" : "original"}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="min-w-0 leading-relaxed"
                >
                  {page.optimized
                    ? TIGHT_QUERY.map((part, i) => (
                        <span
                          key={i}
                          className={cn(
                            "rounded-sm transition-colors duration-[1200ms]",
                            part.added && (page.highlight ? "bg-primary/20 text-primary" : "text-foreground"),
                          )}
                        >
                          {part.text}
                        </span>
                      ))
                    : ORIGINAL_QUERY}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
        </div>
        <div className="flex min-h-14 items-center gap-3 border-t border-border/50 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            <span className="text-lg font-semibold text-foreground">
              <Count value={page.optimized ? TIGHT_COUNT : ORIGINAL_COUNT} />
            </span>{" "}
            Results
          </p>
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <AnimatePresence initial={false}>
              {page.optimized
                ? TIGHT_FILTERS.map((f, i) => (
                    <motion.span
                      key={f}
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      transition={{ type: "spring", stiffness: 480, damping: 30, delay: 0.25 + i * 0.08 }}
                      className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground/80"
                    >
                      {f}
                    </motion.span>
                  ))
                : null}
            </AnimatePresence>
          </div>
          <AnimatePresence initial={false}>
            {page.optimized ? (
              <motion.div
                key="changed"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 py-1 pl-2.5 pr-1 text-xs font-medium text-primary"
              >
                <LogoMark size={13} /> Changed by the assistant
                <button
                  type="button"
                  onClick={onUndo}
                  className="ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-primary/15"
                >
                  <Undo2 className="size-3" /> Undo
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <ul className="space-y-3">
        <AnimatePresence mode="popLayout" initial={false}>
          {papers.map((p, i) => (
            <PaperRow
              key={`${page.optimized ? "t" : "o"}-${p.id}`}
              paper={p}
              index={i}
              decision={i < page.decided ? p.decision : undefined}
              collected={page.collected && p.decision === "include"}
            />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
