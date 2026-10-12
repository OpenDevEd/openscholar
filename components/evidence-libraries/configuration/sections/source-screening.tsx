"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AiIcon, ArrowRight, Check, FileText, FlaskConical, Link2, Quote, RefreshCw, X, type AppIcon } from "@/components/icons";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { AnimatedNumber } from "@/components/screening/parts";
import { LIST } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DisclosureContent } from "../disclosure-button";
import { SourceSwitch } from "./source-row";

/** How close a record is to the source's subject, as Jev graded it: one scale, from the primary colour down to grey. */
const GRADE = {
  about: { label: "About it", icon: Check, fill: "bg-primary", ink: "text-primary-foreground" },
  touches: { label: "Touches on it", icon: Link2, fill: "bg-primary/60", ink: "text-primary-foreground" },
  passing: { label: "Mentions it in passing", icon: Quote, fill: "bg-primary/30", ink: "text-primary" },
  "not-about": { label: "Not about it", icon: X, fill: "bg-muted-foreground/50", ink: "text-background" },
} satisfies Record<string, { label: string; icon: AppIcon; fill: string; ink: string }>;
type GradeKey = keyof typeof GRADE;
const GRADE_KEYS = Object.keys(GRADE) as GradeKey[];
type Grade = { key: GradeKey; count: number; kept: boolean; example: string };

// Kept out of the library: the grade's colour, cut by stripes of the surface behind it.
const HATCH: CSSProperties = { backgroundImage: "repeating-linear-gradient(-45deg, transparent 0 2px, var(--card) 2px 4px)" };
const STRIPES: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(-45deg, var(--primary) 0 3px, color-mix(in oklab, var(--primary) 30%, transparent) 3px 7px)",
};
const PART = "h-full min-w-1 basis-0 rounded-full transition-[flex-grow,opacity] duration-500 ease-out motion-reduce:transition-none";

/** A split bar of grades: kept ones in their colour, kept-out ones hatched, and the part still being read striped. */
function GradeBar({ grades, left = 0, hot, onHot, className }: { grades: { key: GradeKey; count: number; kept: boolean }[]; left?: number; hot?: GradeKey | null; onHot?: (key: GradeKey | null) => void; className?: string }) {
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
type SampleResult = { size: number; now: Record<GradeKey, number>; next: Record<GradeKey, number>; changed: number };

/** A figure and what it counts, for the strip that says what a new subject costs. */
function Figure({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-lg font-semibold leading-tight tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * What saving a new subject does: how many of the source's records are graded again, what it costs and how long it
 * takes, as figures beside the two actions. A trial on 200 records adds how many would change grade, and the sample's
 * grades now and with the new subject.
 */
function SubjectChange({ cost, sample, trying, onTry, onSave, kept }: {
  cost: { records: number; usd: number; time: string };
  sample?: SampleResult;
  trying: boolean;
  onTry: () => void;
  onSave: () => void;
  kept: (key: GradeKey) => boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <RefreshCw aria-hidden className="size-4 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 flex-wrap gap-x-6 gap-y-2">
          <Figure value={cost.records.toLocaleString()} label="records graded again" />
          <Figure value={`$${cost.usd.toFixed(0)}`} label="on the library's key" />
          <Figure value={cost.time} label="to finish" />
          {sample ? <Figure value={`${sample.changed} of ${sample.size}`} label="change grade in a trial" /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sample ? null : (
            <Button type="button" variant="outline" size="sm" onClick={onTry} disabled={trying}>
              {trying ? <AiIcon working size={14} className="size-3.5" /> : <FlaskConical />}
              {trying ? "Reading 200" : "Try on 200"}
            </Button>
          )}
          <Button type="button" size="sm" onClick={onSave}>Grade again</Button>
        </div>
      </div>
      {sample ? (
        <div className="space-y-1.5 border-t border-border-subtle pt-3">
          {(["now", "next"] as const).map((which) => (
            <div key={which} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-xs">
              <span className="text-muted-foreground">{which === "now" ? "Current subject" : "New subject"}</span>
              <GradeBar grades={GRADE_KEYS.map((key) => ({ key, count: sample[which][key], kept: kept(key) }))} />
            </div>
          ))}
          <ul className="flex flex-wrap gap-x-4 gap-y-1 pl-[calc(7rem+0.75rem)] pt-1 text-xs text-muted-foreground">
            {GRADE_KEYS.map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2 rounded-[3px]", GRADE[key].fill)} />
                {GRADE[key].label}
                <span className="tabular-nums text-foreground">{sample.now[key]}</span>
                <ArrowRight aria-hidden className="size-3" />
                <span className="font-medium tabular-nums text-foreground">{sample.next[key]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Current grades stay until every record is graded again, then they all switch together.</p>
    </div>
  );
}

/**
 * A band at the foot of a source row with what AI screening found: the subject it reads the source's records for, the
 * records as one bar split by grade, and a row per grade that keeps it in the library or out. Each record is read once
 * by Jev when it comes in, which also gives it a study type. A new subject is tried on a sample first; saved, it has
 * the source's records graded again, and the new grades take over once the last one is done.
 */
export function SourceScreening({
  subject, savedSubject, subjectPlaceholder, onSubjectChange, onSave, grades, onKeptChange, reading, regrading, cost, sample, onTrySample, trying,
}: {
  subject: string;
  savedSubject: string;
  subjectPlaceholder: string;
  onSubjectChange: (subject: string) => void;
  /** Saves the new subject, which has the source's records graded again. The configuration page's Save does this. */
  onSave: () => void;
  grades: Grade[];
  onKeptChange: (key: GradeKey, kept: boolean) => void;
  /** The first read: the title in hand and how many are left. */
  reading?: { title: string; left: number };
  /** Grading again after a new subject: how many of all are done. */
  regrading?: { done: number; of: number; title: string };
  /** What grading every record again costs. Only the grade is asked again. */
  cost: { records: number; usd: number; time: string };
  sample?: SampleResult;
  onTrySample: () => void;
  trying: boolean;
}) {
  const [hot, setHot] = useState<GradeKey | null>(null);
  const changed = subject.trim() !== savedSubject.trim();
  const total = grades.reduce((sum, grade) => sum + grade.count, 0);
  const kept = grades.reduce((sum, grade) => sum + (grade.kept ? grade.count : 0), 0);
  const busy = regrading ?? reading;
  return (
    <section aria-label="Screening" className="space-y-3 border-b border-primary/10 bg-primary/[0.05] px-4 pb-4 pt-3.5">
      {/* The field grows with the subject, so a long one is read whole. */}
      <div className="relative">
        <AiIcon size={16} className="pointer-events-none absolute left-3 top-2.5 size-4 text-primary" />
        <Textarea className="min-h-9 resize-none bg-card pl-9" rows={1} aria-label="What to screen for" value={subject} placeholder={subjectPlaceholder} onChange={(event) => onSubjectChange(event.target.value)} />
      </div>

      {changed ? <SubjectChange cost={cost} sample={sample} trying={trying} onTry={onTrySample} onSave={onSave} kept={(key) => grades.find((grade) => grade.key === key)!.kept} /> : null}

      <div className="space-y-2">
        <div className="flex h-8 items-end justify-between gap-4 text-xs">
          <span className="shrink-0 text-muted-foreground">
            <span className="text-2xl font-semibold leading-none text-foreground"><AnimatedNumber value={kept} /></span> in the library
          </span>
          {busy ? (
            <span className="flex min-w-0 items-center gap-1.5 text-primary" role="status">
              <AiIcon working size={14} className="size-3.5 shrink-0" />
              <span className="shrink-0 font-medium">{regrading ? `Grading again, ${regrading.done.toLocaleString()} of ${regrading.of.toLocaleString()}` : "Reading"}</span>
              <Shimmer as="span" duration={1.4} className="min-w-0 truncate">{busy.title}</Shimmer>
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
              <span aria-hidden className="h-2.5 w-5 rounded-full bg-muted-foreground/50" style={HATCH} />
              <span className="tabular-nums text-foreground"><AnimatedNumber value={total - kept} /></span> kept out
            </span>
          )}
        </div>
        <GradeBar grades={grades} left={reading?.left} hot={hot} onHot={setHot} />
        {regrading ? (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-primary/10" aria-hidden>
              <div className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${(regrading.done / regrading.of) * 100}%`, ...STRIPES }} />
            </div>
            <p className="text-xs text-muted-foreground">The grades below are the current subject&apos;s until every record has been graded again.</p>
          </div>
        ) : null}
      </div>

      <ul className={cn(LIST, "rounded-lg bg-card text-xs")}>
        {grades.map(({ key, count, kept: stays, example }) => {
          const { label, icon: Icon, fill, ink } = GRADE[key];
          return (
            <li key={key} className={cn("grid grid-cols-[1.5rem_minmax(0,1fr)_5ch_8ch_auto] items-center gap-x-3 px-3 py-2 transition-colors", hot === key && "bg-primary/[0.06]")}
              onPointerEnter={() => setHot(key)} onPointerLeave={() => setHot(null)}>
              <span aria-hidden className={cn("grid size-6 place-items-center rounded-md transition-opacity", fill, ink, !stays && "opacity-55")}><Icon className="size-3.5" /></span>
              <span className={cn("flex min-w-0 items-center gap-3 transition-opacity", !stays && "opacity-55")}>
                <span className="shrink-0 font-medium">{label}</span>
                <span className="flex min-w-0 items-center gap-1 text-muted-foreground @max-lg/source:hidden">
                  <FileText aria-hidden className="size-3.5 shrink-0 self-center" />
                  <TooltipHint label={example} onlyWhenClipped><span className="min-w-0 truncate">{example}</span></TooltipHint>
                </span>
              </span>
              <span className={cn("text-right tabular-nums text-muted-foreground transition-opacity", !stays && "opacity-55")}>{total ? `${((100 * count) / total).toFixed(1)}%` : null}</span>
              <span className={cn("text-right font-medium transition-opacity", !stays && "opacity-55")}><AnimatedNumber value={count} /></span>
              <Switch checked={stays} aria-label={`Keep in the library: ${label}`} onCheckedChange={(checked) => onKeptChange(key, checked)} />
            </li>
          );
        })}
      </ul>

      <p className="text-xs leading-5 text-muted-foreground">
        The same read gives each record its study type, whether its authors pooled results themselves, the region it studies and whether its
        abstract reports numbers. About $0.000075 a record. A record whose read fails enters the library ungraded and is read again later.
      </p>
    </section>
  );
}

// MOCK: grades as shares of a source's records, from Jev's real reading of ECCAR's 2,910 records dated from 1 September 2026.
const MOCK_GRADES: Record<GradeKey, { share: number; example: string }> = {
  about: { share: 1206 / 2910, example: "An analysis of power relations in flood disaster resilience in Rivers State, Nigeria" },
  touches: { share: 1262 / 2910, example: "Spatial Patterns of Water-Induced Soil Erosion and Their Associations with Vegetation Condition, Drought and Topography" },
  passing: { share: 393 / 2910, example: "Building Labor-Market Resilience in Emerging Economies through Coordinated Employment Policy and Social Protection" },
  "not-about": { share: 49 / 2910, example: "A study in the use of fuzzy logic in the management of an automotive heat engine / electric hybrid vehicle powertrain" },
};
const GRADE_SHARES = Object.fromEntries(Object.entries(MOCK_GRADES).map(([key, grade]) => [key, grade.share])) as Record<GradeKey, number>;
const MOCK_SUBJECT = "Research on climate change adaptation and resilience: how farms, cities, coasts, health systems and communities adapt to floods, drought, heat and other climate hazards.";
const MOCK_NEW_SUBJECT = "Research on how communities in low-income countries adapt to climate change, especially farming, water and health.";
const MOCK_READING = [
  "Toward Climate-Resilient Agribusiness and Food Security in Kenya's Highland Counties: Evidence from Kisii and Nyamira Counties",
  "From fragmentation to coordination? Governing urban heat risks in Greater Sydney",
  "Participatory assessment of agricultural value chain dynamics and market opportunities for smallholder farmers",
  "How climate risk drives low-carbon transition of urban energy structures",
];
const MOCK_SAMPLE: SampleResult = {
  size: 200, changed: 31,
  now: { about: 83, touches: 87, passing: 27, "not-about": 3 },
  next: { about: 71, touches: 82, passing: 38, "not-about": 9 },
};

/**
 * MOCK: a source row's Screening switch and band, with the mock's state, for any kind of source.
 * ?mock=screening | screening-reading | screening-subject | screening-rereading | screening-off | screening-noai
 */
export function useMockSourceScreening(records: number) {
  const mock = useSearchParams().get("mock");
  const [on, setOn] = useState(mock !== "screening-off" && mock !== "screening-noai");
  const [saved, setSaved] = useState(MOCK_SUBJECT);
  const [subject, setSubject] = useState(mock === "screening-subject" || mock === "screening-rereading" ? MOCK_NEW_SUBJECT : MOCK_SUBJECT);
  const [shares, setShares] = useState(GRADE_SHARES);
  const [keptOut, setKeptOut] = useState<GradeKey[]>(["not-about"]);
  const [read, setRead] = useState(mock === "screening-reading" ? 0.38 : 1);
  // How far grading again has got after a new subject was saved; null when nothing is being graded again.
  const [again, setAgain] = useState<number | null>(mock === "screening-rereading" ? 0.27 : null);
  const [sample, setSample] = useState<SampleResult | undefined>(undefined);
  const [trying, setTrying] = useState(false);
  // MOCK: timers stand in for the library reporting how far a read has got, and for the trial's read.
  useEffect(() => {
    if (mock !== "screening-reading") return;
    const timer = setInterval(() => setRead((share) => (share >= 1 ? 0.38 : Math.min(1, share + 0.004))), 900);
    return () => clearInterval(timer);
  }, [mock]);
  const regrading = again !== null;
  useEffect(() => {
    if (!regrading) return;
    const timer = setInterval(() => setAgain((share) => (share === null ? null : Math.min(1, share + 0.02))), 300);
    return () => clearInterval(timer);
  }, [regrading]);
  // MOCK: once the last record is graded again, the new grades take over together.
  if (again !== null && again >= 1) {
    setAgain(null);
    setSaved(subject);
    setShares(Object.fromEntries(GRADE_KEYS.map((key) => [key, MOCK_SAMPLE.next[key] / MOCK_SAMPLE.size])) as Record<GradeKey, number>);
  }
  useEffect(() => {
    if (!trying) return;
    const timer = setTimeout(() => { setSample(MOCK_SAMPLE); setTrying(false); }, 2400);
    return () => clearTimeout(timer);
  }, [trying]);
  if (!mock?.startsWith("screening")) return { control: null, band: null };
  const grades: Grade[] = GRADE_KEYS.map((key) => ({ key, count: Math.round(records * shares[key] * read), kept: !keptOut.includes(key), example: MOCK_GRADES[key].example }));
  const left = Math.round(records * (1 - read));
  const tick = Math.round((again ?? read) * 250) % MOCK_READING.length;
  const noAi = mock === "screening-noai";
  return {
    control: (
      <SourceSwitch
        label="Screening"
        icon={<AiIcon size={14} className="size-3.5 text-primary" />}
        checked={on && !noAi}
        onCheckedChange={setOn}
        disabledReason={noAi ? "Turn on AI answers and save an OpenRouter key first" : undefined}
      />
    ),
    band: (
      <Collapsible open={on && !noAi}>
        <DisclosureContent>
          <SourceScreening
            subject={subject}
            savedSubject={regrading ? subject : saved}
            subjectPlaceholder="What this source's records should be about"
            onSubjectChange={(next) => { setSubject(next); setSample(undefined); }}
            onSave={() => { setSample(undefined); setAgain(0); }}
            grades={grades}
            onKeptChange={(key, kept) => setKeptOut((out) => (kept ? out.filter((entry) => entry !== key) : [...out, key]))}
            reading={left ? { title: MOCK_READING[tick]!, left } : undefined}
            regrading={again !== null ? { done: Math.round(records * again), of: records, title: MOCK_READING[tick]! } : undefined}
            // Measured on ECCAR: a full read is $0.0000746 a record; asking only the grade costs 42% of that.
            cost={{ records, usd: records * 0.0000746 * 0.42, time: "about 1 h" }}
            sample={sample}
            onTrySample={() => setTrying(true)}
            trying={trying}
          />
        </DisclosureContent>
      </Collapsible>
    ),
  };
}
