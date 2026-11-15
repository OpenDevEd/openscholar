"use client";

// A place papers come from, as screening and extraction list them: a search, a collection, saved
// papers or a screening. Screening picks one; extraction takes several. Picked, a row opens to how
// many of its papers to read.

import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
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
  many = false,
  icon: Icon,
  label,
  detail,
  count,
  children,
}: {
  on: boolean;
  /** Without it, the row only says what the source is: one that came with the page, with nothing to pick. */
  onToggle?: () => void;
  /** A source with no papers, which there's nothing to take from. */
  disabled?: boolean;
  /** Extraction takes any number of sources, so a row is a checkbox there; screening's is a radio. */
  many?: boolean;
  icon: AppIcon;
  label: ReactNode;
  /** What the source is, under its name. */
  detail?: ReactNode;
  count: ReactNode;
  /** What opens under the row while it's picked. */
  children?: ReactNode;
}) {
  const Row = onToggle ? "button" : "div";
  return (
    <div className={cn("transition-colors", on && "bg-primary/5")}>
      <Row {...(onToggle ? { type: "button", role: many ? "checkbox" : "radio", "aria-checked": on, disabled, onClick: onToggle } : {})} className={cn("flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50", onToggle && !on && "enabled:hover:bg-muted")}>
        <span className={cn("flex size-8 shrink-0 items-center justify-center self-start rounded-lg bg-inset", on ? "text-primary" : "text-muted-foreground")}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="block truncate text-sm font-medium">{label}</span>
          {detail}
        </span>
        {count}
        <PickMark on={on} />
      </Row>
      <AnimatePresence initial={false}>
        {on && children ? (
          <motion.div key="open" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
            <div className="space-y-4 pb-4 ps-15 pe-4">{children}</div>
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
export function PaperScope({ search, page = search, scope, onScope, range, onRange, total, most = total, label, summary }: {
  search: boolean;
  /** Whether the results page being read is a choice: a search opened from its page. */
  page?: boolean;
  scope: Scope;
  onScope: (scope: Scope) => void;
  range: [number, number];
  onRange: Dispatch<SetStateAction<[number, number]>>;
  total: number;
  /** How far the range may reach, where the plan has room for fewer than `total`. */
  most?: number;
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
          ...(page ? [{ id: "page" as const, label: t("scope.page") }] : []),
          { id: "all" as const, label: search ? t("scope.allResults") : t("scope.allPapers") },
        ]}
      />
      {scope === "range" ? <RangeFields value={range} onChange={onRange} total={total} most={most} labels={{ slider: label, from: t("rangeFrom"), to: t("rangeTo"), of: t("rangeOf", { total }), first: t("firstPaper"), last: t("lastPaper") }} /> : summary}
    </>
  );
}

/**
 * Papers `value[0]` to `value[1]` of a source's `total`: a slider for the rough pick and typeable
 * ends for an exact one, since over thousands of papers a drag can't land on one. A typed end
 * moves the range once it's a paper the range can end on, and snaps into it when the field is left.
 * Each change is worked out from the range as it stands, so a slider move just after a field
 * snaps starts from the snap.
 */
export function RangeFields({ value, onChange, total, most = total, labels }: {
  value: [number, number];
  onChange: Dispatch<SetStateAction<[number, number]>>;
  total: number;
  /** How far the range may reach, where the plan has room for fewer than `total`. */
  most?: number;
  labels: { slider: string; from: string; to: string; of: string; first: string; last: string };
}) {
  const top = Math.max(1, Math.min(total, most));
  const [first, last] = value;
  // The end being typed, as typed, so a half-typed number isn't rewritten under the cursor.
  const [typing, setTyping] = useState<{ end: 0 | 1; text: string } | null>(null);
  /** Moves one end to `n`, kept between the papers the range as it stands lets that end reach. */
  const move = (end: 0 | 1, n: number) =>
    onChange((current) => {
      const [a, b] = [Math.min(current[0], top), Math.min(current[1], top)];
      return end === 0 ? [Math.min(b, Math.max(1, n)), b] : [a, Math.min(top, Math.max(a, n))];
    });
  const field = (end: 0 | 1, label: string) => {
    const [low, high] = end === 0 ? [1, last] : [first, top];
    return (
      <Input
        type="number"
        min={low}
        max={high}
        value={typing?.end === end ? typing.text : value[end]}
        onChange={(e) => {
          setTyping({ end, text: e.target.value });
          const n = Number(e.target.value);
          if (e.target.value && Number.isInteger(n) && n >= low && n <= high) move(end, n);
        }}
        onFocus={(e) => e.target.select()}
        onBlur={() => {
          if (typing?.end === end) move(end, Math.round(Number(typing.text)) || 0);
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
      <Slider min={1} max={top} step={1} value={[first, last]} onValueChange={(v) => (v[0] !== first ? move(0, v[0]!) : move(1, v[1]!))} aria-label={labels.slider} />
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
