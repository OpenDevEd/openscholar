"use client";

import { createContext, useContext, useState, type CSSProperties, type ReactNode } from "react";
import { useAction, useMutation, useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { SourceStatus } from "@/convex/evidenceLibraries/sourceStatusValidators";
import { AiIcon, ArrowRight, Check, FileText, FlaskConical, Link2, Quote, X, type AppIcon } from "@/components/icons";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { AnimatedNumber } from "@/components/screening/parts";
import { LIST } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import type { ScreeningGrade, SourceScreeningSettings } from "@/lib/evidence-libraries/configuration/sources";
import { cn } from "@/lib/utils";
import { DisclosureContent } from "../disclosure-button";
import { errorMessage, SourceSwitch } from "./source-row";

type Report = NonNullable<SourceStatus["screening"]>;
type ReportGrade = keyof Report["grades"];

/** How close a record is to the source's subject, as Jev graded it: one scale, from the primary colour down to grey. */
const GRADE = {
  about: { report: "about", icon: Check, fill: "bg-primary", ink: "text-primary-foreground" },
  touches: { report: "touches", icon: Link2, fill: "bg-primary/60", ink: "text-primary-foreground" },
  passing: { report: "passing", icon: Quote, fill: "bg-primary/30", ink: "text-primary" },
  "not-about": { report: "notAbout", icon: X, fill: "bg-muted-foreground/50", ink: "text-background" },
} satisfies Record<ScreeningGrade, { report: ReportGrade; icon: AppIcon; fill: string; ink: string }>;
const GRADE_KEYS = Object.keys(GRADE) as ScreeningGrade[];
type Grade = { key: ScreeningGrade; count: number; kept: boolean; example: string | null };

export const DEFAULT_SCREENING: SourceScreeningSettings = { enabled: false, subject: "", keptOut: ["not-about"] };

// Measured on ECCAR (2,910 records, 2026-10-12): a whole read costs $0.0000746 a record, asking only the grade 42% of
// that, and the library reads about 40 records a second.
const READ_USD = 0.0000746;
const GRADE_ONLY_SHARE = 0.42;
const RECORDS_PER_SECOND = 40;

// Kept out of the library: the grade's colour, cut by stripes of the surface behind it.
const HATCH: CSSProperties = { backgroundImage: "repeating-linear-gradient(-45deg, transparent 0 2px, var(--card) 2px 4px)" };
const STRIPES: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(-45deg, var(--primary) 0 3px, color-mix(in oklab, var(--primary) 30%, transparent) 3px 7px)",
};
const PART = "h-full min-w-1 basis-0 rounded-full transition-[flex-grow,opacity] duration-500 ease-out motion-reduce:transition-none";

/** A split bar of grades: kept ones in their colour, kept-out ones hatched, and the part still being read striped. */
function GradeBar({ grades, left = 0, hot, onHot, className }: { grades: { key: ScreeningGrade; count: number; kept: boolean }[]; left?: number; hot?: ScreeningGrade | null; onHot?: (key: ScreeningGrade | null) => void; className?: string }) {
  const total = grades.reduce((sum, grade) => sum + grade.count, 0);
  const flight = (total + left) / 30;
  return (
    <div className={cn("flex h-3 w-full gap-0.5", className)} aria-hidden>
      {grades.map(({ key, count, kept }) => count ? (
        <span key={key} className={cn(PART, GRADE[key].fill, hot && hot !== key && "opacity-30")} style={{ flexGrow: count, ...(kept ? null : HATCH) }}
          onPointerEnter={() => onHot?.(key)} onPointerLeave={() => onHot?.(null)} />
      ) : null)}
      {left > 0 ? (
        <>
          {/* The pulse is the part's own animation, so it grows without the opacity transition the other parts have. */}
          <span className="h-full min-w-1 basis-0 animate-pulse rounded-full motion-reduce:animate-none" style={{ flexGrow: Math.min(left, flight), ...STRIPES }} />
          {left > flight ? <span className={cn(PART, "bg-primary/10")} style={{ flexGrow: left - flight }} /> : null}
        </>
      ) : null}
    </div>
  );
}

/** What a new subject would change, read on a sample of the source before anything is saved: its grades now and with it. */
type Trial = { size: number; now: Report["grades"]; next: Report["grades"]; changed: number };

/** A figure and what it counts, for the strip that says what grading costs. */
function Figure({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-lg font-semibold leading-tight tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** Dollars as readers think of them: whole dollars, cents below a dollar, and "under 1¢" below that. */
function useUsd() {
  const t = useTranslations("evidenceLibraryConfiguration.sources.screening");
  const format = useFormatter();
  return (usd: number) => usd >= 1
    ? format.number(usd, { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : usd >= 0.01 ? format.number(usd, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t("underACent");
}

/** How long, in the largest unit that reads naturally. */
function useDuration() {
  const t = useTranslations("evidenceLibraryConfiguration.sources.screening");
  return (seconds: number) => seconds < 60 ? t("underAMinute") : seconds < 3600 ? t("aboutMinutes", { count: Math.round(seconds / 60) }) : t("aboutHours", { count: Math.round(seconds / 3600) });
}

/**
 * Records that need grading: every record of the source after its subject changes, or those not graded against the
 * current subject. Shown as figures beside the actions: how many, what it costs and how long it takes. With a new
 * subject, a trial on 200 records adds how many would change grade, and the sample's grades now and with it.
 */
function GradeCard({ records, changed, sample, trying, onTry, onGrade, kept }: {
  records: number;
  /** The subject was edited, so every record is graded again and a trial is offered. */
  changed: boolean;
  sample?: Trial;
  trying: boolean;
  onTry: () => void;
  onGrade: () => void;
  kept: (key: ScreeningGrade) => boolean;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources.screening");
  const usd = useUsd();
  const duration = useDuration();
  return (
    <div className="space-y-3 rounded-lg bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-x-6 gap-y-2">
          <Figure value={records.toLocaleString()} label={changed ? t("gradedAgain") : t("notGradedYet")} />
          {/* A new subject asks only the grade; a record not read yet gets the whole read. */}
          <Figure value={usd(records * READ_USD * (changed ? GRADE_ONLY_SHARE : 1))} label={t("onLibraryKey")} />
          <Figure value={duration(records / RECORDS_PER_SECOND)} label={t("toFinish")} />
          {sample ? <Figure value={t("ofSample", { changed: sample.changed, size: sample.size })} label={t("changeInTrial")} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {changed && !sample ? (
            <Button type="button" variant="outline" size="sm" onClick={onTry} disabled={trying}>
              {trying ? <AiIcon working size={14} className="size-3.5" /> : <FlaskConical />}
              {trying ? t("trying") : t("tryOnSample")}
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={onGrade}>{changed ? t("gradeAgain") : t("gradeThem")}</Button>
        </div>
      </div>
      {sample ? (
        <div className="space-y-1.5 border-t border-border-subtle pt-3">
          {(["now", "next"] as const).map((which) => (
            <div key={which} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-xs">
              <span className="text-muted-foreground">{which === "now" ? t("currentSubject") : t("newSubject")}</span>
              <GradeBar grades={GRADE_KEYS.map((key) => ({ key, count: sample[which][GRADE[key].report], kept: kept(key) }))} />
            </div>
          ))}
          <ul className="flex flex-wrap gap-x-4 gap-y-1 pl-[calc(7rem+0.75rem)] pt-1 text-xs text-muted-foreground">
            {GRADE_KEYS.map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2 rounded-[3px]", GRADE[key].fill)} />
                {t(`grades.${GRADE[key].report}`)}
                <span className="tabular-nums text-foreground">{sample.now[GRADE[key].report]}</span>
                <ArrowRight aria-hidden className="size-3" />
                <span className="font-medium tabular-nums text-foreground">{sample.next[GRADE[key].report]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The library, the workspace it is opened in and the owner's AI set-up, which every source row's screening reads. */
const ScreeningContext = createContext<{ libraryId: Id<"evidenceLibraries">; workspaceId: Id<"workspaces"> | undefined; aiReady: boolean } | null>(null);
export const SourceScreeningProvider = ScreeningContext.Provider;

function useScreeningContext() {
  const context = useContext(ScreeningContext);
  if (!context) throw new Error("Source screening needs SourceScreeningProvider");
  return context;
}

/**
 * A band at the foot of a source row with what AI screening found: the subject it reads the source's records for, the
 * records as one bar split by grade, and a row per grade that keeps it in the library or out. Each record is read once
 * by Jev when it comes in, which also gives it a study type. A new subject is tried on a sample first; graded, the
 * source's records are graded again once the settings are activated, and the new grades take over once the last one is.
 */
function ScreeningBand({ sourceKey, screening, onChange, report }: {
  sourceKey: string;
  screening: SourceScreeningSettings;
  onChange: (next: SourceScreeningSettings) => void;
  /** What the library last reported about this source's screening; null before it screens it. */
  report: Report | null;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources.screening");
  const { libraryId, workspaceId } = useScreeningContext();
  const { canRunProtectedQueries } = useAuthReadiness();
  // useQueries hands a failure back instead of throwing it: functions deploy after the site, and a backend without this
  // one leaves the band without its request rather than taking down the configuration editor.
  const asked = useQueries(canRunProtectedQueries && workspaceId
    ? { request: { query: api.evidenceLibraries.assistant.screeningRequest, args: { libraryId, sourceKey, workspaceId } } }
    : {}).request as FunctionReturnType<typeof api.evidenceLibraries.assistant.screeningRequest> | Error | undefined;
  const request = asked instanceof Error ? null : (asked ?? null);
  const grade = useMutation(api.evidenceLibraries.assistant.gradeSource);
  const trySubject = useAction(api.evidenceLibraries.assistant.trySourceSubject);
  const [hot, setHot] = useState<ScreeningGrade | null>(null);
  const [trial, setTrial] = useState<{ subject: string; result: Trial } | null>(null);
  const [trying, setTrying] = useState(false);

  const subject = screening.subject.trim();
  // An older library reports no subject; it is then taken as unchanged.
  const changed = subject !== "" && report?.subject !== undefined && subject !== report.subject.trim();
  const grades: Grade[] = GRADE_KEYS.map((key) => ({
    key,
    count: report?.grades[GRADE[key].report] ?? 0,
    kept: !screening.keptOut.includes(key),
    example: report?.examples?.[GRADE[key].report] ?? null,
  }));
  const graded = grades.reduce((sum, entry) => sum + entry.count, 0);
  const kept = grades.reduce((sum, entry) => sum + (entry.kept ? entry.count : 0), 0);
  const ungraded = report?.ungraded ?? 0;
  const waiting = request !== null && request.error === null;
  const regrading = report?.grading ?? null;
  const reading = report?.reading ?? null;
  const busy = regrading ? { title: reading?.title ?? null } : reading;
  const sample = trial && trial.subject === subject ? trial.result : undefined;

  function gradeNow() {
    if (!workspaceId) return;
    grade({ workspaceId, libraryId, sourceKey, subject }).catch((error: unknown) => toast.error(t("requestFailed"), { description: errorMessage(error) }));
  }
  function trySample() {
    if (!workspaceId) return;
    setTrying(true);
    trySubject({ workspaceId, libraryId, sourceKey, subject })
      .then((result) => {
        if (!("size" in result)) throw new Error(t("notRunning"));
        setTrial({ subject, result });
      })
      .catch((error: unknown) => toast.error(t("trialFailed"), { description: errorMessage(error) }))
      .finally(() => setTrying(false));
  }

  return (
    <section aria-label={t("label")} className="space-y-3 border-b border-primary/10 bg-primary/[0.05] px-4 pb-4 pt-3.5">
      {/* The field grows with the subject, so a long one is read whole. */}
      <div className="relative">
        <AiIcon size={16} className="pointer-events-none absolute left-3 top-2.5 size-4 text-primary" />
        <Textarea className="min-h-9 resize-none bg-card pl-9" rows={1} aria-label={t("subjectLabel")} value={screening.subject} placeholder={t("subjectPlaceholder")}
          onChange={(event) => onChange({ ...screening, subject: event.target.value })} />
      </div>

      {/* Only when something needs grading: a new subject, or records not graded against the current one. */}
      {!regrading && !waiting && (changed || ungraded > 0) ? (
        <GradeCard records={changed ? graded + ungraded : ungraded} changed={changed} sample={sample} trying={trying}
          onTry={trySample} onGrade={gradeNow} kept={(key) => !screening.keptOut.includes(key)} />
      ) : null}
      {waiting && !request.sent && changed ? <p className="text-xs text-muted-foreground">{t("startsOnActivate")}</p> : null}
      {request?.error ? <p role="alert" className="text-xs text-destructive">{t("refused", { reason: request.error })}</p> : null}

      {/* Before the library screens the source there is nothing to count: its records are graded once it does. */}
      {report === null ? <p className="text-xs text-muted-foreground">{t("gradedOnceActive")}</p> : (
        <div className="space-y-2">
          <div className="flex h-8 items-end justify-between gap-4 text-xs">
            <span className="shrink-0 text-muted-foreground">
              <span className="text-2xl font-semibold leading-none text-foreground"><AnimatedNumber value={kept} /></span> {t("inLibrary")}
            </span>
            {busy ? (
              <span className="flex min-w-0 items-center gap-1.5 text-primary" role="status">
                <AiIcon working size={14} className="size-3.5 shrink-0" />
                <span className="shrink-0 font-medium">{regrading ? t("gradingAgain", { done: regrading.done, of: regrading.of }) : t("reading")}</span>
                {busy.title ? <Shimmer as="span" duration={1.4} className="min-w-0 truncate">{busy.title}</Shimmer> : null}
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                <span aria-hidden className="h-2.5 w-5 rounded-full bg-muted-foreground/50" style={HATCH} />
                <span className="tabular-nums text-foreground"><AnimatedNumber value={graded - kept} /></span> {t("keptOut")}
              </span>
            )}
          </div>
          <GradeBar grades={grades} left={reading?.left} hot={hot} onHot={setHot} />
          {regrading ? (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-primary/10" aria-hidden>
                <div className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${(regrading.done / Math.max(1, regrading.of)) * 100}%`, ...STRIPES }} />
              </div>
              <p className="text-xs text-muted-foreground">{t("gradingNote")}</p>
            </div>
          ) : null}
        </div>
      )}

      <ul className={cn(LIST, "rounded-lg bg-card text-xs")}>
        {grades.map(({ key, count, kept: stays, example }) => {
          const { icon: Icon, fill, ink } = GRADE[key];
          const label = t(`grades.${GRADE[key].report}`);
          return (
            <li key={key} className={cn("grid grid-cols-[1.5rem_minmax(0,1fr)_5ch_8ch_auto] items-center gap-x-3 px-3 py-2 transition-colors", hot === key && "bg-primary/[0.06]")}
              onPointerEnter={() => setHot(key)} onPointerLeave={() => setHot(null)}>
              <span aria-hidden className={cn("grid size-6 place-items-center rounded-md transition-opacity", fill, ink, !stays && "opacity-55")}><Icon className="size-3.5" /></span>
              <span className={cn("flex min-w-0 items-center gap-3 transition-opacity", !stays && "opacity-55")}>
                <span className="shrink-0 font-medium">{label}</span>
                {example ? (
                  <span className="flex min-w-0 items-center gap-1 text-muted-foreground @max-lg/source:hidden">
                    <FileText aria-hidden className="size-3.5 shrink-0 self-center" />
                    <TooltipHint label={example} onlyWhenClipped><span className="min-w-0 truncate">{example}</span></TooltipHint>
                  </span>
                ) : null}
              </span>
              <span className={cn("text-right tabular-nums text-muted-foreground transition-opacity", !stays && "opacity-55")}>{graded ? `${((100 * count) / graded).toFixed(1)}%` : null}</span>
              <span className={cn("text-right font-medium transition-opacity", !stays && "opacity-55")}>{report === null ? null : <AnimatedNumber value={count} />}</span>
              <Switch checked={stays} aria-label={t("keep", { grade: label })}
                onCheckedChange={(checked) => onChange({ ...screening, keptOut: checked ? screening.keptOut.filter((entry) => entry !== key) : [...screening.keptOut, key] })} />
            </li>
          );
        })}
      </ul>

      <p className="text-xs leading-5 text-muted-foreground">{t("methods")}</p>
    </section>
  );
}

/**
 * A source row's Screening switch and the band it opens. Screening needs AI answers on and an OpenRouter key saved,
 * since the library reads on its own key.
 */
export function sourceScreening({ sourceKey, screening = DEFAULT_SCREENING, onChange, report }: {
  sourceKey: string;
  screening?: SourceScreeningSettings;
  onChange: (next: SourceScreeningSettings) => void;
  report: Report | null;
}) {
  return {
    control: <ScreeningSwitch checked={screening.enabled} onCheckedChange={(enabled) => onChange({ ...screening, enabled })} />,
    band: <ScreeningDetails open={screening.enabled}><ScreeningBand sourceKey={sourceKey} screening={screening} onChange={onChange} report={report} /></ScreeningDetails>,
  };
}

function ScreeningSwitch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const t = useTranslations("evidenceLibraryConfiguration.sources.screening");
  const { aiReady } = useScreeningContext();
  return (
    <SourceSwitch label={t("label")} icon={<AiIcon size={14} className="size-3.5 text-primary" />} checked={checked && aiReady}
      onCheckedChange={onCheckedChange} disabledReason={aiReady ? undefined : t("needsAi")} />
  );
}

function ScreeningDetails({ open, children }: { open: boolean; children: ReactNode }) {
  const { aiReady } = useScreeningContext();
  return (
    <Collapsible open={open && aiReady}>
      <DisclosureContent>{children}</DisclosureContent>
    </Collapsible>
  );
}
