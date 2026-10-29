"use client";

// Mock (mock/ai-overview): the charts an overview places between its paragraphs. Each draws a
// count the model read, so the numbers are OpenAlex's.

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Group, Paper } from "@/lib/ai-overview-mock/openalex";
import { EASE } from "@/components/settings/model-map";
import { cn } from "@/lib/utils";

const grow = (reduce: boolean | null, i: number) => (reduce ? { duration: 0 } : { duration: 0.5, ease: EASE, delay: i * 0.015 });

/** Papers per year as bars; the hovered year names itself in the corner. */
export function YearBars({ groups, label = "Papers per year" }: { groups: Group[]; label?: string }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<Group | null>(null);
  const max = Math.max(1, ...groups.map((g) => g.count));
  const shown = hover ?? groups.reduce((best, g) => (g.count > best.count ? g : best), groups[0]);
  if (!groups.length) return null;
  return (
    <figure className="rounded-xl bg-inset px-4 pt-3 pb-2.5" aria-label={label}>
      <figcaption className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="w-32 shrink-0 text-right tabular-nums text-muted-foreground">
          {/* The number ends the line, flush right, so it keeps its place as the hovered year changes. */}
          {shown.key}
          <span className="ml-2 inline-block min-w-12 text-right font-semibold text-foreground">{shown.count.toLocaleString("en")}</span>
        </span>
      </figcaption>
      <div className="mt-2 flex h-24 items-end gap-[3px]" onPointerLeave={() => setHover(null)}>
        {groups.map((g, i) => (
          <div key={g.key} className="flex h-full flex-1 items-end" onPointerEnter={() => setHover(g)}>
            <motion.div
              className={cn("w-full origin-bottom rounded-t-[3px] transition-colors", g === shown ? "bg-primary" : "bg-primary/35")}
              style={{ height: `${Math.max(2, (g.count / max) * 100)}%` }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={grow(reduce, i)}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{groups[0].key}</span>
        <span>{groups.at(-1)!.key}</span>
      </div>
    </figure>
  );
}

/** Change on the year before, in percent, above and below a zero line. */
export function ChangeBars({ groups }: { groups: Group[] }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<Group | null>(null);
  const max = Math.max(1, ...groups.map((g) => Math.abs(g.count)));
  if (!groups.length) return null;
  const shown = hover ?? groups.at(-1)!;
  return (
    <figure className="rounded-xl bg-inset px-4 pt-3 pb-2.5" aria-label="Change on the year before">
      <figcaption className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-foreground">Change on the year before</span>
        <span className="w-32 shrink-0 text-right tabular-nums text-muted-foreground">
          {shown.key}
          <span className="ml-2 inline-block min-w-12 text-right font-semibold text-foreground">
            {shown.count > 0 ? "+" : ""}
            {shown.count}%
          </span>
        </span>
      </figcaption>
      <div className="mt-2 flex h-20 gap-1.5" onPointerLeave={() => setHover(null)}>
        {groups.map((g, i) => (
          <div key={g.key} className="flex flex-1 flex-col" onPointerEnter={() => setHover(g)}>
            <div className="flex flex-1 items-end">
              {g.count > 0 ? <motion.div className={cn("w-full origin-bottom rounded-t-[3px]", g === shown ? "bg-primary" : "bg-primary/35")} style={{ height: `${(g.count / max) * 100}%` }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={grow(reduce, i)} /> : null}
            </div>
            <div className="h-px bg-border" />
            <div className="flex flex-1 items-start">
              {g.count < 0 ? <motion.div className={cn("w-full origin-top rounded-b-[3px]", g === shown ? "bg-destructive" : "bg-destructive/35")} style={{ height: `${(-g.count / max) * 100}%` }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={grow(reduce, i)} /> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{groups[0].key}</span>
        <span>{groups.at(-1)!.key}</span>
      </div>
    </figure>
  );
}

/** Share of papers per group, as rows with a bar each. */
export function ShareBars({ groups, total, label }: { groups: Group[]; total: number; label: string }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...groups.map((g) => g.count));
  return (
    <figure className="rounded-xl bg-inset px-4 py-3" aria-label={label}>
      <figcaption className="text-xs font-medium text-foreground">{label}</figcaption>
      <ul className="mt-2.5 space-y-1.5">
        {groups.map((g, i) => (
          <li key={g.key} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-3 text-xs">
            <span className="truncate text-foreground">{g.name}</span>
            <span className="h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
              <motion.span className="block h-full origin-left rounded-full bg-primary/70" style={{ width: `${(g.count / max) * 100}%` }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={grow(reduce, i * 3)} />
            </span>
            <span className="text-right tabular-nums text-muted-foreground">{Math.round((g.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The papers an overview cites, with their citations as bars against the most cited. Each row opens its paper. */
export function PaperRows({ papers, onOpen }: { papers: Paper[]; onOpen: (index: number) => void }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...papers.map((p) => p.cited));
  return (
    <ol className="divide-y divide-border-subtle overflow-hidden rounded-xl bg-inset">
      {papers.map((paper, i) => (
        <li key={paper.id}>
          <button type="button" onClick={() => onOpen(i)} className="grid w-full grid-cols-[1fr_7rem] items-center gap-4 px-4 py-2.5 text-left text-sm hover:bg-foreground/[0.03]">
            <span className="min-w-0">
              <span className="line-clamp-1 font-medium text-foreground">{paper.title}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{paper.year}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                <motion.span className="block h-full origin-left rounded-full bg-primary/70" style={{ width: `${(paper.cited / max) * 100}%` }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={grow(reduce, i * 3)} />
              </span>
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{paper.cited.toLocaleString("en")}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
