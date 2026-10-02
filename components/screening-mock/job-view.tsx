"use client";

import { useMemo, useState } from "react";
import {
  BookMarked, ChevronDown, Coins, Copy, Download, FolderMinus, FolderOpen, Hourglass, Layers, ListChecks, Search, Square, Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipHint } from "@/components/ui/tooltip";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { cn } from "@/lib/utils";
import {
  CREDITS_PER_PAPER, SLOTS, answerOf, maxScore, outcomeOf, paperById, scoreOf, starsOf,
  type Answer, type Job, type Outcome, type Source,
} from "./data";
import { ANSWER, AnswerMark, Meter, OUTCOME, OutcomeBar, Stars } from "./parts";

export const SOURCE_ICON: Record<Source["kind"], typeof Search> = { search: Search, collection: FolderOpen, saved: BookMarked, screening: ListChecks };
const STATUS: Record<Job["status"], { label: string; tone: "running" | "warning" | "success" | "neutral" }> = {
  running: { label: "Running", tone: "running" },
  waiting: { label: "Waiting", tone: "warning" },
  completed: { label: "Done", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function countsOf(job: Job) {
  const counts: Record<Outcome, number> = { included: 0, unclear: 0, excluded: 0, failed: 0 };
  for (const id of job.paperIds.slice(0, job.done)) counts[outcomeOf(job, id)]++;
  return counts;
}

export function JobView({
  job,
  blocker,
  onCancel,
  onRunAgain,
  onAnswer,
}: {
  job: Job;
  /** The person's screening this one waits for. */
  blocker?: Job;
  onCancel: () => void;
  onRunAgain: () => void;
  onAnswer: (paperId: string, questionKey: string, answer: Answer | null) => void;
}) {
  const counts = useMemo(() => countsOf(job), [job]);
  const total = job.paperIds.length;
  const SourceIcon = SOURCE_ICON[job.source.kind];
  const spent = Math.ceil(job.done * CREDITS_PER_PAPER);
  const running = Math.min(SLOTS, total - job.done);
  const max = maxScore(job.questions);
  const status = STATUS[job.status];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2.5">
            <h2 className="truncate text-xl font-semibold tracking-tight">{job.name}</h2>
            <StatusChip tone={status.tone} icon={job.status === "waiting" ? Hourglass : "tone"}>{status.label}</StatusChip>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2 py-0.5"><SourceIcon className="size-3" />{job.source.label}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2 py-0.5"><Layers className="size-3" />{total} papers</span>
            {job.saveTo ? <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2 py-0.5"><FolderOpen className="size-3" />Saves to {job.saveTo}</span> : null}
            {job.prune ? <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2 py-0.5"><FolderMinus className="size-3" />Removes excluded papers from {job.prune}</span> : null}
            <span className="px-1">{job.startedAt}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {job.status === "running" || job.status === "waiting" ? (
            <Button variant="outline" size="sm" onClick={onCancel}><Square className="fill-current" />Cancel</Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onRunAgain}><Copy />Run again</Button>
          )}
          <Button variant="outline" size="sm" disabled={job.done === 0}><Download />Export</Button>
        </div>
      </div>

      <Zone label="Progress" aside={<span className="text-xs tabular-nums text-muted-foreground">{job.done} of {total} papers</span>}>
        <div className="space-y-4 rounded-2xl border border-border/60 p-4">
          <OutcomeBar counts={counts} total={total} className="h-3" />
          <div className="flex flex-wrap gap-2">
            {(Object.keys(OUTCOME) as Outcome[]).map((o) => {
              const { label, icon: Icon, text } = OUTCOME[o];
              return (
                <span key={o} className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs">
                  <Icon className={cn("size-3.5", text)} />
                  <span className="font-medium tabular-nums">{counts[o]}</span>
                  <span className="text-muted-foreground">{label}</span>
                </span>
              );
            })}
          </div>
          <div className="grid gap-4 border-t border-border/40 pt-4 sm:grid-cols-2">
            {job.status === "waiting" && blocker ? (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium"><Hourglass className="size-3.5 text-amber-600" />Starts when a slot frees up</p>
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="truncate">{blocker.name}</span>
                  <span className="shrink-0 tabular-nums">{blocker.done} of {blocker.paperIds.length}</span>
                </div>
                <Meter value={blocker.done} max={blocker.paperIds.length} />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="flex items-center justify-between text-xs font-medium">
                  <span>Your paper slots</span>
                  <span className="tabular-nums text-muted-foreground">{job.status === "running" ? running : 0} of {SLOTS}</span>
                </p>
                <div className="flex gap-0.5" role="img" aria-label={`${job.status === "running" ? running : 0} of ${SLOTS} slots in use`}>
                  {Array.from({ length: SLOTS }, (_, i) => (
                    <span key={i} className={cn("h-2 flex-1 rounded-sm", job.status === "running" && i < running ? "bg-primary" : "bg-muted")} />
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <p className="flex items-center justify-between text-xs font-medium">
                <span className="flex items-center gap-1.5"><Coins className="size-3.5 text-primary" />Credits</span>
                <span className="tabular-nums text-muted-foreground">{spent} of up to {job.hold}</span>
              </p>
              <Meter value={spent} max={job.hold} />
            </div>
          </div>
        </div>
      </Zone>

      <Zone label="Questions" aside={<span className="text-xs text-muted-foreground">Included at {job.minScore} of {max} points</span>}>
        <div className={LIST}>
          {job.questions.map((q, i) => {
            const tally: Record<Answer, number> = { yes: 0, no: 0, unclear: 0 };
            for (const id of job.paperIds.slice(0, job.done)) tally[answerOf(job, id, q).answer]++;
            return (
              <div key={q.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums">{i + 1}</span>
                <p className="min-w-0 flex-1 text-sm">{q.text}</p>
                <div className="flex w-full items-center gap-3 sm:w-64">
                  <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    {(["yes", "unclear", "no"] as const).map((a) => (
                      <span key={a} className={cn("h-full transition-[width] duration-500 motion-reduce:transition-none", a === "yes" ? "bg-emerald-500" : a === "unclear" ? "bg-amber-400" : "bg-muted-foreground/35")} style={{ width: `${job.done ? (tally[a] / job.done) * 100 : 0}%` }} />
                    ))}
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{tally.yes} yes</span>
                </div>
              </div>
            );
          })}
        </div>
      </Zone>

      <Results job={job} counts={counts} max={max} onAnswer={onAnswer} />
    </div>
  );
}

function Results({ job, counts, max, onAnswer }: { job: Job; counts: Record<Outcome, number>; max: number; onAnswer: (paperId: string, questionKey: string, answer: Answer | null) => void }) {
  const [tab, setTab] = useState<Outcome>("included");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const rows = job.paperIds
    .slice(0, job.done)
    .filter((id) => outcomeOf(job, id) === tab)
    .map((id) => paperById.get(id)!)
    .filter((p) => !needle || p.title.toLowerCase().includes(needle) || p.authors.join(" ").toLowerCase().includes(needle));

  return (
    <Zone
      label="Papers"
      aside={
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a paper" aria-label="Find a paper" className="h-8 rounded-full pl-8 text-sm" />
        </div>
      }
    >
      <Segmented
        label="Outcome"
        value={tab}
        onChange={setTab}
        fill
        options={(Object.keys(OUTCOME) as Outcome[]).map((o) => ({
          id: o,
          label: OUTCOME[o].label,
          icon: OUTCOME[o].icon,
          detail: <span className="tabular-nums text-muted-foreground">{counts[o]}</span>,
        }))}
      />
      <div className={cn(LIST, "mt-3")}>
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {job.done === 0 ? "Papers show here as they're screened." : needle ? "No paper here matches." : `No ${OUTCOME[tab].label.toLowerCase()} papers.`}
          </p>
        ) : (
          rows.map((paper) => {
            const score = scoreOf(job, paper.id);
            const expanded = open === paper.id;
            return (
              <div key={paper.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : paper.id)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{paper.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[paper.authors.slice(0, 2).join(", ") + (paper.authors.length > 2 ? " and others" : ""), paper.year].filter(Boolean).join(", ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {job.questions.map((q, i) => {
                      const a = answerOf(job, paper.id, q);
                      return <AnswerMark key={q.key} answer={a.answer} changed={a.changed} label={`Question ${i + 1}`} />;
                    })}
                  </div>
                  <Stars count={starsOf(score, max)} />
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", expanded && "rotate-180")} />
                </button>
                {expanded ? <PaperDetail job={job} paperId={paper.id} onAnswer={onAnswer} /> : null}
              </div>
            );
          })
        )}
      </div>
    </Zone>
  );
}

function PaperDetail({ job, paperId, onAnswer }: { job: Job; paperId: string; onAnswer: (paperId: string, questionKey: string, answer: Answer | null) => void }) {
  const paper = paperById.get(paperId)!;
  return (
    <div className="grid gap-5 bg-muted/20 px-4 pb-5 pt-1 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-2">
        {paper.venue ? <p className="text-xs text-muted-foreground">{paper.venue}</p> : null}
        <p className="text-sm leading-relaxed text-foreground/85">{paper.abstract}</p>
      </div>
      <div className="space-y-3">
        {job.questions.map((q, i) => {
          const a = answerOf(job, paperId, q);
          return (
            <div key={q.key} className="space-y-1.5 rounded-xl border border-border/60 bg-background p-3">
              <p className="text-xs"><span className="mr-1.5 font-medium tabular-nums">{i + 1}</span>{q.text}</p>
              <div className="flex items-center gap-2">
                <div role="radiogroup" aria-label={`Answer to question ${i + 1}`} className="flex gap-1">
                  {(Object.keys(ANSWER) as Answer[]).map((answer) => {
                    const { label, icon: Icon, className } = ANSWER[answer];
                    const on = a.answer === answer;
                    return (
                      <button
                        key={answer}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onAnswer(paperId, q.key, answer)}
                        className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors", on ? className : "text-muted-foreground hover:bg-muted")}
                      >
                        <Icon className="size-3.5" />{label}
                      </button>
                    );
                  })}
                </div>
                {a.changed ? (
                  <TooltipHint label="Put back the model's answer">
                    <Button variant="ghost" size="icon" className="ml-auto size-7" aria-label="Put back the model's answer" onClick={() => onAnswer(paperId, q.key, null)}><Undo2 /></Button>
                  </TooltipHint>
                ) : (
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground" aria-label={`Model confidence ${Math.round(a.confidence * 100)}%`}>
                    <Meter value={a.confidence} max={1} className="w-12" fill={a.answer === "unclear" ? "bg-amber-400" : "bg-primary"} />
                    {Math.round(a.confidence * 100)}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
