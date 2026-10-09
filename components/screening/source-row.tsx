"use client";

// A place papers come from, as screening lists them: a search, a collection, saved papers or a
// screening. Picked, a row opens to how many of its papers to read.

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Check, type AppIcon } from "@/components/icons";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export function SourceRow({
  on,
  onToggle,
  disabled = false,
  icon: Icon,
  label,
  detail,
  count,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  /** A source with no papers, which there's nothing to take from. */
  disabled?: boolean;
  icon: AppIcon;
  label: ReactNode;
  /** What the source is, under its name. */
  detail?: ReactNode;
  count: ReactNode;
  /** What opens under the row while it's picked. */
  children?: ReactNode;
}) {
  return (
    <div className={cn("transition-colors", on && "bg-primary/5")}>
      <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onToggle} className={cn("flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50", !on && "enabled:hover:bg-muted")}>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset", on ? "text-primary" : "text-muted-foreground")}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="block truncate text-sm font-medium">{label}</span>
          {detail}
        </span>
        {count}
        <PickMark on={on} />
      </button>
      <AnimatePresence initial={false}>
        {on && children ? (
          <motion.div key="open" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
            <div className="space-y-4 pb-4 pl-15 pr-4">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** The picked row's check, springing in as the chat's answer checks do. */
export function PickMark({ on }: { on: boolean }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <AnimatePresence initial={false}>
        {on ? (
          <motion.span key="on" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.12 } }} transition={{ type: "spring", stiffness: 500, damping: 28 }}>
            <Check className="size-4 text-primary" />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

const NUMBER = "h-7 w-20 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none";

export type Scope = "range" | "page" | "all";

/**
 * Which of a source's papers to read, asked the same way for every source: a range of them, the
 * results page being read (a search opened from it), or all. `summary` takes the range's place
 * when the papers aren't a range.
 */
export function PaperScope({ search, scope, onScope, range, onRange, total, label, summary }: {
  search: boolean;
  scope: Scope;
  onScope: (scope: Scope) => void;
  range: [number, number];
  onRange: (range: [number, number]) => void;
  total: number;
  /** The slider's name. */
  label: string;
  summary: ReactNode;
}) {
  const t = useTranslations("screeningPage");
  return (
    <>
      <Segmented
        label={t("whichPapers")}
        value={scope}
        onChange={onScope}
        options={[
          { id: "range" as const, label: t("scope.range") },
          ...(search ? [{ id: "page" as const, label: t("scope.page") }] : []),
          { id: "all" as const, label: search ? t("scope.allResults") : t("scope.allPapers") },
        ]}
      />
      {scope === "range" ? <RangeFields value={range} onChange={onRange} total={total} labels={{ slider: label, from: t("rangeFrom"), to: t("rangeTo"), of: t("rangeOf", { total }), first: t("firstPaper"), last: t("lastPaper") }} /> : summary}
    </>
  );
}

/**
 * Papers `value[0]` to `value[1]` of a source's `total`: a slider for the rough pick and typeable
 * ends for an exact one, since over thousands of papers a drag can't land on one. A typed end
 * moves the range once it's a paper the range can end on, and snaps into it when the field is left.
 */
export function RangeFields({ value, onChange, total, labels }: {
  value: [number, number];
  onChange: (value: [number, number]) => void;
  total: number;
  labels: { slider: string; from: string; to: string; of: string; first: string; last: string };
}) {
  const top = Math.max(1, total);
  const [first, last] = value;
  // The end being typed, as typed, so a half-typed number isn't rewritten under the cursor.
  const [typing, setTyping] = useState<{ end: 0 | 1; text: string } | null>(null);
  const field = (end: 0 | 1, label: string) => {
    const [low, high] = end === 0 ? [1, last] : [first, top];
    const move = (n: number) => onChange(end === 0 ? [n, last] : [first, n]);
    return (
      <Input
        type="number"
        min={low}
        max={high}
        value={typing?.end === end ? typing.text : value[end]}
        onChange={(e) => {
          setTyping({ end, text: e.target.value });
          const n = Number(e.target.value);
          if (e.target.value && Number.isInteger(n) && n >= low && n <= high) move(n);
        }}
        onFocus={(e) => e.target.select()}
        onBlur={() => {
          if (typing?.end === end) move(Math.min(high, Math.max(low, Math.round(Number(typing.text)) || low)));
          setTyping(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label={label}
        className={NUMBER}
      />
    );
  };
  return (
    <div className="space-y-3">
      <Slider min={1} max={top} step={1} value={[first, last]} onValueChange={(v) => onChange([v[0]!, v[1]!])} aria-label={labels.slider} />
      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {labels.from}
        {field(0, labels.first)}
        {labels.to}
        {field(1, labels.last)}
        {labels.of}
      </span>
    </div>
  );
}
