"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "@/components/settings/model-map";
import { FilterChips } from "@/components/ui/filter-display";
import {
  Ban, BookMarked, ChevronDown, Clock, Coins, Copy, Download, FolderMinus, FolderOpen, FolderPlus, Gauge, Hourglass, Layers, ListChecks, Quote, Search, Square, Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipHint } from "@/components/ui/tooltip";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { PageStepper } from "@/components/shared/page-stepper";
import { cn } from "@/lib/utils";
import {
  CREDITS_PER_PAPER, SLOTS, answerOf, maxScore, outcomeOf, paperById, scoreOf, starsOf,
  type Answer, type Job, type Outcome, type Source,
} from "./data";
import { ANSWER, AnimatedNumber, AnswerMark, Chip, Meter, OUTCOME, OutcomeBar, ProgressRing, Stars } from "./parts";

/** Papers a page of an outcome lists, and a full page's height: 61px a row with the line under it, less the last row's line, plus the list's border. */
const PAGE_SIZE = 10;
const FULL_PAGE_PX = PAGE_SIZE * 61 + 1;

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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <ProgressRing value={job.done} max={total} status={job.status} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h2 className="truncate text-xl font-semibold tracking-tight">{job.name}</h2>
            <StatusChip tone={status.tone} icon={job.status === "waiting" ? Hourglass : "tone"}>{status.label}</StatusChip>
          </div>
          {/* One line of facts and, for a search, its filters: it scrolls sideways under a fading edge. */}
          <div className="min-w-0 overflow-x-auto scrollbar-hover mask-r-from-[calc(100%-2rem)]">
            <div className="flex w-max items-center gap-1.5">
              <Chip icon={SourceIcon}>{job.source.label}</Chip>
              <Chip icon={Layers}><span><AnimatedNumber value={job.done} /> of {total} papers</span></Chip>
              <Chip icon={Clock}>{job.startedAt}</Chip>
              {job.source.kind === "search" ? <FilterChips filters={job.source.filters} size="compact" singleLine /> : null}
            </div>
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

      <Zone label="Progress">
        <div className="space-y-4 rounded-2xl border border-border/60 bg-muted/40 p-4">
          <OutcomeBar counts={counts} total={total} flight={job.status === "running" ? running : 0} className="h-3" />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            {(Object.keys(OUTCOME) as Outcome[]).map((o) => {
              const { label, icon: Icon, text } = OUTCOME[o];
              return (
                <span key={o} className="inline-flex items-center gap-1.5">
                  <Icon className={cn("size-3.5", text)} />
                  <span className="font-semibold tabular-nums"><AnimatedNumber value={counts[o]} /></span>
                  <span className="text-muted-foreground">{label}</span>
                </span>
              );
            })}
            {job.status === "running" ? (
              <span className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2.5 rounded-sm" style={{ backgroundImage: "repeating-linear-gradient(-45deg, var(--primary) 0 2px, color-mix(in oklab, var(--primary) 30%, transparent) 2px 4px)" }} />
                <span className="font-semibold tabular-nums text-foreground"><AnimatedNumber value={running} /></span> being read
              </span>
            ) : null}
          </div>
          <div className="grid gap-4 border-t border-border/40 pt-4 sm:grid-cols-2">
            {job.status === "waiting" && blocker ? (
              <div className="space-y-2">
                <p className="flex items-center justify-between gap-3 text-xs font-medium">
                  <span className="flex min-w-0 items-center gap-1.5"><Hourglass className="size-3.5 shrink-0 text-amber-500" /><span className="truncate">Starts after {blocker.name}</span></span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{blocker.done} of {blocker.paperIds.length}</span>
                </p>
                <Meter value={blocker.done} max={blocker.paperIds.length} fill="bg-amber-400" />
              </div>
            ) : job.status === "running" ? (
              <div className="space-y-2">
                <p className="flex items-center justify-between text-xs font-medium">
                  <span className="flex items-center gap-1.5"><Gauge className="size-3.5 text-primary" />Your paper slots</span>
                  <span className="tabular-nums text-muted-foreground">{running} of {SLOTS}</span>
                </p>
                <div className="flex gap-0.5" role="img" aria-label={`${running} of ${SLOTS} slots in use`}>
                  {Array.from({ length: SLOTS }, (_, i) => (
                    <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", i < running ? "bg-primary" : "bg-foreground/10")} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 self-center">
                {job.saveTo ? <Chip icon={FolderPlus} className="text-foreground"><span className="font-semibold">{counts.included}</span> saved to {job.saveTo}</Chip> : null}
                {job.prune ? <Chip icon={FolderMinus} className="text-foreground"><span className="font-semibold">{counts.excluded + counts.failed}</span> removed from {job.prune}</Chip> : null}
                {!job.saveTo && !job.prune ? <Chip icon={Ban}>No collection changed</Chip> : null}
              </div>
            )}
            <div className="space-y-2">
              <p className="flex items-center justify-between text-xs font-medium">
                <span className="flex items-center gap-1.5"><Coins className="size-3.5 text-primary" />Credits</span>
                <span className="tabular-nums text-muted-foreground">
                  {job.status === "completed" || job.status === "cancelled" ? job.hold > spent ? `${spent} spent, ${job.hold - spent} returned` : `${spent} spent` : <span><AnimatedNumber value={spent} /> of up to {job.hold}</span>}
                </span>
              </p>
              <Meter value={spent} max={job.hold} />
            </div>
          </div>
          {(job.status === "running" || job.status === "waiting") && (job.saveTo || job.prune) ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-4">
              {job.saveTo ? <Chip icon={FolderPlus}>Saves included papers to {job.saveTo}</Chip> : null}
              {job.prune ? <Chip icon={FolderMinus}>Removes excluded papers from {job.prune}</Chip> : null}
            </div>
          ) : null}
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
                <div className="flex w-full items-center gap-3 sm:w-72">
                  <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                    {(["yes", "unclear", "no"] as const).map((a) => (
                      <span key={a} className={cn("h-full transition-[width] duration-500 motion-reduce:transition-none", a === "yes" ? "bg-emerald-500" : a === "unclear" ? "bg-amber-400" : "bg-muted-foreground/35")} style={{ width: `${job.done ? (tally[a] / job.done) * 100 : 0}%` }} />
                    ))}
                  </div>
                  <span className="flex w-28 shrink-0 items-center justify-end gap-2.5 text-xs tabular-nums">
                    {(["yes", "unclear", "no"] as const).map((a) => {
                      const { icon: Icon, label } = ANSWER[a];
                      return (
                        <span key={a} className="inline-flex items-center gap-0.5" aria-label={`${tally[a]} ${label}`}>
                          <Icon aria-hidden className={cn("size-3", a === "yes" ? "text-emerald-500" : a === "unclear" ? "text-amber-500" : "text-muted-foreground")} />
                          {tally[a]}
                        </span>
                      );
                    })}
                  </span>
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
  const matches = job.paperIds
    .slice(0, job.done)
    .filter((id) => outcomeOf(job, id) === tab)
    .map((id) => paperById.get(id)!)
    .filter((p) => !needle || p.title.toLowerCase().includes(needle) || p.authors.join(" ").toLowerCase().includes(needle));
  // One page of the outcome at a time, as the real page reads it; a new outcome or search starts at the first.
  const list = `${tab}\n${needle}`;
  const [at, setAt] = useState({ list, page: 1 });
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const page = Math.min(at.list === list ? at.page : 1, pageCount);
  const rows = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
          detail: <span className="tabular-nums text-muted-foreground"><AnimatedNumber value={counts[o]} /></span>,
        }))}
      />
      {/* While the outcome has pages the list keeps a full page's height, so the pager stays put on a short last page. */}
      <div style={pageCount > 1 ? { minHeight: FULL_PAGE_PX } : undefined}>
      <motion.div key={`${list}\n${page}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }} className={cn(LIST, "mt-3")}>
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {job.done === 0 ? "Papers show here as they're screened." : needle ? "No paper here matches." : `No ${OUTCOME[tab].label.toLowerCase()} papers.`}
          </p>
        ) : (
          <AnimatePresence initial={false}>
          {rows.map((paper) => {
            const score = scoreOf(job, paper.id);
            const expanded = open === paper.id;
            return (
              <motion.div
                key={paper.id}
                layout="position"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="overflow-hidden"
              >
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
                  {paper.cited ? <Chip icon={Quote} className="hidden md:inline-flex">{paper.cited.toLocaleString()} cited</Chip> : null}
                  <div className="flex shrink-0 items-center gap-1">
                    {job.questions.map((q, i) => {
                      const a = answerOf(job, paper.id, q);
                      return <AnswerMark key={q.key} answer={a.answer} changed={a.changed} label={`Question ${i + 1}`} />;
                    })}
                  </div>
                  <Stars count={starsOf(score, job.stars)} />
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", expanded && "rotate-180")} />
                </button>
                <AnimatePresence initial={false}>
                  {expanded ? (
                    <motion.div key="detail" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
                      <PaperDetail job={job} paperId={paper.id} onAnswer={onAnswer} />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>
            );
          })}
          </AnimatePresence>
        )}
      </motion.div>
      </div>
      {pageCount > 1 ? (
        <PageStepper
          className="pt-3"
          page={page}
          // A search's matches aren't counted on the server, so its pager shows the page alone.
          pageCount={needle ? undefined : pageCount}
          canPrevious={page > 1}
          canNext={page < pageCount}
          onPrevious={() => setAt({ list, page: page - 1 })}
          onNext={() => setAt({ list, page: page + 1 })}
        />
      ) : null}
    </Zone>
  );
}

/**
 * Why a paper landed where it did, then the text to check it against: its score against
 * the score that includes it, each question's answer on one line with what it added, and
 * the abstract underneath.
 */
function PaperDetail({ job, paperId, onAnswer }: { job: Job; paperId: string; onAnswer: (paperId: string, questionKey: string, answer: Answer | null) => void }) {
  const paper = paperById.get(paperId)!;
  const score = scoreOf(job, paperId);
  const max = maxScore(job.questions);
  const outcome = outcomeOf(job, paperId);
  const { label, icon: OutcomeIcon, text, bar } = OUTCOME[outcome];
  return (
    <div className="space-y-4 bg-muted/20 px-4 pb-5 pt-2">
      <div className="flex items-center gap-3">
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-sm font-medium", text)}><OutcomeIcon className="size-4" />{label}</span>
        {/* The score as a track, with a mark where a paper starts to be included. */}
        <div className="relative h-2 min-w-0 flex-1 rounded-full bg-muted" role="img" aria-label={`${score} of ${max} points; included from ${job.minScore}`}>
          <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", bar)} style={{ width: `${max ? (score / max) * 100 : 0}%` }} />
          <span aria-hidden className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70" style={{ left: `${max ? (job.minScore / max) * 100 : 0}%` }} />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground"><span className="text-sm font-semibold text-foreground">{score}</span> of {max} points, included from {job.minScore}</span>
      </div>

      <ul>
        {job.questions.map((q, i) => {
          const a = answerOf(job, paperId, q);
          const points = q[a.answer];
          const earned = points === 0 ? "text-muted-foreground/60" : a.answer === "yes" ? OUTCOME.included.text : a.answer === "unclear" ? OUTCOME.unclear.text : "text-foreground";
          return (
            <li key={q.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)_2rem] items-center gap-x-3 gap-y-1 py-1.5 md:grid-cols-[1.25rem_minmax(0,1fr)_auto_5.5rem_2rem]">
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{i + 1}</span>
              <p className="text-sm">{q.text}</p>
              {/* Under the question on a narrow screen; in the row's own columns on a wide one. */}
              <div className="col-span-2 col-start-2 row-start-2 flex items-center justify-between gap-2 md:contents">
              <div role="radiogroup" aria-label={`Answer to question ${i + 1}`} className="flex gap-1">
                {(Object.keys(ANSWER) as Answer[]).map((answer) => {
                  const { label: name, icon: Icon, className } = ANSWER[answer];
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
                      <Icon className="size-3.5" />{name}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end">
                {a.changed ? (
                  <TooltipHint label="Put back the model's answer">
                    <Button variant="ghost" size="icon" className="size-7" aria-label="Put back the model's answer" onClick={() => onAnswer(paperId, q.key, null)}><Undo2 /></Button>
                  </TooltipHint>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground" aria-label={`Model confidence ${Math.round(a.confidence * 100)}%`}>
                    <Meter value={a.confidence} max={1} className="w-10" fill={a.answer === "unclear" ? "bg-amber-400" : "bg-primary"} />
                    {Math.round(a.confidence * 100)}%
                  </span>
                )}
              </div>
              </div>
              <span className={cn("col-start-3 row-start-1 text-right text-xs font-semibold tabular-nums md:col-start-auto md:row-start-auto", earned)} aria-label={`${points} points`}>
                +{points}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="space-y-1.5">
        {paper.venue ? <p className="text-xs text-muted-foreground">{paper.venue}</p> : null}
        <p className="text-sm leading-relaxed text-foreground/80 lg:columns-2 lg:gap-8">{paper.abstract}</p>
      </div>
    </div>
  );
}
