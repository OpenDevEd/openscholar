"use client";

import { useRef, useState, type ReactNode } from "react";
import { useAction } from "convex/react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Ban, Check, CircleCheck, CircleHelp, Coins, Folder, FolderMinus, FolderPlus, Gauge, Hourglass, ListChecks, Loader2, Minus, Plus, Sparkles, Star, Trash2, TriangleAlert, X, Zap, type LucideIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_SCREENING_PAPERS_PER_JOB as JOB_LIMIT } from "@/convex/lib/queryBounds";
import { estimateScreening } from "@/convex/screening/estimate";
import { Button } from "@/components/ui/button";
import { FilterChips } from "@/components/ui/filter-display";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { ModelPicker } from "@/components/models/model-picker";
import { EASE, NodeCard } from "@/components/settings/model-map";
import { Enter, LIST, Segmented, Zone } from "@/components/settings/parts";
import { PageStepper } from "@/components/shared/page-stepper";
import { useGenerateScreeningQuestions } from "@/lib/ai/client/router";
import { useModelPicks } from "@/lib/ai/use-model-picks";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { ITEMS_PER_PAGE } from "@/lib/constants";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { useResearchStatus } from "@/lib/research/provider";
import { useWatchedSearch } from "@/lib/research/reads";
import { useSearchList } from "@/lib/research/search-list";
import { ANSWERS, defaultStars, maxScore, questionsOf, scoringOf, type Job, type JobRow, type PaperSet, type Question } from "@/lib/screening/setup";
import { useSearchHistoryStore } from "@/lib/store";
import { getErrorMessage, useAppToast } from "@/lib/toast";
import type { SearchResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { jobName } from "./job-view";
import { ANSWER, AnimatedNumber, Chip, Meter, SOURCE_ICON } from "./parts";

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

type Kind = PaperSet["kind"];
const KINDS: Kind[] = ["search", "collection", "saved", "screening"];
/** Sets one page of a kind's list holds, and a row's height with the line under it. */
const SOURCE_PAGE = 5;
const SOURCE_ROW = 57;
/** Collections one page of the destinations holds. */
const DESTINATION_PAGE = 4;

/** A place papers come from: what a job reads, its name, and how many papers it has. */
type Source =
  | { kind: "search"; id: string; label: string; count: number; search: SearchResult }
  | { kind: "collection"; id: Id<"collections">; label: string; count: number }
  | { kind: "saved"; id: "saved"; label: string; count: number }
  | { kind: "screening"; id: Id<"screeningJobs">; label: string; count: number };

const setOf = (source: Source): PaperSet =>
  source.kind === "search" ? { kind: "search", searchId: source.id } : source.kind === "collection" ? { kind: "collection", collectionId: source.id } : source.kind === "saved" ? { kind: "saved" } : { kind: "screening", jobId: source.id };
const searchSource = (search: SearchResult): Source => ({ kind: "search", id: search.id, label: search.query, count: search.count, search });

export function SetupView({
  fromSearchId,
  again,
  waitingFor,
  onStarted,
}: {
  /** The search whose Screen all opened this form, or the one a job to run again read. */
  fromSearchId?: string;
  /** A screening to run again: the form starts on its papers, questions, scoring and destination. */
  again?: Job;
  /** The person's job a new one would start after. */
  waitingFor?: string;
  onStarted: (jobId: Id<"screeningJobs">) => void;
}) {
  const t = useTranslations("screeningPage");
  const format = useFormatter();
  const locale = useLocale();
  const toast = useAppToast();

  // The sets of each kind, a page at a time. Every kind is read up front, so switching between them moves nothing.
  const watched = useWatchedSearch(fromSearchId);
  const from = useSearchHistoryStore((state) => (fromSearchId ? state.searchHistory.find((item) => item.id === fromSearchId) : undefined));
  const searches = useSearchList({ sort: "recent", pageSize: from ? SOURCE_PAGE - 1 : SOURCE_PAGE, excludeId: fromSearchId });
  const collections = useCursorPage(api.library.collections.listCollections, {}, SOURCE_PAGE);
  const { data: collectionCount } = useProtectedQuery(api.library.collections.countCollections, {});
  const { data: savedCount } = useProtectedQuery(api.library.queries.getLibraryCount, {});
  const screenings = useCursorPage(api.screening.queries.listUserScreeningJobs, { status: "completed" as const }, SOURCE_PAGE);
  const date = (at: number) => format.dateTime(new Date(at), { dateStyle: "medium" });
  const lists: Record<Kind, { rows: Source[]; pager?: Pick<typeof collections, "page" | "canPrevious" | "canNext" | "previous" | "next" | "hasPages" | "isStale"> & { pageCount?: number } }> = {
    // Opened from a results page, its search leads every page of the list.
    search: { rows: [...(from ? [searchSource(from)] : []), ...searches.items.map(searchSource)], pager: searches },
    collection: {
      rows: collections.items.map((c) => ({ kind: "collection", id: c._id, label: c.name, count: c.itemCount })),
      pager: { ...collections, pageCount: collectionCount === undefined ? undefined : Math.max(1, Math.ceil(collectionCount / SOURCE_PAGE)) },
    },
    saved: { rows: [{ kind: "saved", id: "saved", label: t("allSavedPapers"), count: savedCount ?? 0 }] },
    screening: { rows: screenings.items.map((job: JobRow) => ({ kind: "screening", id: job._id, label: jobName(t, job, date), count: job.qualifiedPapers })), pager: screenings },
  };

  const [kind, setKind] = useState<Kind>(again?.set?.kind ?? "search");
  // The set picked stays picked whatever page its list shows; until one is, a job run again starts on its own set, and otherwise the first listed.
  const [picked, setPicked] = useState<Source | null>(null);
  const againId = again?.set && (again.set.kind === "search" ? again.set.searchId : again.set.kind === "collection" ? again.set.collectionId : again.set.kind === "screening" ? again.set.jobId : "saved");
  const source = picked?.kind === kind ? (lists[kind].rows.find((row) => row.id === picked.id) ?? picked) : (lists[kind].rows.find((row) => row.id === againId) ?? lists[kind].rows[0]);
  // Opened from a results page, it starts on the page the person was reading; run again, on the job's own papers.
  const [scope, setScope] = useState<"all" | "page" | "range">(again?.first ? "range" : fromSearchId && !again ? "page" : again?.set && again.set.kind !== "search" ? "all" : "range");
  const [range, setRange] = useState<[number, number]>(again?.first && again.last ? [again.first, again.through ?? again.last] : [1, 300]);
  // Untouched, the questions are the selected search's own: the ones its results page screens with.
  const [edited, setEdited] = useState<Question[] | null>(again ? questionsOf(again) : null);
  const own: Question[] = source?.kind === "search" ? source.search.screeningQuestions.map((q, i) => ({ key: `own${i}`, text: q.question, yes: 1, no: 0, unclear: 0 })) : [];
  const questions = edited ?? own;
  // From the questions as they stand when the change lands: one that waits on the model mustn't undo edits made meanwhile.
  const setQuestions = (change: (questions: Question[]) => Question[]) => setEdited((current) => change(current ?? own));
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  // Counts the sets picked, so questions written for one don't land on another.
  const picks = useRef(0);
  const [minScore, setMinScore] = useState(again?.scoringConfig.minimumScore ?? 2);
  // The scores where 1 to 5 stars begin; untouched, they spread across the highest score.
  const [starsSet, setStars] = useState<number[] | null>(again?.scoringConfig.starThresholds.length === 5 ? [...again.scoringConfig.starThresholds].sort((a, b) => a.stars - b.stars).map((threshold) => threshold.minScore) : null);
  // A job run again keeps its destination while that collection exists.
  const [dest, setDest] = useState<"none" | "new" | Id<"collections">>(again?.unsaved ? "none" : again?.targetCollectionId && again.targetCollectionName ? again.targetCollectionId : "new");
  const [newName, setNewName] = useState<string | null>(null);
  const [prune, setPrune] = useState(again?.prune ?? false);
  const [busy, setBusy] = useState(false);

  // A range can reach the last paper: past a job's limit it runs as several jobs, as all of them does.
  const top = source?.count ?? 0;
  const page = source?.kind === "search" ? (source.search.page ?? 1) : 1;
  const [first, last] =
    scope === "all" ? [1, top] : scope === "page" && source?.kind === "search" ? [(page - 1) * ITEMS_PER_PAGE + 1, Math.min(page * ITEMS_PER_PAGE, top)] : [Math.min(range[0], top), Math.min(range[1], top)];
  const papers = top ? last - first + 1 : 0;
  const jobs = Math.ceil(papers / JOB_LIMIT);
  const max = maxScore(questions);
  // With no question there's nothing to score: Keep and Stars wait, at the size they'll have.
  const unscored = questions.length === 0;
  const questionInput = useRef<HTMLInputElement>(null);
  // Removing questions can drop the highest score under the threshold; it reads as the top score then.
  const threshold = Math.min(minScore, max);
  const stars = (starsSet ?? defaultStars(max)).map((value) => Math.min(value, max));
  /** Sets where `index + 1` stars begin, pushing the other thresholds so they stay in order. */
  const setStar = (index: number, value: number) => {
    const v = Math.min(max, Math.max(0, Math.round(value) || 0));
    setStars(stars.map((s, i) => (i === index ? v : i > index ? Math.max(s, v) : Math.min(s, v))));
  };

  // An earlier screening's questions to reuse, with their points. A search needs none: its questions load with it.
  const { data: earlier } = useProtectedQuery(api.screening.queries.getScreeningJob, source?.kind === "screening" ? { jobId: source.id } : "skip");
  const fresh = earlier ? questionsOf(earlier).filter((q) => !questions.some((x) => x.text.toLowerCase() === q.text.toLowerCase())) : [];
  const defaultName = !source ? "" : source.kind === "screening" ? source.label : t("includedIn", { name: source.label });

  const destinations = useCursorPage(api.library.collections.listCollections, {}, DESTINATION_PAGE);
  // A collection can't be its own destination; picking it as the source moves the pick to a new one.
  const target = source?.kind === "collection" && dest === source.id ? "new" : dest;

  const models = useModelPicks();
  const model = models.modelOf("screenAll");
  const { data: account } = useProtectedQuery(api.billing.accounts.mine, {});
  const { data: slots } = useProtectedQuery(api.screening.queries.slots, {});
  const balance = account?.balance ?? 0;
  const credits = estimateScreening(papers, balance).credits;
  const enough = credits <= balance;
  // The server reads the saved search, so edits still being saved would be screened without.
  const { pending: savingEdits } = useResearchStatus();
  const screen = useAction(api.screening.start.screen);
  const { execute: generateQuestions, isConfigured: canGenerate } = useGenerateScreeningQuestions();

  /** Picks a set; a search brings its own screening questions, and each set starts on its own first papers. */
  const choose = (next: Source) => {
    picks.current++;
    setPicked(next);
    setRange([1, Math.min(300, next.count)]);
    setEdited(next.kind === "search" ? null : questions);
  };
  const pick = (next: Kind) => {
    setKind(next);
    const firstOf = lists[next].rows[0];
    if (firstOf) choose(firstOf);
    setScope(next === "search" ? "range" : "all");
  };
  /** Turns the list's page with the set in use held on to, so another page's first set doesn't take its place. */
  const turn = (step: () => void) => () => {
    if (source && picked?.id !== source.id) setPicked(source);
    step();
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
  const generate = async () => {
    if (source?.kind !== "search") return;
    const asked = picks.current;
    setGenerating(true);
    try {
      const result = await generateQuestions({
        researchQuestion: source.search.questionText || source.search.query,
        existingQuestions: questions.map((q) => q.text),
        responseLanguage: localeToLanguageCode(locale),
      });
      if (picks.current === asked) adopt(result.questions.map((text) => ({ key: "", text: text.trim(), yes: 1, no: 0, unclear: 0 })).filter((q) => q.text));
    } catch (error) {
      toast.error(t("generateFailed"), getErrorMessage(error, t("generateFailed")));
    } finally {
      setGenerating(false);
    }
  };
  const points = (key: string, answer: "yes" | "no" | "unclear", value: number) => setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, [answer]: value } : q)));
  const start = async () => {
    if (!source) return;
    setBusy(true);
    try {
      const name = (newName ?? defaultName).trim() || defaultName;
      const { jobId } = await screen({
        set: setOf(source),
        first,
        last,
        ...scoringOf(questions, threshold, stars),
        saveTo: target === "none" ? { kind: "none" } : target === "new" ? { kind: "new", name } : { kind: "collection", collectionId: target },
        ...(source.kind === "collection" && prune ? { prune: true } : {}),
      });
      onStarted(jobId);
    } catch (error) {
      toast.error(t("startFailed"), getErrorMessage(error, t("startFailed")));
      setBusy(false);
    }
  };

  const list = lists[kind];
  // Laid out once everything it sizes itself from has arrived, so nothing grows after it shows.
  const ready = !searches.isLoading && !collections.isLoading && !screenings.isLoading && !destinations.isLoading && savedCount !== undefined && account !== undefined && slots !== undefined && (!fromSearchId || from !== undefined || watched === "missing" || watched === "failed");

  return (
    <Enter ready={ready}>
      <div className="space-y-8 pb-24">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{t("newScreening")}</h2>
          <p className="text-sm text-muted-foreground">{t("newScreeningHint")}</p>
        </div>

        <Zone label={t("papers")}>
          <Segmented label={t("sourceKind")} value={kind} onChange={pick} fill options={KINDS.map((id) => ({ id, label: t(`kind.${id}`), icon: SOURCE_ICON[id] }))} />
          {/* While a kind has pages its list keeps a full page's height, so the pager stays put on a short last page. */}
          <div className="mt-3" style={list.pager?.hasPages ? { minHeight: SOURCE_PAGE * SOURCE_ROW + 1 } : undefined}>
            {list.rows.length === 0 ? (
              <p className={cn(LIST, "px-4 py-8 text-center text-sm text-muted-foreground")}>{t(`noSets.${kind}`)}</p>
            ) : (
              <div className={cn(LIST, list.pager?.isStale && "pointer-events-none opacity-60")} role="radiogroup" aria-label={t("papersToScreen")}>
                {list.rows.map((s) => {
                  const on = s.id === source?.id;
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
                          {s.kind === "search" ? (
                            <span className="block min-w-0 overflow-x-auto scrollbar-hover mask-r-from-[calc(100%-2rem)]">
                              <FilterChips filters={{ ...s.search, field: undefined, sortBy: undefined }} size="compact" singleLine />
                            </span>
                          ) : null}
                        </span>
                        <Chip>{t("paperCount", { count: s.count })}</Chip>
                        <PickMark on={on} />
                      </button>
                      <AnimatePresence initial={false}>
                        {/* Every set is picked from the same way: a range of its papers, or all of them; a search also has the page being read. */}
                        {on ? (
                          <motion.div key="scope" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
                            <div className="space-y-4 pb-4 pl-15 pr-4">
                              <Segmented
                                label={t("whichPapers")}
                                value={scope}
                                onChange={setScope}
                                options={[
                                  { id: "range" as const, label: t("scope.range") },
                                  ...(s.kind === "search" ? [{ id: "page" as const, label: t("scope.page") }] : []),
                                  { id: "all" as const, label: s.kind === "search" ? t("scope.allResults") : t("scope.allPapers") },
                                ]}
                              />
                              {scope === "range" ? (
                                <div className="space-y-3">
                                  <Slider min={1} max={Math.max(1, top)} step={1} value={[first, last]} onValueChange={(v) => setRange([v[0]!, v[1]!])} aria-label={t("papersToScreen")} />
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    {/* Typeable ends: over thousands of results a drag can't land on one paper. */}
                                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                      {t("rangeFrom")}
                                      <Input
                                        type="number"
                                        min={1}
                                        max={last}
                                        value={first}
                                        onChange={(e) => setRange([Math.min(last, Math.max(1, Math.round(Number(e.target.value)) || 1)), last])}
                                        onFocus={(e) => e.target.select()}
                                        aria-label={t("firstPaper")}
                                        className="h-7 w-20 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                                      />
                                      {t("rangeTo")}
                                      <Input
                                        type="number"
                                        min={first}
                                        max={top}
                                        value={last}
                                        onChange={(e) => setRange([first, Math.min(top, Math.max(first, Math.round(Number(e.target.value)) || first))])}
                                        onFocus={(e) => e.target.select()}
                                        aria-label={t("lastPaper")}
                                        className="h-7 w-20 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                                      />
                                      {t("rangeOf", { total: top })}
                                    </span>
                                    {jobs > 1 ? (
                                      <span className="flex flex-wrap items-center gap-1.5">
                                        <Chip icon={Zap} className="text-foreground"><span>{t.rich("jobsInTurn", { count: jobs, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</span></Chip>
                                        <Chip icon={Check}>{t("oneApproval")}</Chip>
                                      </span>
                                    ) : (
                                      <Chip>{t("upToPerJob", { limit: JOB_LIMIT })}</Chip>
                                    )}
                                  </div>
                                </div>
                              ) : scope === "all" && jobs > 1 ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Chip icon={Zap} className="text-foreground"><span>{t.rich("jobsInTurn", { count: jobs, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</span></Chip>
                                  <Chip>{t("upToEach", { limit: JOB_LIMIT })}</Chip>
                                  <Chip icon={Check}>{t("oneApproval")}</Chip>
                                </div>
                              ) : scope === "all" ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Chip className="text-foreground"><span>{t.rich("papersBold", { count: papers, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</span></Chip>
                                  <Chip>{t("oneJob")}</Chip>
                                </div>
                              ) : (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Chip className="text-foreground"><span>{t.rich("papersBold", { count: papers, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</span></Chip>
                                  <Chip>{t("resultsPage", { page })}</Chip>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {list.pager?.hasPages ? (
            <PageStepper className="pt-3" page={list.pager.page} pageCount={list.pager.pageCount} canPrevious={list.pager.canPrevious} canNext={list.pager.canNext} onPrevious={turn(list.pager.previous)} onNext={turn(list.pager.next)} />
          ) : null}
        </Zone>

        <Zone
          label={t("questions")}
          aside={
            // What the papers come from decides the shortcuts: a search's questions are its own (one
            // screening per search) and it can write more from its research question; an earlier
            // screening has questions to reuse.
            <span className="flex items-center gap-1">
              {source?.kind === "search" ? <Chip icon={ListChecks}>{t("sharedWithResults")}</Chip> : null}
              {source?.kind === "screening" ? (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => adopt(fresh)} disabled={!fresh.length}>
                  <ListChecks className="text-primary" />
                  {fresh.length || !earlier ? t("importQuestions", { count: fresh.length, name: source.label }) : t("importedFrom", { name: source.label })}
                </Button>
              ) : null}
              {kind === "search" ? (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={generate} disabled={generating || !canGenerate || !source}>
                  {generating ? <Loader2 className="animate-spin text-primary" /> : <Sparkles className="text-primary" />}{t("generate")}
                </Button>
              ) : null}
            </span>
          }
        >
          <div className={LIST}>
            <div className="grid grid-cols-[1.5rem_1fr_repeat(3,4rem)_2rem] items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
              <span />
              <span>{t("question")}</span>
              {ANSWERS.map((a) => {
                const { icon: Icon } = ANSWER[a];
                return <span key={a} className="flex items-center justify-center gap-1"><Icon className={cn("size-3", TINT[a].icon)} />{t(`answer.${a}`)}</span>;
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
                    {ANSWERS.map((a) => (
                      <Input key={a} type="number" value={q[a]} onChange={(e) => points(q.key, a, Number(e.target.value))} aria-label={t("pointsFor", { answer: t(`answer.${a}`), number: i + 1 })} className={cn("h-8 border-transparent px-1 text-center text-sm font-medium tabular-nums shadow-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none", TINT[a].input)} />
                    ))}
                    <TooltipHint label={t("removeQuestion")}>
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={t("removeQuestion")} onClick={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}><Trash2 /></Button>
                    </TooltipHint>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div className="flex items-center gap-2 px-4 py-2.5">
              <Input ref={questionInput} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addQuestion()} placeholder={t("addQuestionPlaceholder")} className="h-9 flex-1" />
              <Button variant="outline" size="sm" className="h-9" onClick={addQuestion} disabled={!draft.trim()}><Plus />{t("add")}</Button>
            </div>
          </div>
        </Zone>

        <Zone label={t("keep")}>
          <div className={cn("space-y-3 rounded-2xl border p-4 transition-colors duration-300", unscored ? "border-dashed border-border" : "border-border/60 bg-muted/40")}>
            <div className="flex items-center gap-3">
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-300", unscored ? "bg-muted text-muted-foreground/60" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")}>
                <CircleCheck className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-semibold", unscored && "text-muted-foreground")}>{unscored ? t("nothingToScore") : t("includedFrom")}</span>
                <span className="block text-xs text-muted-foreground">{unscored ? t("pointsDecide") : t("pointsAddUp")}</span>
              </span>
              {unscored ? (
                <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => questionInput.current?.focus()}><Plus />{t("addAQuestion")}</Button>
              ) : (
                <span className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="size-8" aria-label={t("onePointFewer")} disabled={threshold <= 0} onClick={() => setMinScore(threshold - 1)}><Minus /></Button>
                  <Input
                    type="number"
                    min={0}
                    max={max}
                    value={threshold}
                    onChange={(e) => setMinScore(Math.min(max, Math.max(0, Math.round(Number(e.target.value)) || 0)))}
                    onFocus={(e) => e.target.select()}
                    aria-label={t("pointsToBeIncluded")}
                    className="h-8 w-12 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <Button variant="ghost" size="icon" className="size-8" aria-label={t("onePointMore")} disabled={threshold >= max} onClick={() => setMinScore(threshold + 1)}><Plus /></Button>
                  <span className="w-16 whitespace-nowrap text-sm tabular-nums text-muted-foreground">{t("ofPoints", { max })}</span>
                </span>
              )}
            </div>
            {/* One track from 0 to the highest score, however many questions there are: grey below the threshold, green from it. */}
            <div className="space-y-2 pt-1">
              {unscored ? <EmptyTrack /> : (
                <Slider
                  min={0}
                  max={Math.max(1, max)}
                  step={1}
                  value={[threshold]}
                  onValueChange={(v) => setMinScore(v[0]!)}
                  aria-label={t("lowestIncluded")}
                  className="[&_[data-slot=slider-range]]:bg-muted [&_[data-slot=slider-thumb]]:border-emerald-500 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-emerald-500/70"
                />
              )}
            </div>
          </div>
        </Zone>

        <Zone label={t("stars")}>
          <div className={cn("space-y-4 rounded-2xl border p-4 transition-colors duration-300", unscored ? "border-dashed border-border" : "border-border/60 bg-muted/40")}>
            <div className="flex items-center gap-3">
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-300", unscored ? "bg-muted text-muted-foreground/60" : "bg-primary/15 text-primary")}>
                <Star className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-semibold", unscored && "text-muted-foreground")}>{unscored ? t("noRatings") : t("rating")}</span>
                <span className="block text-xs text-muted-foreground">{unscored ? t("starsFromPoints") : t("starsForScore")}</span>
              </span>
              {unscored ? null : <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">{t("ofPoints", { max })}</span>}
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
                aria-label={t("whereStarsBegin")}
                className="[&_[data-slot=slider-range]]:bg-primary/60 [&_[data-slot=slider-track]]:h-2"
              />
            )}
            <div className="grid grid-cols-5 gap-2">
              {stars.map((value, i) => (
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
                    value={unscored ? "" : value}
                    onChange={(e) => setStar(i, Number(e.target.value))}
                    onFocus={(e) => e.target.select()}
                    aria-label={t("pointsForStars", { count: i + 1 })}
                    className="h-7 w-12 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </label>
              ))}
            </div>
          </div>
        </Zone>

        {model ? (
          <Zone label={t("model")}>
            <ModelPicker align="start" tasks={["screenAll"]} current={model} onChange={(m, effort) => models.pickAll(["screenAll"], m, effort)} trigger={<NodeCard interactive paidBy="credits" model={model} />} />
          </Zone>
        ) : null}

        <Zone label={t("collections")}>
          {source?.kind === "collection" ? (
            <label className="mb-3 flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-border/60 px-4 py-2.5">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60", prune ? "text-primary" : "text-muted-foreground")}>
                <FolderMinus className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t("pruneFrom", { name: source.label })}</span>
                <span className="mt-1.5 flex flex-wrap gap-1">
                  <Chip icon={X}>{t("excludedLeave")}</Chip>
                  <Chip icon={TriangleAlert}>{t("failedLeave")}</Chip>
                  <Chip icon={CircleHelp}>{t("unclearStay")}</Chip>
                </span>
              </span>
              <Switch checked={prune} onCheckedChange={setPrune} aria-label={t("pruneFrom", { name: source.label })} />
            </label>
          ) : null}
          <div style={destinations.hasPages ? { minHeight: (DESTINATION_PAGE + 2) * SOURCE_ROW + 1 } : undefined}>
            <div className={cn(LIST, destinations.isStale && "pointer-events-none opacity-60")} role="radiogroup" aria-label={t("saveIncludedTo")}>
              <DestinationRow on={target === "none"} onPick={() => setDest("none")} icon={Ban} name={t("dontSave")} />
              <DestinationRow on={target === "new"} onPick={() => setDest("new")} icon={FolderPlus} facts={<Chip>{t("new")}</Chip>}>
                <Input
                  value={newName ?? defaultName}
                  onChange={(e) => setNewName(e.target.value)}
                  onFocus={() => setDest("new")}
                  aria-label={t("newCollectionName")}
                  placeholder={t("nameNewCollection")}
                  className="h-8 flex-1"
                />
              </DestinationRow>
              {destinations.items
                .filter((c) => source?.kind !== "collection" || c._id !== source.id)
                .map((c) => (
                  <DestinationRow key={c._id} on={target === c._id} onPick={() => setDest(c._id)} icon={Folder} name={t("addTo", { name: c.name })} facts={<Chip>{t("paperCount", { count: c.itemCount })}</Chip>} />
                ))}
            </div>
          </div>
          {destinations.hasPages ? (
            <PageStepper
              className="pt-3"
              page={destinations.page}
              pageCount={collectionCount === undefined ? undefined : Math.max(1, Math.ceil(collectionCount / DESTINATION_PAGE))}
              canPrevious={destinations.canPrevious}
              canNext={destinations.canNext}
              onPrevious={destinations.previous}
              onNext={destinations.next}
            />
          ) : null}
        </Zone>

        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-4 rounded-2xl border border-border/60 bg-background p-4 shadow-lg">
          <div className="min-w-48 flex-1 space-y-1.5">
            <p className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium"><Coins className="size-3.5 text-primary" /><span>{t.rich("upToCredits", { n: () => <AnimatedNumber value={credits} /> })}</span></span>
              <span className={cn("tabular-nums transition-colors", enough ? "text-muted-foreground" : "text-destructive")}>
                {t.rich("balanceLeft", { balance: Math.floor(balance), n: () => <AnimatedNumber value={Math.max(0, Math.floor(balance) - credits)} /> })}
              </span>
            </p>
            <Meter value={Math.min(credits, balance)} max={balance} fill={enough ? "bg-primary" : "bg-destructive"} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {slots ? <Chip icon={Gauge}>{t("atATime", { limit: slots.limit })}</Chip> : null}
            {waitingFor ? (
              <Chip icon={Hourglass} className="max-w-56">
                <TooltipHint label={t("after", { name: waitingFor })} onlyWhenClipped>
                  <span className="truncate">{t("after", { name: waitingFor })}</span>
                </TooltipHint>
              </Chip>
            ) : null}
          </div>
          {/* A search's papers can cost less than the estimate: its page's answers are reused and its rating filter drops papers. The server checks what's left. */}
          <Button disabled={busy || unscored || (!enough && source?.kind !== "search") || papers < 1 || Boolean(savingEdits)} onClick={start}>
            {busy ? t("readingPapers") : t("screenPapers", { count: papers })}
          </Button>
        </div>
      </div>
    </Enter>
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
