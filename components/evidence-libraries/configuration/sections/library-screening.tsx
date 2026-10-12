"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { AiIcon, ArrowRight, Check, FileText, FlaskConical, Link2, Quote, X, type AppIcon } from "@/components/icons";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { AnimatedNumber } from "@/components/screening/parts";
import { LIST } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** How close a record is to the library's subject, as Jev graded it: one scale, from the primary colour down to grey. */
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

/** What a new subject would change, read on a sample before anything is saved: the sample's grades now and with it. */
type SampleResult = { size: number; now: Record<GradeKey, number>; next: Record<GradeKey, number>; changed: number };

/**
 * AI screening for the whole library. Every record from every source is read once by Jev when it comes in: graded
 * against the subject the owner writes here, and given a study type and the other answers in the same read. Grades
 * switched off keep their records out of the library, the reversible way duplicates are. A new subject is tried on a
 * sample first; saved, it has every record read again, and the new grades take over once the last one is read.
 */
export function LibraryScreening({
  on, onOnChange, noAi, subject, savedSubject, onSubjectChange, grades, onKeptChange, reading, rereading, cost, sample, onTrySample, trying,
}: {
  on: boolean;
  onOnChange: (on: boolean) => void;
  /** Set when the library has no AI key, so screening cannot run. */
  noAi: boolean;
  subject: string;
  savedSubject: string;
  onSubjectChange: (subject: string) => void;
  grades: Grade[];
  onKeptChange: (key: GradeKey, kept: boolean) => void;
  /** The first read: the title in hand and how many are left. */
  reading?: { title: string; left: number };
  /** A read again after a new subject: how many of all are done. */
  rereading?: { done: number; of: number; title: string };
  /** What a read of every record costs: records, dollars, and how long it takes. */
  cost: { records: number; usd: number; hours: string };
  sample?: SampleResult;
  onTrySample: () => void;
  trying: boolean;
}) {
  const [hot, setHot] = useState<GradeKey | null>(null);
  const changed = subject.trim() !== savedSubject.trim();
  const total = grades.reduce((sum, grade) => sum + grade.count, 0);
  const kept = grades.reduce((sum, grade) => sum + (grade.kept ? grade.count : 0), 0);
  return (
    <section aria-label="AI screening" className="overflow-hidden rounded-lg border border-primary/15 bg-primary/[0.05]">
      <header className="flex items-center gap-3 px-4 pt-3.5">
        <AiIcon working={Boolean(reading || rereading)} size={16} className="size-4 shrink-0 text-primary" />
        <span className="font-medium">AI screening</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">Every record from every source is read when it comes in</span>
        <Switch checked={on && !noAi} disabled={noAi} aria-label="AI screening" onCheckedChange={onOnChange} />
      </header>
      {noAi ? (
        <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">Turn on AI answers in the AI section and save an OpenRouter key first. Screening reads with the library&apos;s own key.</p>
      ) : !on ? (
        <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">Off: records enter the library without a grade or a study type.</p>
      ) : (
        <div className="space-y-3 px-4 pb-4 pt-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">What this library is about</span>
            <Textarea className="bg-card" rows={2} value={subject} onChange={(event) => onSubjectChange(event.target.value)} />
          </label>

          {changed ? (
            <div className="space-y-3 rounded-lg bg-card p-3 text-sm">
              <p>
                Saving reads all <span className="font-medium tabular-nums">{cost.records.toLocaleString()}</span> records again with this subject:
                about <span className="font-medium tabular-nums">${cost.usd.toFixed(0)}</span> on the library&apos;s key and about {cost.hours}.
                Records keep their current grade until the last one is read, then the new grades take over together.
              </p>
              {sample ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground">
                    Tried on {sample.size} records: <span className="font-medium text-foreground">{sample.changed} would change grade</span>.
                  </p>
                  {(["now", "next"] as const).map((which) => (
                    <div key={which} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-xs">
                      <span className="text-muted-foreground">{which === "now" ? "Current subject" : "This subject"}</span>
                      <GradeBar grades={GRADE_KEYS.map((key) => ({ key, count: sample[which][key], kept: grades.find((grade) => grade.key === key)!.kept }))} />
                    </div>
                  ))}
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 pl-[calc(7rem+0.75rem)] text-xs text-muted-foreground">
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
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={onTrySample} disabled={trying}>
                  {trying ? <AiIcon working size={14} className="size-3.5" /> : <FlaskConical />}
                  {trying ? "Reading 200 records" : "Try it on 200 records"}
                </Button>
              )}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex h-8 items-end justify-between gap-4 text-xs">
              <span className="shrink-0 text-muted-foreground">
                <span className="text-2xl font-semibold leading-none text-foreground"><AnimatedNumber value={kept} /></span> in the library
              </span>
              {reading || rereading ? (
                <span className="flex min-w-0 items-center gap-1.5 text-primary" role="status">
                  <AiIcon working size={14} className="size-3.5 shrink-0" />
                  <span className="shrink-0 font-medium">{rereading ? `Reading again, ${rereading.done.toLocaleString()} of ${rereading.of.toLocaleString()}` : "Reading"}</span>
                  <Shimmer as="span" duration={1.4} className="min-w-0 truncate">{(rereading ?? reading)!.title}</Shimmer>
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  <span aria-hidden className="h-2.5 w-5 rounded-full bg-muted-foreground/50" style={HATCH} />
                  <span className="tabular-nums text-foreground"><AnimatedNumber value={total - kept} /></span> kept out
                </span>
              )}
            </div>
            <GradeBar grades={grades} left={reading?.left} hot={hot} onHot={setHot} />
            {rereading ? (
              <div className="space-y-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-primary/10" aria-hidden>
                  <div className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${(rereading.done / rereading.of) * 100}%`, ...STRIPES }} />
                </div>
                <p className="text-xs text-muted-foreground">The grades below are the current subject&apos;s until every record has been read again.</p>
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
                    <span className="flex min-w-0 items-center gap-1 text-muted-foreground @max-lg/sources:hidden">
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
            The same read gives each record its study type, whether its authors pooled results themselves, the region it studies and whether
            its abstract reports numbers. It costs about $0.000075 a record. A record whose read fails enters the library ungraded and is read again later.
          </p>
        </div>
      )}
    </section>
  );
}

// MOCK: ECCAR's grades, scaled from Jev's real reading of its 2,910 records dated from 1 September 2026 to its 157,261 records.
// ?mock=screening | screening-reading | screening-subject | screening-rereading | screening-off | screening-noai
const MOCK_RECORDS = 157_261;
const MOCK_GRADES: Record<GradeKey, { share: number; example: string }> = {
  about: { share: 1206 / 2910, example: "An analysis of power relations in flood disaster resilience in Rivers State, Nigeria" },
  touches: { share: 1262 / 2910, example: "Spatial Patterns of Water-Induced Soil Erosion and Their Associations with Vegetation Condition, Drought and Topography" },
  passing: { share: 393 / 2910, example: "Building Labor-Market Resilience in Emerging Economies through Coordinated Employment Policy and Social Protection" },
  "not-about": { share: 49 / 2910, example: "A study in the use of fuzzy logic in the management of an automotive heat engine / electric hybrid vehicle powertrain" },
};
const MOCK_SUBJECT = "Research on climate change adaptation and resilience: how farms, cities, coasts, health systems and communities adapt to floods, drought, heat and other climate hazards.";
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

/** MOCK: the panel with the mock's state, for the configuration page. */
export function MockLibraryScreening() {
  const mock = useSearchParams().get("mock");
  const [on, setOn] = useState(mock !== "screening-off");
  const [subject, setSubject] = useState(mock === "screening-subject" ? "Research on how communities in low-income countries adapt to climate change, especially farming, water and health." : MOCK_SUBJECT);
  const [keptOut, setKeptOut] = useState<GradeKey[]>(["not-about"]);
  const [read, setRead] = useState(mock === "screening-reading" ? 0.38 : 1);
  const [again, setAgain] = useState(0.27);
  const [sample, setSample] = useState<SampleResult | undefined>(undefined);
  const [trying, setTrying] = useState(false);
  // MOCK: timers stand in for the library reporting how far a read has got, and for the sample's read.
  useEffect(() => {
    if (mock !== "screening-reading" && mock !== "screening-rereading") return;
    const timer = setInterval(() => {
      if (mock === "screening-reading") setRead((share) => (share >= 1 ? 0.38 : Math.min(1, share + 0.004)));
      else setAgain((share) => (share >= 1 ? 0.27 : Math.min(1, share + 0.004)));
    }, 900);
    return () => clearInterval(timer);
  }, [mock]);
  useEffect(() => {
    if (!trying) return;
    const timer = setTimeout(() => { setSample(MOCK_SAMPLE); setTrying(false); }, 2400);
    return () => clearTimeout(timer);
  }, [trying]);
  if (!mock?.startsWith("screening")) return null;
  const grades: Grade[] = GRADE_KEYS.map((key) => ({ key, count: Math.round(MOCK_RECORDS * MOCK_GRADES[key].share * read), kept: !keptOut.includes(key), example: MOCK_GRADES[key].example }));
  const left = Math.round(MOCK_RECORDS * (1 - read));
  const tick = Math.round((mock === "screening-rereading" ? again : read) * 250) % MOCK_READING.length;
  return (
    <LibraryScreening
      on={on}
      onOnChange={setOn}
      noAi={mock === "screening-noai"}
      subject={subject}
      savedSubject={MOCK_SUBJECT}
      onSubjectChange={(next) => { setSubject(next); setSample(undefined); }}
      grades={grades}
      onKeptChange={(key, kept) => setKeptOut((out) => (kept ? out.filter((entry) => entry !== key) : [...out, key]))}
      reading={left ? { title: MOCK_READING[tick]!, left } : undefined}
      rereading={mock === "screening-rereading" ? { done: Math.round(MOCK_RECORDS * again), of: MOCK_RECORDS, title: MOCK_READING[tick]! } : undefined}
      cost={{ records: MOCK_RECORDS, usd: MOCK_RECORDS * 0.0000746, hours: "an hour" }}
      sample={sample}
      onTrySample={() => setTrying(true)}
      trying={trying}
    />
  );
}
