"use client";

import { useState, type CSSProperties } from "react";
import { AiIcon, Check, CircleHelp, FileText, FileX, Link2, Quote, X, type AppIcon } from "@/components/icons";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { AnimatedNumber } from "@/components/screening/parts";
import { LIST } from "@/components/settings/parts";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * How close a record is to the subject, as AI read it. The first three run from the primary colour down, since
 * they are one scale; the rest are grey, and amber where AI could not tell.
 */
const VERDICT = {
  about: { label: "About it", icon: Check, fill: "bg-primary", ink: "text-primary-foreground" },
  touches: { label: "Touches on it", icon: Link2, fill: "bg-primary/60", ink: "text-primary-foreground" },
  passing: { label: "Mentions it in passing", icon: Quote, fill: "bg-primary/30", ink: "text-primary" },
  "not-about": { label: "Not about it", icon: X, fill: "bg-muted-foreground/50", ink: "text-background" },
  "not-research": { label: "Not a research publication", icon: FileX, fill: "bg-muted-foreground/25", ink: "text-foreground" },
  unclear: { label: "Can't tell, no abstract", icon: CircleHelp, fill: "bg-warning", ink: "text-warning-foreground" },
} satisfies Record<string, { label: string; icon: AppIcon; fill: string; ink: string }>;

export type VerdictKey = keyof typeof VERDICT;
export const VERDICT_KEYS = Object.keys(VERDICT) as VerdictKey[];
/** `count` is null until the source has been screened; `example` is a record AI gave this verdict. */
export type ScreeningVerdict = { key: VerdictKey; count: number | null; kept: boolean; example?: string };

// Kept out of the library: the verdict's colour, cut by stripes of the surface behind it.
const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(-45deg, transparent 0 2px, var(--card) 2px 4px)",
};
const STRIPES: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(-45deg, var(--primary) 0 3px, color-mix(in oklab, var(--primary) 30%, transparent) 3px 7px)",
};
const PART = "h-full min-w-1 basis-0 rounded-full transition-[flex-grow,opacity] duration-500 ease-out motion-reduce:transition-none";

/**
 * A band at the foot of a source row with what AI screening found: the subject it reads for, the source's records as one bar split by
 * verdict, and a row per verdict that keeps it in the library or out. `progress` is set while AI is reading.
 */
export function SourceScreening({
  subject,
  subjectPlaceholder,
  onSubjectChange,
  verdicts,
  onKeptChange,
  progress,
}: {
  subject: string;
  subjectPlaceholder: string;
  onSubjectChange: (subject: string) => void;
  verdicts: ScreeningVerdict[];
  onKeptChange: (key: VerdictKey, kept: boolean) => void;
  progress?: { title: string; left: number };
}) {
  // The verdict under the pointer, in the bar or in the list: it stands out in both.
  const [hot, setHot] = useState<VerdictKey | null>(null);
  const screened = verdicts.some((verdict) => verdict.count !== null);
  const total = verdicts.reduce((sum, verdict) => sum + (verdict.count ?? 0), 0);
  // The part of the bar AI is reading now: wide enough to see, whatever the batch.
  const flight = (total + (progress?.left ?? 0)) / 30;
  const kept = verdicts.reduce((sum, verdict) => sum + (verdict.kept ? verdict.count ?? 0 : 0), 0);
  return (
    <section aria-label="Screening" className="space-y-3 border-b border-primary/10 bg-primary/[0.05] px-4 pb-4 pt-3.5">
      <div className="relative">
        <AiIcon size={16} className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
        <Input
          className="bg-card pl-9"
          aria-label="What to screen for"
          value={subject}
          placeholder={subjectPlaceholder}
          onChange={(event) => onSubjectChange(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex h-8 items-end justify-between gap-4 text-xs">
          {screened ? (
            <span className="shrink-0 text-muted-foreground">
              <span className="text-2xl font-semibold leading-none text-foreground"><AnimatedNumber value={kept} /></span>{" "}
              in the library
            </span>
          ) : (
            <span className="text-sm font-medium">Not screened yet</span>
          )}
          {progress ? (
            <span className="flex min-w-0 items-center gap-1.5 text-primary" role="status">
              <AiIcon working size={14} className="size-3.5 shrink-0" />
              <span className="shrink-0 font-medium">Reading</span>
              <Shimmer as="span" duration={1.4} className="min-w-0 truncate">{progress.title}</Shimmer>
            </span>
          ) : screened ? (
            <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
              <span aria-hidden className="h-2.5 w-5 rounded-full bg-muted-foreground/50" style={HATCH} />
              <span className="tabular-nums text-foreground"><AnimatedNumber value={total - kept} /></span> kept out
            </span>
          ) : (
            <span className="text-muted-foreground">Starts with the next import</span>
          )}
        </div>
        <div className="flex h-3 w-full gap-0.5" aria-hidden>
          {verdicts.map(({ key, count, kept: stays }) =>
            count ? (
              <span
                key={key}
                className={cn(PART, VERDICT[key].fill, hot && hot !== key && "opacity-30")}
                style={{ flexGrow: count, ...(stays ? null : HATCH) }}
                onPointerEnter={() => setHot(key)}
                onPointerLeave={() => setHot(null)}
              />
            ) : null,
          )}
          {progress ? (
            <>
              <span className={cn(PART, "animate-pulse motion-reduce:animate-none")} style={{ flexGrow: Math.min(progress.left, flight), ...STRIPES }} />
              {progress.left > flight ? <span className={cn(PART, "bg-primary/10")} style={{ flexGrow: progress.left - flight }} /> : null}
            </>
          ) : screened ? null : (
            <span className={cn(PART, "grow bg-primary/10")} />
          )}
        </div>
      </div>

      <ul className={cn(LIST, "rounded-lg bg-card text-xs")}>
        {verdicts.map(({ key, count, kept: stays, example }) => {
          const { label, icon: Icon, fill, ink } = VERDICT[key];
          return (
            <li
              key={key}
              className={cn(
                "grid grid-cols-[1.5rem_minmax(0,1fr)_5ch_8ch_auto] items-center gap-x-3 px-3 py-2 transition-colors",
                hot === key && "bg-primary/[0.06]",
              )}
              onPointerEnter={() => setHot(key)}
              onPointerLeave={() => setHot(null)}
            >
              <span aria-hidden className={cn("grid size-6 place-items-center rounded-md transition-opacity", fill, ink, !stays && "opacity-55")}>
                <Icon className="size-3.5" />
              </span>
              <span className={cn("flex min-w-0 items-center gap-3 transition-opacity", !stays && "opacity-55")}>
                <span className="shrink-0 font-medium">{label}</span>
                {example ? (
                  <span className="flex min-w-0 items-center gap-1 text-muted-foreground @max-lg/source:hidden">
                    <FileText aria-hidden className="size-3.5 shrink-0 self-center" />
                    <TooltipHint label={example} onlyWhenClipped>
                      <span className="min-w-0 truncate">{example}</span>
                    </TooltipHint>
                  </span>
                ) : null}
              </span>
              <span className={cn("text-right tabular-nums text-muted-foreground transition-opacity", !stays && "opacity-55")}>
                {count === null || !total ? null : `${((100 * count) / total).toFixed(1)}%`}
              </span>
              <span className={cn("text-right font-medium transition-opacity", !stays && "opacity-55")}>
                {count === null ? null : <AnimatedNumber value={count} />}
              </span>
              <Switch
                checked={stays}
                aria-label={`Keep in the library: ${label}`}
                onCheckedChange={(checked) => onKeptChange(key, checked)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
