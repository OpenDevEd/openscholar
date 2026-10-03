"use client";

import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, Check, CircleCheck, CircleHelp, Coins, Folder, FolderMinus, FolderPlus, Gauge, Hourglass, ListChecks, Loader2, Minus, Plus, Sparkles, Star, Trash2, TriangleAlert, X, Zap, type LucideIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { ModelPicker } from "@/components/models/model-picker";
import { EASE, NodeCard } from "@/components/settings/model-map";
import { FilterChips } from "@/components/ui/filter-display";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { cn } from "@/lib/utils";
import { BALANCE, CREDITS_PER_PAPER, GENERATED, SLOTS, SOURCES, defaultStars, maxScore, type Job, type Question, type Source } from "./data";
import { ANSWER, AnimatedNumber, Chip, Meter } from "./parts";
import { SOURCE_ICON } from "./job-view";

/** Points boxes take their answer's colour, so a row reads at a glance. */
const TINT = {
  yes: { icon: "text-emerald-500", input: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  no: { icon: "text-muted-foreground", input: "bg-foreground/[0.05]" },
  unclear: { icon: "text-amber-500", input: "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
} as const;

/** A track with nothing on it yet, the height of the slider that takes its place. */
function EmptyTrack() {
  return <div aria-hidden className="h-2 w-full rounded-full border border-dashed border-foreground/20" />;
}

const KINDS: Array<{ id: Source["kind"]; label: string }> = [
  { id: "search", label: "Search" },
  { id: "collection", label: "Collection" },
  { id: "saved", label: "Saved papers" },
  { id: "screening", label: "Screening" },
];
/** Most papers one job screens; a bigger set runs as several jobs under one approval. */
const JOB_LIMIT = 1_000;
/** Papers on one results page (ITEMS_PER_PAGE). */
const PAGE = 20;

type SearchSource = Extract<Source, { kind: "search" }>;

export type Setup = { source: Source; first: number; last: number; questions: Question[]; minScore: number; stars: number[]; model: string; saveTo?: string; prune?: string };

export function SetupView({
  busy,
  screenings,
  waitingFor,
  fromResults,
  onStart,
}: {
  busy: boolean;
  screenings: Job[];
  waitingFor?: string;
  /** The search whose Screen all opened this form, read from its history entry. */
  fromResults?: SearchSource;
  onStart: (setup: Setup) => void;
}) {
  const mockSearches = SOURCES.search.filter((s): s is SearchSource => s.kind === "search");
  const searches = fromResults ? [fromResults, ...mockSearches.filter((s) => s.id !== fromResults.id)] : mockSearches;
  const sources = { ...SOURCES, search: searches };
  const [kind, setKind] = useState<Source["kind"]>("search");
  const [sourceId, setSourceId] = useState(sources.search[0]!.id);
  const source = sources[kind].find((s) => s.id === sourceId) ?? sources[kind][0]!;
  // Opened from a results page, it starts on the page the person was reading.
  const [scope, setScope] = useState<"all" | "page" | "range">(fromResults ? "page" : "range");
  const [range, setRange] = useState<[number, number]>([1, 300]);
  const [questions, setQuestions] = useState<Question[]>(searches[0]!.questions);
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [minScore, setMinScore] = useState(2);
  // The scores where 1 to 5 stars begin; untouched, they spread across the highest score.
  const [starsSet, setStars] = useState<number[] | null>(null);
  const [dest, setDest] = useState<"none" | "new" | string>("new");
  const [newName, setNewName] = useState<string | null>(null);
  const [prune, setPrune] = useState(false);
  const [modelId, setModelId] = useState("typesafe/jev-1.13");

  // A range can reach the last result: past a job's limit it runs as several jobs, as All results does.
  const top = source.count;
  const [first, last] =
    scope === "all"
      ? [1, source.count]
      : scope === "page" && source.kind === "search"
        ? [(source.page - 1) * PAGE + 1, Math.min(source.page * PAGE, source.count)]
        : [Math.min(range[0], top), Math.min(range[1], top)];
  const papers = last - first + 1;
  const jobs = Math.ceil(papers / JOB_LIMIT);
  // One screening per search: papers its results page already answered, with these same
  // questions, keep their answers and aren't charged again. New questions start a new version.
  const sameQuestions =
    source.kind === "search" && source.questions.length === questions.length && source.questions.every((q, i) => q.text === questions[i]?.text);
  const skipped = sameQuestions && source.kind === "search" ? Math.max(0, Math.min(last, source.screened) - first + 1) : 0;
  const credits = Math.ceil((papers - skipped) * CREDITS_PER_PAPER);
  const enough = credits <= BALANCE;
  const max = maxScore(questions);
  // With no question there's nothing to score: Keep and Stars wait, at the size they'll have.
  const unscored = questions.length === 0;
  const questionInput = useRef<HTMLInputElement>(null);
  // Removing questions can drop the highest score under the threshold; it reads as the top score then.
  const threshold = Math.min(minScore, max);
  const stars = (starsSet ?? defaultStars(max)).map((t) => Math.min(t, max));
  /** Sets where `index + 1` stars begin, pushing the other thresholds so they stay in order. */
  const setStar = (index: number, value: number) => {
    const v = Math.min(max, Math.max(0, Math.round(value) || 0));
    setStars(stars.map((t, i) => (i === index ? v : i > index ? Math.max(t, v) : Math.min(t, v))));
  };
  // An earlier screening's questions to reuse. A search needs none: its questions load with it.
  const from = source.kind === "screening" ? screenings.find((j) => j.id === source.id) : undefined;
  const fresh = from?.questions.filter((q) => !questions.some((x) => x.text.toLowerCase() === q.text.toLowerCase())) ?? [];
  const defaultName = source.kind === "screening" ? source.label : `Included in ${source.label}`;
  // A collection can't be its own destination; picking it as the source moves the pick to a new one.
  const target = kind === "collection" && dest === source.id ? "new" : dest;
  const saveTo = target === "none" ? undefined : target === "new" ? (newName ?? defaultName).trim() || defaultName : SOURCES.collection.find((c) => c.id === target)?.label;

  const catalog = useQuery(api.models.queries.listCatalogOptions, {});
  const model = catalog?.find((row) => row.modelId === modelId);

  /** Picks a source; a search brings its own screening questions, and each source starts on its own first papers. */
  const choose = (next: Source) => {
    setSourceId(next.id);
    setRange([1, Math.min(300, next.count)]);
    if (next.kind === "search") setQuestions(next.questions);
  };
  const pick = (k: Source["kind"]) => {
    setKind(k);
    choose(sources[k][0]!);
    setScope(k === "search" ? "range" : "all");
  };
  const addQuestion = () => {
    const text = draft.trim();
    if (!text) return;
    setQuestions((qs) => [...qs, { key: `q${Date.now()}`, text, yes: 1, no: 0, unclear: 0 }]);
    setDraft("");
  };
  /** Adds questions not already asked, keeping their points. */
  const adopt = (incoming: Question[]) =>
    setQuestions((qs) => {
      const asked = new Set(qs.map((q) => q.text.toLowerCase()));
      return [...qs, ...incoming.filter((q) => !asked.has(q.text.toLowerCase())).map((q, i) => ({ ...q, key: `q${Date.now()}-${i}` }))];
    });
  const generate = () => {
    setGenerating(true);
    // Scripted: the real button calls the screening-question generator with the search's research question.
    window.setTimeout(() => {
      adopt(GENERATED);
      setGenerating(false);
    }, 1_500);
  };
  const points = (key: string, answer: "yes" | "no" | "unclear", value: number) =>
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, [answer]: value } : q)));

  return (
    <div className="space-y-8 pb-24">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">New screening</h2>
        <p className="text-sm text-muted-foreground">The model answers your questions for every paper, and the scoring rules decide which are in.</p>
      </div>

      <Zone label="Papers">
        <Segmented label="Where the papers come from" value={kind} onChange={pick} fill options={KINDS.map((k) => ({ ...k, icon: SOURCE_ICON[k.id] }))} />
        <div className={cn(LIST, "mt-3")} role="radiogroup" aria-label="Papers to screen">
          {sources[kind].map((s) => {
            const on = s.id === source.id;
            const Icon = SOURCE_ICON[s.kind];
            return (
              <div key={s.id} className={cn("transition-colors", on && "bg-primary/5")}>
                <button type="button" role="radio" aria-checked={on} onClick={() => choose(s)} className={cn("flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors", !on && "hover:bg-muted/40")}>
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60", on ? "text-primary" : "text-muted-foreground")}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <span className="block truncate text-sm font-medium">{s.label}</span>
                    {/* As on a search's history card: one row that scrolls sideways under a fading edge. */}
                    {s.kind === "search" ? <span className="block min-w-0 overflow-x-auto scrollbar-hover mask-r-from-[calc(100%-2rem)]"><FilterChips filters={s.filters} size="compact" singleLine /></span> : null}
                  </span>
                  <Chip>{s.count.toLocaleString()} papers</Chip>
                  <PickMark on={on} />
                </button>
                <AnimatePresence initial={false}>
                {/* Every source is picked from the same way: a range of its papers, or all of them; a search also has the page being read. */}
                {on ? (
                  <motion.div
                    key="scope"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className="overflow-hidden"
                  >
                  <div className="space-y-4 pb-4 pl-15 pr-4">
                    <Segmented
                      label="Which of its papers"
                      value={scope}
                      onChange={setScope}
                      options={[
                        { id: "range" as const, label: "A range" },
                        ...(s.kind === "search" ? [{ id: "page" as const, label: "This page" }] : []),
                        { id: "all" as const, label: s.kind === "search" ? "All results" : "All papers" },
                      ]}
                    />
                    {scope === "range" ? (
                      <div className="space-y-3">
                        <Slider min={1} max={top} step={1} value={[first, last]} onValueChange={(v) => setRange([v[0]!, v[1]!])} aria-label="Papers to screen" />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          {/* Typeable ends: over thousands of results a drag can't land on one paper. */}
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            Papers
                            <Input
                              type="number"
                              min={1}
                              max={last}
                              value={first}
                              onChange={(e) => setRange([Math.min(last, Math.max(1, Math.round(Number(e.target.value)) || 1)), last])}
                              onFocus={(e) => e.target.select()}
                              aria-label="First paper"
                              className="h-7 w-20 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            to
                            <Input
                              type="number"
                              min={first}
                              max={top}
                              value={last}
                              onChange={(e) => setRange([first, Math.min(top, Math.max(first, Math.round(Number(e.target.value)) || first))])}
                              onFocus={(e) => e.target.select()}
                              aria-label="Last paper"
                              className="h-7 w-20 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            of {top.toLocaleString()}
                          </span>
                          {jobs > 1 ? (
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Chip icon={Zap} className="text-foreground"><span><span className="font-semibold">{jobs.toLocaleString()}</span> jobs, one after another</span></Chip>
                              <Chip icon={Check}>One approval</Chip>
                            </span>
                          ) : (
                            <Chip>Up to {JOB_LIMIT.toLocaleString()} papers a job</Chip>
                          )}
                        </div>
                      </div>
                    ) : scope === "all" && jobs > 1 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip icon={Zap} className="text-foreground"><span><span className="font-semibold">{jobs.toLocaleString()}</span> jobs, one after another</span></Chip>
                        <Chip>Up to {JOB_LIMIT.toLocaleString()} papers each</Chip>
                        <Chip icon={Check}>One approval</Chip>
                      </div>
                    ) : scope === "all" ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip className="text-foreground"><span><span className="font-semibold">{papers.toLocaleString()}</span> papers</span></Chip>
                        <Chip>One job</Chip>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip className="text-foreground"><span><span className="font-semibold">{papers}</span> papers</span></Chip>
                        <Chip>Results page {s.kind === "search" ? s.page : 1}</Chip>
                      </div>
                    )}
                    {skipped ? (
                      <Chip icon={Check} className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                        <span><span className="font-semibold">{skipped}</span> already screened on the results page, kept and not charged</span>
                      </Chip>
                    ) : null}
                  </div>
                  </motion.div>
                ) : null}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </Zone>

      <Zone
        label="Questions"
        aside={
          // What the papers come from decides the shortcuts: a search's questions are its own (one
          // screening per search) and it can write more from its research question; an earlier
          // screening has questions to reuse.
          <span className="flex items-center gap-1">
            {source.kind === "search" ? <Chip icon={ListChecks}>Shared with this search's results page</Chip> : null}
            {from ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => adopt(fresh)} disabled={!fresh.length}>
                <ListChecks className="text-primary" />
                {fresh.length ? `Import ${fresh.length} ${fresh.length === 1 ? "question" : "questions"} from ${from.name}` : `Imported from ${from.name}`}
              </Button>
            ) : null}
            {kind === "search" ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={generate} disabled={generating}>
                {generating ? <Loader2 className="animate-spin text-primary" /> : <Sparkles className="text-primary" />}Generate from its research question
              </Button>
            ) : null}
          </span>
        }
      >
        <div className={LIST}>
          <div className="grid grid-cols-[1.5rem_1fr_repeat(3,4rem)_2rem] items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
            <span />
            <span>Question</span>
            {(["yes", "no", "unclear"] as const).map((a) => {
              const { icon: Icon, label } = ANSWER[a];
              return <span key={a} className="flex items-center justify-center gap-1"><Icon className={cn("size-3", TINT[a].icon)} />{label}</span>;
            })}
            <span />
          </div>
          <AnimatePresence initial={false}>
          {questions.map((q, i) => (
            <motion.div
              key={q.key}
              layout="position"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto", transition: { duration: 0.35, ease: EASE, delay: i * 0.04 } }}
              exit={{ opacity: 0, height: 0, transition: { duration: 0.25, ease: EASE } }}
              className="overflow-hidden"
            >
            <div className="grid grid-cols-[1.5rem_1fr_repeat(3,4rem)_2rem] items-center gap-3 px-4 py-2.5">
              <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums">{i + 1}</span>
              <p className="min-w-0 text-sm">{q.text}</p>
              {(["yes", "no", "unclear"] as const).map((a) => (
                <Input key={a} type="number" value={q[a]} onChange={(e) => points(q.key, a, Number(e.target.value))} aria-label={`Points for ${a}, question ${i + 1}`} className={cn("h-8 border-transparent px-1 text-center text-sm font-medium tabular-nums shadow-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none", TINT[a].input)} />
              ))}
              <TooltipHint label="Remove question">
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Remove question" onClick={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}><Trash2 /></Button>
              </TooltipHint>
            </div>
            </motion.div>
          ))}
          </AnimatePresence>
          <div className="flex items-center gap-2 px-4 py-2.5">
            <Input ref={questionInput} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addQuestion()} placeholder="Add a question with a yes or no answer" className="h-9 flex-1" />
            <Button variant="outline" size="sm" className="h-9" onClick={addQuestion} disabled={!draft.trim()}><Plus />Add</Button>
          </div>
        </div>
      </Zone>

      <Zone label="Keep">
        <div className={cn("space-y-3 rounded-2xl border p-4 transition-colors duration-300", unscored ? "border-dashed border-border" : "border-border/60 bg-muted/40")}>
          <div className="flex items-center gap-3">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-300", unscored ? "bg-muted text-muted-foreground/60" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")}>
              <CircleCheck className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm font-semibold", unscored && "text-muted-foreground")}>{unscored ? "Nothing to score yet" : "Included from"}</span>
              <span className="block text-xs text-muted-foreground">{unscored ? "A question's points decide which papers are kept" : "Points add up across the questions"}</span>
            </span>
            {unscored ? (
              <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => questionInput.current?.focus()}><Plus />Add a question</Button>
            ) : (
            <span className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon" className="size-8" aria-label="One point fewer" disabled={threshold <= 0} onClick={() => setMinScore(threshold - 1)}><Minus /></Button>
              <Input
                type="number"
                min={0}
                max={max}
                value={threshold}
                onChange={(e) => setMinScore(Math.min(max, Math.max(0, Math.round(Number(e.target.value)) || 0)))}
                onFocus={(e) => e.target.select()}
                aria-label="Points to be included"
                className="h-8 w-12 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              <Button variant="ghost" size="icon" className="size-8" aria-label="One point more" disabled={threshold >= max} onClick={() => setMinScore(threshold + 1)}><Plus /></Button>
              <span className="w-16 whitespace-nowrap text-sm tabular-nums text-muted-foreground">of {max} points</span>
            </span>
            )}
          </div>
          {/* One track from 0 to the highest score, however many questions there are: grey
              below the threshold, green from it. */}
          <div className="space-y-2 pt-1">
            {unscored ? <EmptyTrack /> : (
            <Slider
              min={0}
              max={Math.max(1, max)}
              step={1}
              value={[threshold]}
              onValueChange={(v) => setMinScore(v[0]!)}
              aria-label="Lowest score that's included"
              className="[&_[data-slot=slider-range]]:bg-muted [&_[data-slot=slider-thumb]]:border-emerald-500 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-emerald-500/70"
            />
            )}
          </div>
        </div>
      </Zone>

      <Zone label="Stars">
        <div className={cn("space-y-4 rounded-2xl border p-4 transition-colors duration-300", unscored ? "border-dashed border-border" : "border-border/60 bg-muted/40")}>
          <div className="flex items-center gap-3">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-300", unscored ? "bg-muted text-muted-foreground/60" : "bg-primary/15 text-primary")}>
              <Star className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm font-semibold", unscored && "text-muted-foreground")}>{unscored ? "No ratings yet" : "Rating"}</span>
              <span className="block text-xs text-muted-foreground">{unscored ? "Stars come from the same points" : "The stars a saved paper gets for its score"}</span>
            </span>
            {unscored ? null : <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">of {max} points</span>}
          </div>
          {/* Five handles on one track, one where each rating begins: always five, at any number of points. */}
          {unscored ? <EmptyTrack /> : (
          <Slider
            min={0}
            max={Math.max(1, max)}
            step={1}
            minStepsBetweenThumbs={0}
            value={stars}
            onValueChange={(v) => setStars(v)}
            aria-label="Scores where each star rating begins"
            className="[&_[data-slot=slider-range]]:bg-primary/60 [&_[data-slot=slider-track]]:h-2"
          />
          )}
          <div className="grid grid-cols-5 gap-2">
            {stars.map((t, i) => (
              <label key={i} className={cn("flex items-center gap-2 rounded-xl py-1.5 pl-2.5 pr-1.5 transition-colors duration-300", unscored ? "bg-foreground/[0.02]" : "bg-foreground/[0.04]")}>
                <span className="flex flex-1 items-center gap-0.5" aria-hidden>
                  {Array.from({ length: i + 1 }, (_, j) => (
                    <Star key={j} className={cn("size-2.5 transition-colors duration-300", unscored ? "text-muted-foreground/40" : "fill-primary text-primary")} />
                  ))}
                </span>
                <Input
                  type="number"
                  min={0}
                  max={max}
                  disabled={unscored}
                  value={unscored ? "" : t}
                  onChange={(e) => setStar(i, Number(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  aria-label={`Points for ${i + 1} ${i === 0 ? "star" : "stars"}`}
                  className="h-7 w-12 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
              </label>
            ))}
          </div>
        </div>
      </Zone>

      <Zone label="Model">
        <ModelPicker
          align="start"
          tasks={["screenAll"]}
          current={model && { id: model.modelId, reasoningEfforts: model.reasoningEfforts, defaultEffort: model.defaultEffort }}
          onChange={(m) => setModelId(m.id)}
          trigger={
            <NodeCard
              interactive
              paidBy="credits"
              model={{
                id: modelId,
                name: model?.name ?? "Jev 1.13",
                inputPricePerMillion: model?.inputPricePerMillion ?? 0,
                outputPricePerMillion: model?.outputPricePerMillion ?? 0,
                unpriced: !model,
                reasoningEfforts: model?.reasoningEfforts,
                effort: model?.defaultEffort,
              }}
            />
          }
        />
      </Zone>

      <Zone label="Collections">
        {kind === "collection" ? (
          <label className="mb-3 flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-border/60 px-4 py-2.5">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60", prune ? "text-primary" : "text-muted-foreground")}>
              <FolderMinus className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">Remove papers that aren't included from {source.label}</span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                <Chip icon={X}>Excluded leave</Chip>
                <Chip icon={TriangleAlert}>Failed leave</Chip>
                <Chip icon={CircleHelp}>Unclear stay</Chip>
              </span>
            </span>
            <Switch checked={prune} onCheckedChange={setPrune} aria-label={`Remove papers that aren't included from ${source.label}`} />
          </label>
        ) : null}
        <div className={LIST} role="radiogroup" aria-label="Save included papers to">
          <DestinationRow on={target === "none"} onPick={() => setDest("none")} icon={Ban} name="Don't save included papers" />
          <DestinationRow on={target === "new"} onPick={() => setDest("new")} icon={FolderPlus} facts={<Chip>New</Chip>}>
            <Input
              value={newName ?? defaultName}
              onChange={(e) => setNewName(e.target.value)}
              onFocus={() => setDest("new")}
              aria-label="Name of the new collection"
              placeholder="Name a new collection"
              className="h-8 flex-1"
            />
          </DestinationRow>
          {SOURCES.collection
            .filter((c) => kind !== "collection" || c.id !== source.id)
            .map((c) => (
              <DestinationRow key={c.id} on={target === c.id} onPick={() => setDest(c.id)} icon={Folder} name={`Add to ${c.label}`} facts={<Chip>{c.count.toLocaleString()} papers</Chip>} />
            ))}
        </div>
      </Zone>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-4 rounded-2xl border border-border/60 bg-background p-4 shadow-lg">
        <div className="min-w-48 flex-1 space-y-1.5">
          <p className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium"><Coins className="size-3.5 text-primary" /><span>Up to <AnimatedNumber value={credits} /> credits</span></span>
            <span className={cn("tabular-nums transition-colors", enough ? "text-muted-foreground" : "text-destructive")}>
              {BALANCE.toLocaleString()} → <AnimatedNumber value={Math.max(0, BALANCE - credits)} /> left
            </span>
          </p>
          <Meter value={Math.min(credits, BALANCE)} max={BALANCE} fill={enough ? "bg-primary" : "bg-destructive"} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip icon={Gauge}>{SLOTS} at a time</Chip>
          {waitingFor ? (
            <Chip icon={Hourglass} className="max-w-56">
              <TooltipHint label={`After ${waitingFor}`} onlyWhenClipped>
                <span className="truncate">After {waitingFor}</span>
              </TooltipHint>
            </Chip>
          ) : null}
        </div>
        <Button disabled={busy || questions.length === 0 || !enough} onClick={() => onStart({ source, first, last, questions, minScore: threshold, stars, model: modelId, saveTo, prune: kind === "collection" && prune ? source.label : undefined })}>
          {busy
            ? "Reading papers…"
            : skipped === papers
              ? `Use the ${papers.toLocaleString()} screened papers`
              : skipped
                ? `Screen ${(papers - skipped).toLocaleString()} new papers`
                : `Screen ${papers.toLocaleString()} papers`}
        </Button>
      </div>
    </div>
  );
}

/** One place the included papers can go, as the chat offers them: none, a new collection, or one you have. */
function DestinationRow({ on, onPick, icon: Icon, name, facts, children }: { on: boolean; onPick: () => void; icon: LucideIcon; name?: string; facts?: ReactNode; children?: ReactNode }) {
  return (
    <div role="radio" aria-checked={on} tabIndex={0} onClick={onPick} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && e.target === e.currentTarget && onPick()} className={cn("flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors", on ? "bg-primary/5" : "hover:bg-muted/40")}>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60", on ? "text-primary" : "text-muted-foreground")}>
        <Icon className="size-4" />
      </span>
      {name ? <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span> : <span className="flex min-w-0 flex-1">{children}</span>}
      {facts}
      <PickMark on={on} />
    </div>
  );
}

/** The picked row's check, springing in as the chat's answer checks do. */
function PickMark({ on }: { on: boolean }) {
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
