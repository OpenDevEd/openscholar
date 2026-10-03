"use client";

import { useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, Ban, ChevronDown, Clock, Coins, Copy, Download, FolderMinus, FolderPlus, Gauge, Hourglass, Layers, Loader2, Quote, Search, Square, Undo2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FilterChips } from "@/components/ui/filter-display";
import { Input } from "@/components/ui/input";
import { TooltipHint } from "@/components/ui/tooltip";
import { StatusChip, type StatusTone } from "@/components/evidence-libraries/configuration/status-chip";
import { EASE } from "@/components/settings/model-map";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { PageStepper } from "@/components/shared/page-stepper";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { downloadExport } from "@/lib/export";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useWatchedSearch } from "@/lib/research/reads";
import { exportScreeningToXLSX } from "@/lib/screening/export";
import { ANSWERS, OUTCOMES, answerOf, doneOf, maxScore, questionsOf, valueOf, type Answer, type Job, type JobRow, type Outcome, type Paper, type Phase, type Question } from "@/lib/screening/setup";
import { useSearchHistoryStore } from "@/lib/store";
import { getErrorMessage, useAppToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ANSWER, AnimatedNumber, AnswerMark, Chip, Meter, OUTCOME, OutcomeBar, ProgressRing, SOURCE_ICON, Stars } from "./parts";

/** The chip on a paper about to move to another outcome, in that outcome's colour. */
const MOVING: Record<Outcome, string> = {
  included: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  unclear: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  excluded: "bg-foreground/10 text-foreground/80",
  failed: "bg-destructive/10 text-destructive",
};

/** Papers a page of an outcome lists, and the list's height with `rows` of them: 61px a row with the line under it, less the last row's line, plus the list's border. */
const PAGE_SIZE = 10;
const listPx = (rows: number) => rows * 61 + 1;

const TONE: Record<Exclude<Phase, "processing">, StatusTone> = {
  running: "running", waiting: "warning", completed: "success", cancelled: "neutral", failed: "danger", creditsExhausted: "danger",
};

type Translate = ReturnType<typeof useTranslations<"screeningPage">>;

/** What a job is called: its papers' set, as it was named when the job started. */
export function jobName(t: Translate, job: Pick<JobRow, "set" | "label" | "createdAt">, date: (at: number) => string) {
  if (job.set?.kind === "saved") return t("savedPapers");
  if (!job.label) return t("jobOn", { date: date(job.createdAt) });
  const name = job.label.charAt(0).toUpperCase() + job.label.slice(1);
  return job.set?.kind === "screening" ? t("includedIn", { name }) : name;
}

export function JobView({
  job,
  phase,
  blocker,
  onRunAgain,
}: {
  job: Job;
  phase: Exclude<Phase, "processing">;
  /** The person's job this one waits for, with its name. */
  blocker?: { name: string; done: number; total: number };
  onRunAgain: () => void;
}) {
  const t = useTranslations("screeningPage");
  const format = useFormatter();
  const toast = useAppToast();
  const convex = useConvex();
  const cancel = useMutation(api.screening.mutations.cancelScreeningJob);
  const [exporting, setExporting] = useState(false);
  const { data: slots } = useProtectedQuery(api.screening.queries.slots, phase === "running" ? {} : "skip");

  // A search's filters come from the search itself, read while its job shows.
  const searchId = job.set?.kind === "search" ? job.set.searchId : undefined;
  useWatchedSearch(searchId);
  const search = useSearchHistoryStore((state) => (searchId ? state.searchHistory.find((item) => item.id === searchId) : undefined));

  const questions = questionsOf(job);
  const max = maxScore(questions);
  const minimum = job.scoringConfig.minimumScore ?? 0;
  const counts = job.outcomes;
  const total = job.totalPapers;
  const done = doneOf(job);
  const active = phase === "running" || phase === "waiting";
  const name = jobName(t, job, (at) => format.dateTime(new Date(at), { dateStyle: "medium" }));
  const SourceIcon = job.set ? SOURCE_ICON[job.set.kind] : undefined;
  const source = job.set?.kind === "saved" ? t("savedPapers") : job.label;
  // Where included papers went: a collection while it exists, the library alone for a job from the results page's old dialog.
  const savedTo = job.unsaved ? undefined : (job.targetCollectionName ?? (job.targetCollectionId ? undefined : t("yourLibrary")));
  const pruned = job.prune ? job.label : undefined;
  const { spent, estimate } = job.credits;

  const exportAs = async (kind: "csv" | "json" | "xlsx") => {
    setExporting(true);
    try {
      // The server writes CSV and JSON a page of results at a time; a workbook is built here.
      if (kind === "xlsx") await exportScreeningToXLSX(convex, job._id);
      else await downloadExport(convex, { kind: "screening", jobId: job._id }, kind);
    } catch (error) {
      console.error("[screening] export failed", error);
      toast.error(t("exportFailed"), getErrorMessage(error, t("exportFailed")));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <ProgressRing value={done} max={total} phase={phase} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h2 className="truncate text-xl font-semibold tracking-tight">{name}</h2>
            <StatusChip tone={TONE[phase]} icon={phase === "waiting" ? Hourglass : "tone"}>{t(`phase.${phase}`)}</StatusChip>
          </div>
          {/* One line of facts and, for a search, its filters: it scrolls sideways under a fading edge. */}
          <div className="min-w-0 overflow-x-auto scrollbar-hover mask-r-from-[calc(100%-2rem)]">
            <div className="flex w-max items-center gap-1.5">
              {SourceIcon && source ? <Chip icon={SourceIcon}>{source}</Chip> : null}
              <Chip icon={Layers}><span>{t.rich("donePapers", { total, n: () => <AnimatedNumber value={done} /> })}</span></Chip>
              <Chip icon={Clock}>{format.dateTime(new Date(job.createdAt), { dateStyle: "medium", timeStyle: "short" })}</Chip>
              {search ? <FilterChips filters={{ ...search, field: undefined, sortBy: undefined }} size="compact" singleLine /> : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {job.status === "processing" ? (
            <Button variant="outline" size="sm" onClick={() => cancel({ jobId: job._id }).catch((error) => toast.error(t("cancelFailed"), getErrorMessage(error, t("cancelFailed"))))}>
              <Square className="fill-current" />{t("cancel")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onRunAgain}><Copy />{t("runAgain")}</Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={done === 0 || exporting}>
                {exporting ? <Loader2 className="animate-spin" /> : <Download />}{t("export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {job.status !== "completed" ? (
                <p className="mb-1 flex items-center gap-1.5 border-b border-border/40 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3 shrink-0" />{t("exportPartial")}
                </p>
              ) : null}
              {(["csv", "json", "xlsx"] as const).map((kind) => (
                <DropdownMenuItem key={kind} onClick={() => exportAs(kind)}>{t(`exportAs.${kind}`)}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Zone label={t("progress")}>
        <div className="space-y-4 rounded-2xl border border-border/60 bg-muted/40 p-4">
          <OutcomeBar counts={counts} total={total} flight={phase === "running" ? job.running : 0} className="h-3" />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            {OUTCOMES.map((o) => {
              const { icon: Icon, text } = OUTCOME[o];
              return (
                <span key={o} className="inline-flex items-center gap-1.5">
                  <Icon className={cn("size-3.5", text)} />
                  <span className="font-semibold tabular-nums"><AnimatedNumber value={counts[o]} /></span>
                  <span className="text-muted-foreground">{t(`outcome.${o}`)}</span>
                </span>
              );
            })}
            {phase === "running" ? (
              <span className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2.5 rounded-sm" style={{ backgroundImage: "repeating-linear-gradient(-45deg, var(--primary) 0 2px, color-mix(in oklab, var(--primary) 30%, transparent) 2px 4px)" }} />
                {t.rich("beingRead", { n: () => <span className="font-semibold tabular-nums text-foreground"><AnimatedNumber value={job.running} /></span> })}
              </span>
            ) : null}
          </div>
          <div className="grid gap-4 border-t border-border/40 pt-4 sm:grid-cols-2">
            {phase === "waiting" && blocker ? (
              <div className="space-y-2">
                <p className="flex items-center justify-between gap-3 text-xs font-medium">
                  <span className="flex min-w-0 items-center gap-1.5"><Hourglass className="size-3.5 shrink-0 text-amber-500" /><span className="truncate">{t("startsAfter", { name: blocker.name })}</span></span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{t("ofTotal", { done: blocker.done, total: blocker.total })}</span>
                </p>
                <Meter value={blocker.done} max={blocker.total} fill="bg-amber-400" />
              </div>
            ) : phase === "running" ? (
              <div className="space-y-2">
                <p className="flex items-center justify-between text-xs font-medium">
                  <span className="flex items-center gap-1.5"><Gauge className="size-3.5 text-primary" />{t("yourSlots")}</span>
                  {slots ? <span className="tabular-nums text-muted-foreground">{t("ofTotal", { done: slots.running, total: slots.limit })}</span> : null}
                </p>
                {/* The row keeps its height while the person's slots are read. */}
                <div className="flex h-1.5 gap-0.5" role="img" aria-label={slots ? t("slotsInUse", { running: slots.running, limit: slots.limit }) : undefined}>
                  {Array.from({ length: slots?.limit ?? 0 }, (_, i) => (
                    <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", i < (slots?.running ?? 0) ? "bg-primary" : "bg-foreground/10")} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 self-center">
                {/* A job from before these were kept counts them from its outcomes. */}
                {savedTo ? <Chip icon={FolderPlus} className="text-foreground">{t.rich("savedTo", { count: job.saved ?? counts.included, name: savedTo, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</Chip> : null}
                {pruned ? <Chip icon={FolderMinus} className="text-foreground">{t.rich("removedFrom", { count: job.removed ?? counts.excluded + counts.failed, name: pruned, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</Chip> : null}
                {!savedTo && !pruned ? <Chip icon={Ban}>{t("noCollectionChanged")}</Chip> : null}
              </div>
            )}
            {spent === undefined ? null : (
              <div className="space-y-2">
                <p className="flex items-center justify-between text-xs font-medium">
                  <span className="flex items-center gap-1.5"><Coins className="size-3.5 text-primary" />{t("credits")}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {active ? t.rich("spentOfUpTo", { estimate, n: () => <AnimatedNumber value={Math.ceil(spent)} /> }) : t("spent", { spent: Math.ceil(spent) })}
                  </span>
                </p>
                <Meter value={spent} max={Math.max(estimate, spent)} />
              </div>
            )}
          </div>
          {active && (savedTo || pruned) ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-4">
              {savedTo ? <Chip icon={FolderPlus}>{t("savesTo", { name: savedTo })}</Chip> : null}
              {pruned ? <Chip icon={FolderMinus}>{t("removesFrom", { name: pruned })}</Chip> : null}
            </div>
          ) : null}
        </div>
      </Zone>

      <Zone label={t("questions")} aside={<span className="text-xs text-muted-foreground">{t("includedAt", { minimum, max })}</span>}>
        <div className={LIST}>
          {questions.map((q, i) => {
            const kept = job.tallies?.find((tally) => tally.key === q.key);
            const tally: Record<Answer, number> = { yes: kept?.yes ?? 0, no: kept?.no ?? 0, unclear: kept?.unclear ?? 0 };
            const answered = tally.yes + tally.no + tally.unclear;
            return (
              <div key={q.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums">{i + 1}</span>
                <p className="min-w-0 flex-1 text-sm">{q.text}</p>
                <div className="flex w-full items-center gap-4 sm:w-auto">
                  <div className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10 sm:w-40 sm:flex-none">
                    {(["yes", "unclear", "no"] as const).map((a) => (
                      <span key={a} className={cn("h-full transition-[width] duration-500 motion-reduce:transition-none", a === "yes" ? "bg-emerald-500" : a === "unclear" ? "bg-amber-400" : "bg-muted-foreground/35")} style={{ width: `${answered ? (tally[a] / answered) * 100 : 0}%` }} />
                    ))}
                  </div>
                  {/* Three columns, each wide enough for the job's every paper, so no count reaches the bar and the counts line up from question to question. */}
                  <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
                    {(["yes", "unclear", "no"] as const).map((a) => {
                      const { icon: Icon } = ANSWER[a];
                      return (
                        <span key={a} className="inline-flex items-center justify-end gap-1" style={{ width: `calc(${String(total).length}ch + 1rem)` }} aria-label={t("tally", { count: tally[a], answer: t(`answer.${a}`) })}>
                          <Icon aria-hidden className={cn("size-3 shrink-0", a === "yes" ? "text-emerald-500" : a === "unclear" ? "text-amber-500" : "text-muted-foreground")} />
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

      <Results key={job._id} job={job} questions={questions} max={max} minimum={minimum} done={done} />
    </div>
  );
}

type Held = { paper: Paper; index: number };

function Results({ job, questions, max, minimum, done }: { job: Job; questions: Question[]; max: number; minimum: number; done: number }) {
  const t = useTranslations("screeningPage");
  const toast = useAppToast();
  const [tab, setTab] = useState<Outcome>("included");
  const [query, setQuery] = useState("");
  const text = useDebouncedValue(query.trim(), 300);
  const [open, setOpen] = useState<string | null>(null);
  // The paper whose answers were just changed stays in the list, even once its outcome is
  // another's, until something else is touched: another paper, an outcome, a page, the search.
  const [held, setHeld] = useState<Held | null>(null);
  const list = useCursorPage(api.screening.papers.list, { jobId: job._id, outcome: tab, ...(text ? { text } : {}) }, PAGE_SIZE);
  // The held paper as it stands now, read on its own: its outcome's list no longer holds it.
  const { data: current } = useProtectedQuery(api.screening.papers.get, held ? { jobId: job._id, paperId: held.paper.openalexId } : "skip");
  const answer = useMutation(api.screening.papers.answer);

  const heldPaper = held ? (current ?? held.paper) : undefined;
  const rows =
    held && heldPaper && !list.items.some((paper) => paper.openalexId === heldPaper.openalexId)
      ? // Added to the page's own papers, so the one that took its place isn't hidden and the next page starts after it.
        [...list.items.slice(0, held.index), heldPaper, ...list.items.slice(held.index)]
      : list.items.map((paper) => (heldPaper && paper.openalexId === heldPaper.openalexId ? heldPaper : paper));
  // A search's matches aren't counted on the server, so its pager shows the page alone.
  const count = job.outcomes[tab];
  const pageCount = text ? undefined : Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasPages = list.isLoading ? !text && count > PAGE_SIZE : list.hasPages;

  const change = (paper: Paper, index: number, questionKey: string, value: Answer | null) => {
    // Shown at once on the held paper; the server's version replaces it when it arrives.
    const answers = paper.answers.map((a) => (a.key === questionKey && value !== null ? { ...a, answer: valueOf(value), changed: true } : a));
    setHeld({ paper: { ...paper, answers }, index });
    answer({ jobId: job._id, paperId: paper.openalexId, questionKey, answer: value === null ? "model" : valueOf(value) }).catch((error) => {
      setHeld(null);
      toast.error(t("answerFailed"), getErrorMessage(error, t("answerFailed")));
    });
  };

  return (
    <Zone
      label={t("papers")}
      aside={
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => { setHeld(null); setQuery(e.target.value); }} placeholder={t("findPaper")} aria-label={t("findPaper")} className="h-8 rounded-full pl-8 text-sm" />
        </div>
      }
    >
      <Segmented
        label={t("outcomeLabel")}
        value={tab}
        onChange={(next) => { setHeld(null); setTab(next); }}
        fill
        options={OUTCOMES.map((o) => ({
          id: o,
          label: t(`outcome.${o}`),
          icon: OUTCOME[o].icon,
          detail: <span className="tabular-nums text-muted-foreground"><AnimatedNumber value={job.outcomes[o]} /></span>,
        }))}
      />
      {/* The list keeps a full page's height while its outcome has pages, and its papers' height while they load, so nothing under it moves. */}
      <div style={{ minHeight: hasPages ? listPx(PAGE_SIZE) : list.isLoading && !text && count ? listPx(count) : undefined }}>
        <motion.div
          // One list per outcome, search and page, and per arrival of its papers: rows only animate for changes inside the list shown.
          key={`${tab}\n${text}\n${list.page}\n${list.isStale}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          className={cn(LIST, "mt-3", list.isStale && "pointer-events-none opacity-60", list.isLoading && "invisible")}
        >
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {done === 0 ? t("papersShowHere") : text ? t("noPaperMatches") : t(`noPapers.${tab}`)}
            </p>
          ) : (
            <AnimatePresence initial={false}>
              {rows.map((paper, index) => {
                const expanded = open === paper.openalexId;
                // Held here after a change that gave it another outcome: it leaves towards that outcome's tab.
                const leaving = paper.openalexId === held?.paper.openalexId && paper.outcome !== tab;
                const towards = OUTCOMES.indexOf(paper.outcome) > OUTCOMES.indexOf(tab) ? 1 : -1;
                const authors = paper.authors ?? [];
                return (
                  <motion.div
                    key={paper.openalexId}
                    layout="position"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={leaving ? { opacity: 0, height: 0, x: towards * 48 } : { opacity: 0, height: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => { if (paper.openalexId !== held?.paper.openalexId) setHeld(null); setOpen(expanded ? null : paper.openalexId); }}
                      className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                    >
                      <div className={cn("min-w-0 flex-1 transition-opacity duration-300", leaving && "opacity-50")}>
                        <p className="truncate text-sm font-medium">{paper.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[authors.length > 2 ? t("andOthers", { authors: authors.slice(0, 2).join(", ") }) : authors.join(", "), paper.publicationYear].filter(Boolean).join(", ")}
                        </p>
                      </div>
                      {leaving ? (
                        <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease: EASE }} className="shrink-0">
                          <Chip icon={OUTCOME[paper.outcome].icon} className={cn("animate-pulse motion-reduce:animate-none", MOVING[paper.outcome])}>{t("movesTo", { outcome: t(`outcome.${paper.outcome}`) })}</Chip>
                        </motion.span>
                      ) : paper.citedByCount ? <Chip icon={Quote} className="hidden md:inline-flex">{t("cited", { count: paper.citedByCount })}</Chip> : null}
                      <div className="flex shrink-0 items-center gap-1">
                        {paper.answers.map((a, i) => (
                          <AnswerMark key={a.key} answer={answerOf(a.answer)} changed={a.changed} label={t("questionNumber", { number: i + 1 })} />
                        ))}
                      </div>
                      <Stars count={paper.stars ?? 0} />
                      <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", expanded && "rotate-180")} />
                    </button>
                    <AnimatePresence initial={false}>
                      {expanded ? (
                        <motion.div key="detail" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
                          <PaperDetail paper={paper} questions={questions} max={max} minimum={minimum} onAnswer={(key, value) => change(paper, index, key, value)} />
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
      {hasPages ? (
        <PageStepper
          className="pt-3"
          page={list.page}
          pageCount={pageCount}
          canPrevious={list.canPrevious}
          canNext={list.canNext}
          onPrevious={() => { setHeld(null); list.previous(); }}
          onNext={() => { setHeld(null); list.next(); }}
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
function PaperDetail({ paper, questions, max, minimum, onAnswer }: { paper: Paper; questions: Question[]; max: number; minimum: number; onAnswer: (questionKey: string, answer: Answer | null) => void }) {
  const t = useTranslations("screeningPage");
  const score = paper.score ?? 0;
  const { icon: OutcomeIcon, text, bar } = OUTCOME[paper.outcome];
  return (
    <div className="space-y-4 bg-muted/20 px-4 pb-5 pt-2">
      <div className="flex items-center gap-3">
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-sm font-medium", text)}><OutcomeIcon className="size-4" />{t(`outcome.${paper.outcome}`)}</span>
        {/* The score as a track, with a mark where a paper starts to be included. */}
        <div className="relative h-2 min-w-0 flex-1 rounded-full bg-muted" role="img" aria-label={t("scoreLabel", { score, max, minimum })}>
          <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", bar)} style={{ width: `${max ? (score / max) * 100 : 0}%` }} />
          <span aria-hidden className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70" style={{ left: `${max ? (minimum / max) * 100 : 0}%` }} />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t.rich("scoreOf", { score, max, minimum, n: (chunks) => <span className="text-sm font-semibold text-foreground">{chunks}</span> })}</span>
      </div>

      <ul>
        {questions.map((q, i) => {
          const given = paper.answers.find((a) => a.key === q.key);
          const a = answerOf(given?.answer ?? null);
          const points = q[a];
          const earned = points === 0 ? "text-muted-foreground/60" : a === "yes" ? OUTCOME.included.text : a === "unclear" ? OUTCOME.unclear.text : "text-foreground";
          return (
            <li key={q.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)_2rem] items-center gap-x-3 gap-y-1 py-1.5 md:grid-cols-[1.25rem_minmax(0,1fr)_auto_5.5rem_2rem]">
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{i + 1}</span>
              <p className="text-sm">{q.text}</p>
              {/* Under the question on a narrow screen; in the row's own columns on a wide one. */}
              <div className="col-span-2 col-start-2 row-start-2 flex items-center justify-between gap-2 md:contents">
                <div role="radiogroup" aria-label={t("answerTo", { number: i + 1 })} className="flex gap-1">
                  {ANSWERS.map((option) => {
                    const { icon: Icon, className } = ANSWER[option];
                    const on = a === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={paper.outcome === "failed"}
                        onClick={() => onAnswer(q.key, option)}
                        className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors", on ? className : "text-muted-foreground hover:bg-muted")}
                      >
                        <Icon className="size-3.5" />{t(`answer.${option}`)}
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-end">
                  {given?.changed ? (
                    <TooltipHint label={t("putBack")}>
                      <Button variant="ghost" size="icon" className="size-7" aria-label={t("putBack")} onClick={() => onAnswer(q.key, null)}><Undo2 /></Button>
                    </TooltipHint>
                  ) : given?.confidence !== undefined ? (
                    <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground" aria-label={t("confidence", { percent: Math.round(given.confidence * 100) })}>
                      <Meter value={given.confidence} max={1} className="w-10" fill={a === "unclear" ? "bg-amber-400" : "bg-primary"} />
                      {Math.round(given.confidence * 100)}%
                    </span>
                  ) : null}
                </div>
              </div>
              <span className={cn("col-start-3 row-start-1 text-right text-xs font-semibold tabular-nums md:col-start-auto md:row-start-auto", earned)} aria-label={t("points", { points })}>
                +{points}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="space-y-1.5">
        {paper.venue ? <p className="text-xs text-muted-foreground">{paper.venue}</p> : null}
        {paper.abstract ? <p className="text-sm leading-relaxed text-foreground/80 lg:columns-2 lg:gap-8">{paper.abstract}</p> : null}
      </div>
    </div>
  );
}
