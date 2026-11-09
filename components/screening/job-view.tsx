"use client";

import { SEARCH_SOURCE_NAMES } from "@/lib/search/source";
import { FadeRow } from "@/components/ui/fade-row";
import { useState } from "react";
import { useConvex } from "convex/react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, Ban, ChevronDown, CircleX, Clock, Coins, Copy, Download, FileSearch, FolderMinus, FolderPlus, Gauge, Hourglass, Layers, Loader2, Quote, Search, Square, TriangleAlert, Undo2,
} from "@/components/icons";
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
import { ListFocus, openListFocus } from "@/components/focus-mode/list-focus";
import { PaperTitle } from "@/components/focus-mode/paper-title";
import { ANSWER, AnimatedNumber, AnswerMark, Chip, ClippedChip, Meter, OUTCOME, OutcomeBar, ProgressRing, RequiredMark, SOURCE_ICON, Stars } from "./parts";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import { plainAbstract } from "@/lib/papers/abstract-text";

/** The chip on a paper about to move to another outcome, in that outcome's colour. */
const MOVING: Record<Outcome, string> = {
  included: "bg-success/12 ink-success",
  unclear: "bg-warning/12 ink-warning",
  excluded: "bg-foreground/10 text-foreground/80",
  failed: "bg-destructive/10 text-destructive",
};

/** Papers a page of an outcome lists, and the list's height with `rows` of them: 61px a row with the line under it, less the last row's line, plus the list's border. */
const PAGE_SIZE = 10;
const listPx = (rows: number) => rows * 61 + 1;

const TONE: Record<Exclude<Phase, "processing">, StatusTone> = {
  running: "running", waiting: "warning", reading: "running", completed: "success", cancelled: "neutral", failed: "danger", creditsExhausted: "danger",
};

type Translate = ReturnType<typeof useTranslations<"screeningPage">>;

/** What a job is called: the name it was given as it started, else its papers' set, as it was named then. */
export function jobName(t: Translate, job: Pick<JobRow, "createdAt"> & Partial<Pick<JobRow, "name" | "set" | "label"> & Pick<Job, "source">>, date: (at: number) => string) {
  if (job.name) return job.name;
  // Someone it's shared with is told the kind of its papers' set, not which one (`source`).
  const kind = job.set?.kind ?? job.source;
  if (kind === "saved") return t("savedPapers");
  if (!job.label) return t("jobOn", { date: date(job.createdAt) });
  const name = job.label.charAt(0).toUpperCase() + job.label.slice(1);
  return kind === "screening" ? t("includedIn", { name }) : name;
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
  const workspaceId = useWorkspace();
  const t = useTranslations("screeningPage");
  const format = useFormatter();
  const toast = useAppToast();
  const convex = useConvex();
  const cancel = useWorkspaceMutation(api.screening.mutations.cancelScreeningJob);
  const [exporting, setExporting] = useState(false);
  // Someone it's shared with reads it (#653): running, cancelling and changing it are its workspace's, and so are the slots it runs in.
  const guest = Boolean(job.guest);
  const { data: slots } = useProtectedQuery(api.screening.queries.slots, inWorkspace(workspaceId, phase === "running" && !guest ? {} : "skip"));

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
  const active = phase === "running" || phase === "waiting" || phase === "reading";
  const name = jobName(t, job, (at) => format.dateTime(new Date(at), { dateStyle: "medium" }));
  const sourceKind = job.set?.kind ?? job.source;
  const SourceIcon = sourceKind ? SOURCE_ICON[sourceKind] : undefined;
  const source = sourceKind === "saved" ? t("savedPapers") : job.label;
  // Where included papers went: a collection while it exists, the library alone for a job from the results page's old dialog.
  // A guest is told neither: both are of a library that isn't theirs.
  const savedTo = guest || job.unsaved ? undefined : (job.targetCollectionName ?? (job.targetCollectionId ? undefined : t("theLibrary")));
  const pruned = !guest && job.prune ? (job.pruneName ?? job.label) : undefined;
  // The Evidence Library collection its included papers go to instead: the person's own there, which a guest isn't told of.
  const libraryDest = guest ? undefined : job.libraryDestination;
  const { spent, estimate } = job.credits ?? { spent: undefined, estimate: 0 };

  const exportAs = async (kind: "csv" | "json" | "xlsx") => {
    setExporting(true);
    try {
      // The server writes CSV and JSON a page of results at a time; a workbook is built here.
      if (kind === "xlsx") await exportScreeningToXLSX(convex, job._id, workspaceId);
      else if (!workspaceId) throw new Error("The workspace hasn't loaded yet. Try again in a moment.");
      else await downloadExport(convex, workspaceId, { kind: "screening", jobId: job._id }, kind);
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
        {/* A least width, so on a narrow screen the buttons take the next line and not the title's room. */}
        <div className="min-w-0 flex-1 basis-60 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h2 className="truncate text-xl font-semibold tracking-tight">{name}</h2>
            {/* One that stopped at the most it may spend still has credits to its name: it says so, not "Out of credits". */}
            <StatusChip className="shrink-0 whitespace-nowrap" tone={TONE[phase]} icon={phase === "waiting" ? Hourglass : "tone"}>{phase === "creditsExhausted" && job.capped ? t("phase.capped") : t(`phase.${phase}`)}</StatusChip>
          </div>
          {/* One line of facts and, for a search, its filters: it scrolls sideways under a fading edge. */}
          <FadeRow scrolls>
            <div className="flex w-max items-center gap-1.5">
              {SourceIcon && source ? <Chip icon={SourceIcon}>{source}</Chip> : null}
              <Chip icon={Layers}><span>{t.rich("donePapers", { total, n: () => <AnimatedNumber value={done} /> })}</span></Chip>
              <Chip icon={Clock}>{format.dateTime(new Date(job.createdAt), { dateStyle: "medium", timeStyle: "short" })}</Chip>
              {search ? <FilterChips filters={{ ...search, field: undefined, sortBy: undefined }} size="compact" singleLine /> : null}
            </div>
          </FadeRow>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {/* A screening of the person's Zotero is run again from a chat: the page has no Zotero to pick. */}
          {guest ? null : job.status === "processing" ? (
            <Button variant="outline" size="sm" onClick={() => cancel({ jobId: job._id }).catch((error) => toast.error(t("cancelFailed"), getErrorMessage(error, t("cancelFailed"))))}>
              <Square className="fill-current" />{t("cancel")}
            </Button>
          ) : job.set?.kind === "zotero" ? null : (
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
                <p className="mb-1 flex items-center gap-1.5 border-b border-border-subtle px-2 py-1.5 text-[11px] ink-warning">
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
        <div className="space-y-4 rounded-2xl border border-border-subtle bg-inset p-4">
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
              <span className="ms-auto inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2.5 rounded-sm" style={{ backgroundImage: "repeating-linear-gradient(-45deg, var(--primary) 0 2px, color-mix(in oklab, var(--primary) 30%, transparent) 2px 4px)" }} />
                {t.rich("beingRead", { n: () => <span className="font-semibold tabular-nums text-foreground"><AnimatedNumber value={job.running} /></span> })}
              </span>
            ) : null}
          </div>
          {/* What it waits on, runs in, changed and cost: a guest sees only that its papers are being got, or why it failed. */}
          {guest && phase !== "reading" && !job.failure ? null : (
          <div className="grid gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2">
            {phase === "waiting" && blocker ? (
              <div className="space-y-2">
                <p className="flex items-center justify-between gap-3 text-xs font-medium">
                  <span className="flex min-w-0 items-center gap-1.5"><Hourglass className="size-3.5 shrink-0 text-warning" /><span className="truncate">{t("startsAfter", { name: blocker.name })}</span></span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{t("ofTotal", { done: blocker.done, total: blocker.total })}</span>
                </p>
                <Meter value={blocker.done} max={blocker.total} fill="bg-warning" />
              </div>
            ) : phase === "reading" ? (
              // The job's papers haven't come from its search yet: the row is the one its slots take once they have.
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium"><FileSearch className="size-3.5 shrink-0 text-primary" /><span className="truncate">{t("gettingPapers", { source: SEARCH_SOURCE_NAMES[job.snapshot?.request.source ?? "openalex"] })}</span></p>
                <Meter value={0} max={1} />
              </div>
            ) : phase === "running" ? (
              <div className="space-y-2">
                <p className="flex items-center justify-between text-xs font-medium">
                  <span className="flex items-center gap-1.5"><Gauge className="size-3.5 text-primary" />{t("papersAtOnce")}</span>
                  {slots ? <span className="tabular-nums text-muted-foreground">{t("ofTotal", { done: slots.running, total: slots.limit })}</span> : null}
                </p>
                {/* The row keeps its height while the workspace's slots are read. */}
                <div className="flex h-1.5 gap-0.5" role="img" aria-label={slots ? t("slotsInUse", { running: slots.running, limit: slots.limit }) : undefined}>
                  {Array.from({ length: slots?.limit ?? 0 }, (_, i) => (
                    <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", i < (slots?.running ?? 0) ? "bg-primary" : "bg-foreground/10")} />
                  ))}
                </div>
              </div>
            ) : job.failure ? (
              <p className="flex items-start gap-1.5 self-center text-xs font-medium text-destructive"><CircleX className="mt-0.5 size-3.5 shrink-0" /><span>{job.failure}</span></p>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 self-center">
                {/* A job from before these were kept counts them from its outcomes. */}
                {savedTo ? <ClippedChip icon={FolderPlus} className="text-foreground">{t.rich("savedTo", { count: job.saved ?? counts.included, name: savedTo, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</ClippedChip> : null}
                {pruned ? <ClippedChip icon={FolderMinus} className="text-foreground">{t.rich("removedFrom", { count: job.removed ?? counts.excluded + counts.failed, name: pruned, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</ClippedChip> : null}
                {libraryDest ? <ClippedChip icon={FolderPlus} className="text-foreground">{t.rich("savedToLibrary", { count: job.libraryAdded ?? 0, name: libraryDest.name, library: libraryDest.library, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</ClippedChip> : null}
                {libraryDest && job.libraryMissing ? <Chip icon={TriangleAlert}>{t.rich("notInLibrary", { count: job.libraryMissing, library: libraryDest.library, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</Chip> : null}
                {libraryDest && job.libraryWriteProblem ? <ClippedChip icon={CircleX} className="text-destructive">{t(`libraryProblem.${job.libraryWriteProblem}`, { name: libraryDest.name, library: libraryDest.library })}</ClippedChip> : null}
                {pruned && job.libraryPruneProblem ? <ClippedChip icon={CircleX} className="text-destructive">{t(`pruneProblem.${job.libraryPruneProblem.problem}`, { name: pruned, library: job.libraryPruneProblem.library })}</ClippedChip> : null}
                {!savedTo && !pruned && !libraryDest ? <Chip icon={Ban} className="h-auto min-h-6 shrink whitespace-normal py-1">{t("noCollectionChanged")}</Chip> : null}
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
          )}
          {active && (savedTo || pruned || libraryDest) ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-4">
              {savedTo ? <ClippedChip icon={FolderPlus}>{t("savesTo", { name: savedTo })}</ClippedChip> : null}
              {libraryDest ? <ClippedChip icon={FolderPlus}>{t("savesToLibrary", { name: libraryDest.name, library: libraryDest.library })}</ClippedChip> : null}
              {pruned ? <ClippedChip icon={FolderMinus}>{t("removesFrom", { name: pruned })}</ClippedChip> : null}
            </div>
          ) : null}
        </div>
      </Zone>

      <Zone label={t("questions")} aside={<span className="text-xs text-muted-foreground">{t("includedAt", { minimum, max })}</span>}>
        {/* The list is the container its rows measure: a row's bar and counts sit beside the question only where the list is wide enough to leave the question room. */}
        <div className={cn(LIST, "@container")}>
          {questions.map((q, i) => {
            const kept = job.tallies?.find((tally) => tally.key === q.key);
            const tally: Record<Answer, number> = { yes: kept?.yes ?? 0, no: kept?.no ?? 0, unclear: kept?.unclear ?? 0 };
            const answered = tally.yes + tally.no + tally.unclear;
            return (
              <div key={q.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums">{i + 1}</span>
                <p className="min-w-0 flex-1 text-sm">{q.text}{q.required ? <RequiredMark /> : null}</p>
                <div className="flex w-full items-center gap-4 @2xl:w-auto">
                  <div className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10 @2xl:w-40 @2xl:flex-none">
                    {(["yes", "unclear", "no"] as const).map((a) => (
                      <span key={a} className={cn("h-full transition-[width] duration-500 motion-reduce:transition-none", a === "yes" ? "bg-success" : a === "unclear" ? "bg-warning" : "bg-muted-foreground/35")} style={{ width: `${answered ? (tally[a] / answered) * 100 : 0}%` }} />
                    ))}
                  </div>
                  {/* Three columns, each wide enough for the job's every paper, so no count reaches the bar and the counts line up from question to question. */}
                  <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
                    {(["yes", "unclear", "no"] as const).map((a) => {
                      const { icon: Icon } = ANSWER[a];
                      return (
                        <span key={a} className="inline-flex items-center justify-end gap-1" style={{ width: `calc(${String(total).length}ch + 1rem)` }} aria-label={t("tally", { count: tally[a], answer: t(`answer.${a}`) })}>
                          <Icon aria-hidden className={cn("size-3 shrink-0", a === "yes" ? "text-success" : a === "unclear" ? "text-warning" : "text-muted-foreground")} />
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
  const workspaceId = useWorkspace();
  const t = useTranslations("screeningPage");
  const toast = useAppToast();
  const [tab, setTab] = useState<Outcome>("included");
  const [query, setQuery] = useState("");
  const text = useDebouncedValue(query.trim(), 300);
  const [open, setOpen] = useState<string | null>(null);
  // The paper whose answers were just changed stays in the list, even once its outcome is
  // another's, until something else is touched: another paper, an outcome, a page, the search.
  const [held, setHeld] = useState<Held | null>(null);
  // Its included papers its library collection didn't take, the library holding no record of them, on their own.
  const missing = job.libraryDestination ? (job.libraryMissing ?? 0) : 0;
  const [notInLibrary, setNotInLibrary] = useState(false);
  const onlyMissing = notInLibrary && tab === "included" && missing > 0;
  const list = useCursorPage(api.screening.papers.list, inWorkspace(workspaceId, { jobId: job._id, outcome: tab, ...(text ? { text } : {}), ...(onlyMissing ? { notInLibrary: true } : {}) }), PAGE_SIZE);
  // The held paper as it stands now, read on its own: its outcome's list no longer holds it.
  const { data: current } = useProtectedQuery(api.screening.papers.get, inWorkspace(workspaceId, held ? { jobId: job._id, paperId: held.paper.paper } : "skip"));
  const answer = useWorkspaceMutation(api.screening.papers.answer);

  // The list the papers on screen belong to: it moves on to the one asked for once its papers have arrived.
  const asked = `${tab}\n${text}\n${list.page}\n${onlyMissing}`;
  const [shownList, setShownList] = useState(list.isLoading ? "" : asked);
  if (!list.isLoading && !list.isStale && shownList !== asked) setShownList(asked);
  // What it was asked with, which an empty list's message names until the next one arrives.
  const [shownTab, shownText] = (shownList || asked).split("\n") as [Outcome, string];

  const heldPaper = held ? (current ?? held.paper) : undefined;
  const rows =
    held && heldPaper && !list.items.some((paper) => paper.paper === heldPaper.paper)
      ? // Added to the page's own papers, so the one that took its place isn't hidden and the next page starts after it.
        [...list.items.slice(0, held.index), heldPaper, ...list.items.slice(held.index)]
      : list.items.map((paper) => (heldPaper && paper.paper === heldPaper.paper ? heldPaper : paper));
  // A search's matches aren't counted on the server, so its pager shows the page alone.
  const count = onlyMissing ? missing : job.outcomes[tab];
  const pageCount = text ? undefined : Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasPages = list.isLoading ? !text && count > PAGE_SIZE : list.hasPages;

  const change = (paper: Paper, index: number, questionKey: string, value: Answer | null) => {
    // Shown at once on the held paper; the server's version replaces it when it arrives.
    const answers = paper.answers.map((a) => (a.key === questionKey && value !== null ? { ...a, answer: valueOf(value), changed: true } : a));
    setHeld({ paper: { ...paper, answers }, index });
    answer({ jobId: job._id, paperId: paper.paper, questionKey, answer: value === null ? "model" : valueOf(value) }).catch((error) => {
      setHeld(null);
      toast.error(t("answerFailed"), getErrorMessage(error, t("answerFailed")));
    });
  };

  return (
    <Zone
      label={t("papers")}
      aside={
        <div className="flex items-center gap-2">
          {missing && job.libraryDestination ? (
            <Button
              size="sm"
              variant={onlyMissing ? "secondary" : "ghost"}
              aria-pressed={onlyMissing}
              className="h-8 rounded-full"
              onClick={() => {
                setHeld(null);
                setNotInLibrary(!onlyMissing);
                setTab("included");
              }}
            >
              <TriangleAlert className="size-3.5" />
              {t("notInLibraryFilter", { library: job.libraryDestination.library })}
            </Button>
          ) : null}
          <div className="relative w-56">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => { setHeld(null); setQuery(e.target.value); }} placeholder={t("findPaper")} aria-label={t("findPaper")} className="h-8 rounded-full ps-8 text-sm" />
          </div>
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
          // One list per outcome, search and page, mounted when its papers arrive, so it fades in once. While the
          // next ones load, the papers shown stay and dim: keyed on the list asked for instead, the stale papers
          // faded in again first, then the arrived ones did.
          key={shownList}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: list.isStale ? 0.6 : 1, y: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          className={cn(LIST, "mt-3", list.isStale && "pointer-events-none", list.isLoading && "invisible")}
        >
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {done === 0 ? t("papersShowHere") : shownText ? t("noPaperMatches") : t(`noPapers.${shownTab}`)}
            </p>
          ) : (
            <AnimatePresence initial={false}>
              {rows.map((paper, index) => {
                const expanded = open === paper.paper;
                // Held here after a change that gave it another outcome: it leaves towards that outcome's tab.
                const leaving = paper.paper === held?.paper.paper && paper.outcome !== tab;
                const towards = OUTCOMES.indexOf(paper.outcome) > OUTCOMES.indexOf(tab) ? 1 : -1;
                const authors = paper.authors ?? [];
                return (
                  <motion.div
                    key={paper.paper}
                    layout="position"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={leaving ? { opacity: 0, height: 0, x: towards * 48 } : { opacity: 0, height: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className="overflow-hidden"
                  >
                    {/* The whole row opens the paper's answers, from a button under it; its title, above that button, opens the paper in focus mode. */}
                    {/* What else the row shows lets clicks through to that button, whatever it draws on its own layer. */}
                    <div className="relative flex w-full items-center gap-4 px-4 py-3 transition-colors hover:bg-muted [&>:not(button)]:pointer-events-none">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={t(expanded ? "hideAnswers" : "showAnswers", { title: paper.title })}
                        onClick={() => { if (paper.paper !== held?.paper.paper) setHeld(null); setOpen(expanded ? null : paper.paper); }}
                        className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                      />
                      <div className={cn("min-w-0 flex-1 transition-opacity duration-300", leaving && "opacity-50")}>
                        <PaperTitle title={paper.title} onOpen={() => openListFocus(index)} className="truncate leading-5" />
                        <p className="truncate text-xs text-muted-foreground">
                          {[authors.length > 2 ? t("andOthers", { authors: authors.slice(0, 2).join(", ") }) : authors.join(", ") || paper.authorsUnparsed, paper.publicationYear].filter(Boolean).join(", ")}
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
                    </div>
                    <AnimatePresence initial={false}>
                      {expanded ? (
                        <motion.div key="detail" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
                          <PaperDetail paper={paper} questions={questions} max={max} minimum={minimum} onAnswer={job.guest ? undefined : (key, value) => change(paper, index, key, value)} />
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
      {/* Focus mode steps through the papers this page of the outcome lists. */}
      <ListFocus papers={rows} />
    </Zone>
  );
}

/**
 * Why a paper landed where it did, then the text to check it against: its score against
 * the score that includes it, each question's answer on one line with what it added, and
 * the abstract underneath.
 */
function PaperDetail({ paper, questions, max, minimum, onAnswer }: { paper: Paper; questions: Question[]; max: number; minimum: number; onAnswer?: (questionKey: string, answer: Answer | null) => void }) {
  const t = useTranslations("screeningPage");
  const score = paper.score ?? 0;
  const { icon: OutcomeIcon, text, bar } = OUTCOME[paper.outcome];
  return (
    <div className="space-y-4 bg-inset px-4 pb-5 pt-2">
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
              <p className="text-sm">{q.text}{q.required ? <RequiredMark /> : null}</p>
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
                        // Without `onAnswer` the answers are read, not changed: someone the screening is shared with.
                        disabled={paper.outcome === "failed" || !onAnswer}
                        onClick={() => onAnswer?.(q.key, option)}
                        className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors disabled:pointer-events-none", on ? className : "text-muted-foreground hover:bg-muted")}
                      >
                        <Icon className="size-3.5" />{t(`answer.${option}`)}
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-end">
                  {given?.changed ? (
                    onAnswer ? (
                      <TooltipHint label={t("putBack")}>
                        <Button variant="ghost" size="icon" className="size-7" aria-label={t("putBack")} onClick={() => onAnswer(q.key, null)}><Undo2 /></Button>
                      </TooltipHint>
                    ) : null
                  ) : given?.confidence !== undefined ? (
                    <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground" aria-label={t("confidence", { percent: Math.round(given.confidence * 100) })}>
                      <Meter value={given.confidence} max={1} className="w-10" fill={a === "unclear" ? "bg-warning" : "bg-primary"} />
                      {Math.round(given.confidence * 100)}%
                    </span>
                  ) : null}
                </div>
              </div>
              <span className={cn("col-start-3 row-start-1 text-end text-xs font-semibold tabular-nums md:col-start-auto md:row-start-auto", earned)} aria-label={t("points", { points })}>
                +{points}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="space-y-1.5">
        {paper.venue ? <p className="text-xs text-muted-foreground">{paper.venue}</p> : null}
        {paper.abstract ? <p className="text-sm leading-relaxed text-foreground/80 lg:columns-2 lg:gap-8">{plainAbstract(paper.abstract)}</p> : null}
      </div>
    </div>
  );
}
