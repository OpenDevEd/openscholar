"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { Ban, Check, ChevronDown, Coins, Folder, FolderMinus, FolderPlus, Hourglass, ListChecks, Loader2, Plus, Sparkles, Trash2, Zap, type LucideIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { ModelPicker } from "@/components/models/model-picker";
import { getModelIcon } from "@/components/icons/provider-icons";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { cn } from "@/lib/utils";
import { BALANCE, CREDITS_PER_PAPER, GENERATED, QUESTIONS, SLOTS, SOURCES, maxScore, type Job, type Question, type Source } from "./data";
import { Meter } from "./parts";
import { SOURCE_ICON } from "./job-view";

const KINDS: Array<{ id: Source["kind"]; label: string }> = [
  { id: "search", label: "Search" },
  { id: "collection", label: "Collection" },
  { id: "saved", label: "Saved papers" },
  { id: "screening", label: "Screening" },
];
/** Most papers one job screens; a bigger set runs as several jobs under one approval. */
const JOB_LIMIT = 1_000;
const PAGE = 25;

export type Setup = { source: Source; first: number; last: number; questions: Question[]; minScore: number; model: string; saveTo?: string; prune?: string };

export function SetupView({ busy, screenings, onStart }: { busy: boolean; screenings: Job[]; onStart: (setup: Setup) => void }) {
  const [kind, setKind] = useState<Source["kind"]>("search");
  const [sourceId, setSourceId] = useState(SOURCES.search[0]!.id);
  const source = SOURCES[kind].find((s) => s.id === sourceId) ?? SOURCES[kind][0]!;
  const [scope, setScope] = useState<"all" | "page" | "range">("range");
  const [range, setRange] = useState<[number, number]>([1, 300]);
  const [questions, setQuestions] = useState<Question[]>(QUESTIONS.slice(0, 2));
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [minScore, setMinScore] = useState(2);
  const [dest, setDest] = useState<"none" | "new" | string>("new");
  const [newName, setNewName] = useState<string | null>(null);
  const [prune, setPrune] = useState(false);
  const [modelId, setModelId] = useState("typesafe/jev-1.13");

  const top = Math.min(source.count, JOB_LIMIT);
  const [first, last] =
    scope === "all" ? [1, source.count] : scope === "page" ? [1, Math.min(PAGE, source.count)] : [Math.min(range[0], top), Math.min(range[1], top)];
  const papers = last - first + 1;
  const jobs = Math.ceil(papers / JOB_LIMIT);
  const credits = Math.ceil(papers * CREDITS_PER_PAPER);
  const enough = credits <= BALANCE;
  const max = maxScore(questions);
  const from = kind === "screening" ? screenings.find((j) => j.id === source.id) : undefined;
  const imported = !!from && from.questions.every((q) => questions.some((x) => x.text.toLowerCase() === q.text.toLowerCase()));
  const defaultName = source.kind === "screening" ? source.label : `Included in ${source.label}`;
  // A collection can't be its own destination; picking it as the source moves the pick to a new one.
  const target = kind === "collection" && dest === source.id ? "new" : dest;
  const saveTo = target === "none" ? undefined : target === "new" ? (newName ?? defaultName).trim() || defaultName : SOURCES.collection.find((c) => c.id === target)?.label;

  const catalog = useQuery(api.models.queries.listCatalogOptions, {});
  const model = catalog?.find((row) => row.modelId === modelId);
  const Brand = getModelIcon(modelId);

  const pick = (k: Source["kind"]) => {
    setKind(k);
    setSourceId(SOURCES[k][0]!.id);
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
          {SOURCES[kind].map((s) => {
            const on = s.id === source.id;
            const Icon = SOURCE_ICON[s.kind];
            return (
              <button key={s.id} type="button" role="radio" aria-checked={on} onClick={() => setSourceId(s.id)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors", on ? "bg-primary/5" : "hover:bg-muted/40")}>
                <Icon className={cn("size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{s.count.toLocaleString()} papers</span>
                <Check className={cn("size-4 shrink-0 text-primary", !on && "invisible")} />
              </button>
            );
          })}
        </div>
        {kind === "search" ? (
          <div className="mt-3 space-y-4 rounded-2xl border border-border/60 p-4">
            <Segmented
              label="Which of its papers"
              value={scope}
              onChange={setScope}
              options={[
                { id: "range", label: "A range" },
                { id: "page", label: "This page" },
                { id: "all", label: "All results" },
              ]}
            />
            {scope === "range" ? (
              <div className="space-y-3">
                <Slider min={1} max={top} step={1} value={range} onValueChange={(v) => setRange([v[0]!, v[1]!])} aria-label="Papers to screen" />
                <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                  <span>Papers {first.toLocaleString()} to {last.toLocaleString()}</span>
                  <span>Results page order, up to {JOB_LIMIT.toLocaleString()} a job</span>
                </div>
              </div>
            ) : scope === "all" ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Zap className="size-3.5 text-primary" />
                {source.count.toLocaleString()} papers run as {jobs.toLocaleString()} jobs of up to {JOB_LIMIT.toLocaleString()}, one after another, under this approval.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">The {PAGE} papers the results page shows first.</p>
            )}
          </div>
        ) : null}
      </Zone>

      <Zone
        label="Questions"
        aside={
          // What the papers come from decides the shortcut: a search has a research question
          // to write questions from; an earlier screening has questions to reuse.
          kind === "search" ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={generate} disabled={generating}>
              {generating ? <Loader2 className="animate-spin text-primary" /> : <Sparkles className="text-primary" />}Generate from the search's research question
            </Button>
          ) : from ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => adopt(from.questions)} disabled={imported}>
              <ListChecks className="text-primary" />
              {imported ? `Imported from ${from.name}` : `Import the ${from.questions.length} questions from ${from.name}`}
            </Button>
          ) : null
        }
      >
        <div className={LIST}>
          <div className="grid grid-cols-[1.5rem_1fr_repeat(3,3.25rem)_2rem] items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
            <span />
            <span>Question</span>
            <span className="text-center">Yes</span>
            <span className="text-center">No</span>
            <span className="text-center">Unclear</span>
            <span />
          </div>
          {questions.map((q, i) => (
            <div key={q.key} className="grid grid-cols-[1.5rem_1fr_repeat(3,3.25rem)_2rem] items-center gap-3 px-4 py-2.5">
              <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums">{i + 1}</span>
              <p className="min-w-0 text-sm">{q.text}</p>
              {(["yes", "no", "unclear"] as const).map((a) => (
                <Input key={a} type="number" value={q[a]} onChange={(e) => points(q.key, a, Number(e.target.value))} aria-label={`Points for ${a}, question ${i + 1}`} className="h-8 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
              ))}
              <TooltipHint label="Remove question">
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Remove question" onClick={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}><Trash2 /></Button>
              </TooltipHint>
            </div>
          ))}
          <div className="flex items-center gap-2 px-4 py-2.5">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addQuestion()} placeholder="Add a question with a yes or no answer" className="h-9 flex-1" />
            <Button variant="outline" size="sm" className="h-9" onClick={addQuestion} disabled={!draft.trim()}><Plus />Add</Button>
          </div>
        </div>
      </Zone>

      <div className="grid gap-8 md:grid-cols-2">
        <Zone label="Keep">
          <div className="space-y-4 rounded-2xl border border-border/60 p-4">
            <div className="flex items-center gap-3">
              <span className="flex-1 text-sm">Included at</span>
              <Input type="number" min={0} max={max} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} aria-label="Points to be included" className="h-8 w-16 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
              <span className="whitespace-nowrap text-sm text-muted-foreground">of {max} points</span>
            </div>
            <Meter value={minScore} max={max} />
          </div>
        </Zone>

        <Zone label="Model">
          <div className="space-y-3 rounded-2xl border border-border/60 p-4">
            <ModelPicker
              align="start"
              tasks={["screenAll"]}
              current={model && { id: model.modelId, reasoningEfforts: model.reasoningEfforts, defaultEffort: model.defaultEffort }}
              onChange={(m) => setModelId(m.id)}
              trigger={
                <Button variant="outline" className="h-11 w-full justify-start gap-3 rounded-xl px-3">
                  <Brand className="size-4" />
                  <span className="flex-1 truncate text-left font-medium">{model ? stripProviderPrefix(model.name) : "Jev 1.13"}</span>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </Button>
              }
            />
            <p className="text-xs text-muted-foreground">Your Screen all pick in AI settings. Jev answers each paper in one call.</p>
          </div>
        </Zone>
      </div>

      <Zone label="Collections">
        {kind === "collection" ? (
          <label className="mb-3 flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-border/60 px-4 py-2.5">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60", prune ? "text-primary" : "text-muted-foreground")}>
              <FolderMinus className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">Remove papers that aren't included from {source.label}</span>
              <span className="block text-xs text-muted-foreground">Excluded and failed papers leave it. Unclear ones stay for you to check.</span>
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
            <span className="flex items-center gap-1.5 font-medium"><Coins className="size-3.5 text-primary" />Up to {credits.toLocaleString()} credits</span>
            <span className={cn("tabular-nums", enough ? "text-muted-foreground" : "text-destructive")}>
              {BALANCE.toLocaleString()} → {Math.max(0, BALANCE - credits).toLocaleString()} left
            </span>
          </p>
          <Meter value={Math.min(credits, BALANCE)} max={BALANCE} fill={enough ? "bg-primary" : "bg-destructive"} />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Hourglass className="size-3.5" />Runs {SLOTS} at a time once your running screening frees slots
        </p>
        <Button disabled={busy || questions.length === 0 || !enough} onClick={() => onStart({ source, first, last, questions, minScore, model: modelId, saveTo, prune: kind === "collection" && prune ? source.label : undefined })}>
          {busy ? "Reading papers…" : `Screen ${papers.toLocaleString()} papers`}
        </Button>
      </div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="flex h-5 shrink-0 items-center whitespace-nowrap rounded-md bg-foreground/[0.06] px-1.5 text-[11px] tabular-nums text-muted-foreground">{children}</span>;
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
      <Check className={cn("size-4 shrink-0 text-primary", !on && "invisible")} />
    </div>
  );
}
