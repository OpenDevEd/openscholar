"use client";

import { useRef, useState, type ReactNode } from "react";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { AiIcon, Ban, Camera, CircleCheck, CircleHelp, Folder, FolderMinus, FolderPlus, Gauge, Hourglass, ListChecks, Minus, Plus, Star, Trash2, TriangleAlert, type AppIcon, X } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { FilterChips } from "@/components/ui/filter-display";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { EASE } from "@/components/settings/model-map";
import { Enter, LIST, Segmented, Zone } from "@/components/settings/parts";
import { QueryText } from "@/components/ui/query-text";
import { PageStepper } from "@/components/shared/page-stepper";
import { useGenerateScreeningQuestions } from "@/lib/ai/client/router";
import { useModelPicks } from "@/lib/ai/use-model-picks";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { ITEMS_PER_PAGE } from "@/lib/constants";
import { OQL_FIELD } from "@/lib/openalex/oql";
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
import { ANSWER, Chip, ClippedChip, SOURCE_ICON } from "./parts";
import { PaperScope, PickMark, SourceRow } from "./source-row";
import { LibrarySources, useLibrarySources, useRowLabel } from "./library-sources";
import useSWR from "swr";
import { useAuth } from "@clerk/nextjs";
import { LIBRARY_SOURCE_MAX } from "@/lib/evidence-libraries/source-address";
import { isFrozen, rowKey, screeningQuestionsOf, setOfRow, type HeldRow, type LibraryRow } from "@/lib/evidence-libraries/reader-sources";
import { CreditCheck, useSpendable } from "@/components/workspaces/credit-check";
import { ModelsInUse } from "@/components/models/models-in-use";
import { inWorkspace, useWorkspace, useWorkspaceAction } from "@/lib/workspaces/url";

/** Points boxes take their answer's colour, so a row reads at a glance. */
const TINT = {
  yes: { icon: "text-success", input: "bg-success/10 ink-success" },
  no: { icon: "text-muted-foreground", input: "bg-foreground/[0.05]" },
  unclear: { icon: "text-warning", input: "bg-warning/10 ink-warning" },
} as const;

/** A track with nothing on it yet, the height of the slider that takes its place. */
function EmptyTrack() {
  return <div aria-hidden className="h-2 w-full rounded-full border border-dashed border-foreground/20" />;
}

/** The sets the page offers; a Zotero set is one a chat screens. */
type Kind = Exclude<PaperSet["kind"], "zotero">;
const KINDS: Kind[] = ["search", "collection", "saved", "screening", "evidenceLibrary"];
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
  // `called`: what the server names a screening of its included papers after (`insertJob`).
  | { kind: "screening"; id: Id<"screeningJobs">; label: string; count: number; called?: string }
  // An Evidence Library's records; a search or a list of them is frozen at the start, up to LIBRARY_SOURCE_MAX.
  | { kind: "evidenceLibrary"; id: string; label: string; count: number; held: HeldRow };

const setOf = (source: Source): PaperSet =>
  source.kind === "search" ? { kind: "search", searchId: source.id } : source.kind === "collection" ? { kind: "collection", collectionId: source.id } : source.kind === "saved" ? { kind: "saved" } : source.kind === "evidenceLibrary" ? setOfRow(source.held.row) : { kind: "screening", jobId: source.id };
const searchSource = (search: SearchResult): Source => ({ kind: "search", id: search.id, label: search.query, count: search.count, search });
const librarySource = (held: HeldRow): Source => ({ kind: "evidenceLibrary", id: rowKey(held.row), label: held.row.label, count: isFrozen(held.row) ? Math.min(held.row.records, LIBRARY_SOURCE_MAX) : held.row.records, held });

export function SetupView({
  fromSearchId,
  handoffId,
  again,
  waitingFor,
  onStarted,
}: {
  /** The search whose Screen all opened this form, or the one a job to run again read. */
  fromSearchId?: string;
  /** What an Evidence Library handed over (app/from-library): the form starts on it, with its yes or no questions. */
  handoffId?: string;
  /** A screening to run again: the form starts on its papers, questions, scoring and destination. */
  again?: Job;
  /** The person's job a new one would start after. */
  waitingFor?: string;
  onStarted: (jobId: Id<"screeningJobs">) => void;
}) {
  const workspaceId = useWorkspace();
  const t = useTranslations("screeningPage");
  const tl = useTranslations("librarySources");
  const tf = useTranslations("fromLibrary");
  const labelOf = useRowLabel();
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = useNow();
  const locale = useLocale();
  const toast = useAppToast();

  // The sets of each kind, a page at a time. Every kind is read up front, so switching between them moves nothing.
  const watched = useWatchedSearch(fromSearchId);
  const from = useSearchHistoryStore((state) => (fromSearchId ? state.searchHistory.find((item) => item.id === fromSearchId) : undefined));
  const searches = useSearchList({ sort: "recent", pageSize: from ? SOURCE_PAGE - 1 : SOURCE_PAGE, excludeId: fromSearchId });
  const collections = useCursorPage(api.library.collections.listCollections, inWorkspace(workspaceId, {}), SOURCE_PAGE);
  const { data: collectionCount } = useProtectedQuery(api.library.collections.countCollections, inWorkspace(workspaceId, {}));
  const { data: savedCount } = useProtectedQuery(api.library.queries.getLibraryCount, inWorkspace(workspaceId, {}));
  const screenings = useCursorPage(api.screening.queries.listUserScreeningJobs, inWorkspace(workspaceId, { status: "completed" as const }), SOURCE_PAGE);
  const date = (at: number) => format.dateTime(new Date(at), { dateStyle: "medium" });
  // A library screening run again starts on its source as the library holds it now.
  const againLibrary = again?.set?.kind === "evidenceLibrary" ? again.set : null;
  const describe = useWorkspaceAction(api.evidenceLibraries.library.source);
  const { userId } = useAuth();
  const ranBefore = useSWR(againLibrary && workspaceId && userId ? ["library-source", userId, againLibrary.libraryId, JSON.stringify(againLibrary.source)] : null, () => describe({ libraryId: againLibrary!.libraryId, source: againLibrary!.source }), { revalidateOnFocus: false });
  // A hand-off starts on its source as the person may read it now, and the questions it brought.
  const openHandoff = useWorkspaceAction(api.evidenceLibraries.handoffs.open);
  const handedOver = useSWR(handoffId && workspaceId && userId ? ["library-handoff", userId, handoffId] : null, () => openHandoff({ handoffId: handoffId! }), { revalidateOnFocus: false });
  const handed = handedOver.data && !("gone" in handedOver.data) ? handedOver.data : null;
  const startsOn = againLibrary ? ranBefore.data : handed?.found;
  const startHeld = startsOn && "row" in startsOn ? startsOn : null;
  // A source it ran on, or was handed, that can't be read now is said so, and another is never put in its place.
  const startError = handedOver.error ? tf("problem.unreadable") : handedOver.data && "gone" in handedOver.data ? tf("goneHint") : startsOn && "error" in startsOn ? (handoffId ? tf(`problem.${startsOn.error}`) : tl(`error.${startsOn.error}`)) : null;
  const libraries = useLibrarySources(startHeld ? [startHeld] : []);
  // Until one is picked, the form starts on your first collection in the library shown: a whole library is too many to start on.
  const firstOwn = libraries.library && libraries.contents.find((one) => one.libraryId === libraries.library?.libraryId)?.rows?.find((row) => row.what === "yours" && row.records > 0);
  const lists: Record<Kind, { rows: Source[]; pager?: Pick<typeof collections, "page" | "canPrevious" | "canNext" | "previous" | "next" | "hasPages" | "isStale"> & { pageCount?: number } }> = {
    // Opened from a results page, its search leads every page of the list.
    search: { rows: [...(from ? [searchSource(from)] : []), ...searches.items.map(searchSource)], pager: searches },
    collection: {
      rows: collections.items.map((c) => ({ kind: "collection", id: c._id, label: c.name, count: c.itemCount })),
      pager: { ...collections, pageCount: collectionCount === undefined ? undefined : Math.max(1, Math.ceil(collectionCount / SOURCE_PAGE)) },
    },
    saved: { rows: [{ kind: "saved", id: "saved", label: t("allSavedPapers"), count: savedCount ?? 0 }] },
    screening: { rows: screenings.items.map((job: JobRow) => ({ kind: "screening", id: job._id, label: jobName(t, job, date), count: job.qualifiedPapers, called: job.name ?? job.label })), pager: screenings },
    evidenceLibrary: { rows: againLibrary || handoffId ? (startHeld ? [librarySource(startHeld)] : []) : firstOwn && libraries.library ? [librarySource({ library: libraries.library, row: firstOwn })] : [] },
  };

  // A screening a chat ran on a Zotero collection is run again from its chat: the page starts on a search.
  const [kind, setKind] = useState<Kind>(handoffId ? "evidenceLibrary" : again?.set && again.set.kind !== "zotero" ? again.set.kind : "search");
  // The set picked stays picked whatever page its list shows; until one is, a job run again starts on its own set, and otherwise the first listed.
  const [picked, setPicked] = useState<Source | null>(null);
  const againId = again?.set && (again.set.kind === "search" ? again.set.searchId : again.set.kind === "collection" ? again.set.collectionId : again.set.kind === "screening" ? again.set.jobId : again.set.kind === "evidenceLibrary" ? rowKey(again.set) : "saved");
  const kept = picked?.kind === kind ? (lists[kind].rows.find((row) => row.id === picked.id) ?? picked) : lists[kind].rows.find((row) => row.id === againId);
  // A set with no papers is never the one picked, even one a job ran on that has emptied since.
  const source = kept && kept.count > 0 ? kept : lists[kind].rows.find((row) => row.count > 0);
  // Opened from a results page, it starts on the page the person was reading; run again, on the job's own papers.
  const [scope, setScope] = useState<"all" | "page" | "range">(handoffId ? "all" : again?.first ? "range" : fromSearchId && !again ? "page" : again?.set && again.set.kind !== "search" ? "all" : "range");
  const [range, setRange] = useState<[number, number]>(again?.first && again.last ? [again.first, again.through ?? again.last] : [1, 300]);
  // Untouched, the questions are the selected search's own: the ones its results page screens with.
  const [edited, setEdited] = useState<Question[] | null>(again ? questionsOf(again) : null);
  // A search's are its own; a hand-off's, the yes or no questions it brought.
  const own: Question[] = (source?.kind === "search" ? source.search.screeningQuestions.map((q) => q.question) : handed ? screeningQuestionsOf(handed.fields) : []).map((text, i) => ({ key: `own${i}`, text, yes: 1, no: 0, unclear: 0 }));
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
  // Its own name; left empty, it's named after its papers. Run again, it keeps the one it had.
  const [title, setTitle] = useState(again?.name ?? "");
  const [newName, setNewName] = useState<string | null>(null);
  const [prune, setPrune] = useState(again?.prune ?? false);
  const [busy, setBusy] = useState(false);

  // A range can reach the last paper: one job takes however many.
  const top = source?.count ?? 0;
  const page = source?.kind === "search" ? (source.search.page ?? 1) : 1;
  const [first, last] =
    scope === "all" ? [1, top] : scope === "page" && source?.kind === "search" ? [(page - 1) * ITEMS_PER_PAGE + 1, Math.min(page * ITEMS_PER_PAGE, top)] : [Math.min(range[0], top), Math.min(range[1], top)];
  const papers = top ? last - first + 1 : 0;
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
  const { data: earlier } = useProtectedQuery(api.screening.queries.getScreeningJob, inWorkspace(workspaceId, source?.kind === "screening" ? { jobId: source.id } : "skip"));
  const fresh = earlier ? questionsOf(earlier).filter((q) => !questions.some((x) => x.text.toLowerCase() === q.text.toLowerCase())) : [];
  // What it's called left unnamed: its papers, named from what the server keeps of them, as the rail names a screening.
  const unnamed = !source ? t("newScreening") : source.kind === "evidenceLibrary" ? labelOf(source.held.row) : jobName(t, { createdAt: now.getTime(), set: setOf(source), label: source.kind === "screening" ? source.called : source.label }, date);
  // A search with no query has no name to lend the collection, so it takes the screening's.
  const defaultName = !source ? "" : source.kind === "screening" ? source.label : t("includedIn", { name: source.label.trim() || unnamed });

  const destinations = useCursorPage(api.library.collections.listCollections, inWorkspace(workspaceId, {}), DESTINATION_PAGE);
  // A collection can't be its own destination; picking it as the source moves the pick to a new one.
  const target = source?.kind === "collection" && dest === source.id ? "new" : dest;

  const models = useModelPicks();
  const model = models.modelOf("screenAll");
  const spend = useSpendable();
  const { data: slots } = useProtectedQuery(api.screening.queries.slots, inWorkspace(workspaceId, {}));
  const { balance } = spend;
  // The most these papers cost on the model Screen all runs on: what the job holds when it starts.
  const { data: estimate } = useProtectedQuery(api.screening.queries.estimate, inWorkspace(workspaceId, { papers }));
  // Until the figure for these papers arrives, nothing can start.
  const credits = estimate?.credits ?? 0;
  const enough = estimate !== undefined && credits <= balance;
  // The server reads the saved search, so edits still being saved would be screened without.
  const { pending: savingEdits } = useResearchStatus();
  const screen = useWorkspaceAction(api.screening.start.screen);
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
    const firstOf = lists[next].rows.find((row) => row.count > 0);
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
    // Answers are kept by a question's text, so the same question isn't asked twice.
    adopt([{ key: "", text, yes: 1, no: 0, unclear: 0 }]);
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
        // The server names a library's screening after the library; the form's name for it is what it showed.
        ...(title.trim() ? { name: title.trim() } : source.kind === "evidenceLibrary" ? { name: unnamed } : {}),
      });
      onStarted(jobId);
    } catch (error) {
      toast.error(t("startFailed"), getErrorMessage(error, t("startFailed")));
      setBusy(false);
    }
  };

  const list = lists[kind];
  // Laid out once everything it sizes itself from has arrived, so nothing grows after it shows.
  const ready = !searches.isLoading && !collections.isLoading && !screenings.isLoading && !destinations.isLoading && savedCount !== undefined && libraries.loaded && (!againLibrary || ranBefore.data !== undefined || ranBefore.error !== undefined) && (!handoffId || handedOver.data !== undefined || handedOver.error !== undefined) && spend.loaded && slots !== undefined && (!fromSearchId || from !== undefined || watched === "missing" || watched === "failed");
  /** How many of a library row's records a job takes, as the other sources ask it. */
  const libraryScope = (row: LibraryRow) => {
    if (source?.kind !== "evidenceLibrary" || source.id !== rowKey(row)) return null;
    return (
      <PaperScope
        search={row.what === "search"}
        page={false}
        scope={scope}
        onScope={setScope}
        range={[first, last]}
        onRange={setRange}
        total={top}
        label={t("papersToScreen")}
        summary={
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip className="text-foreground"><span>{t.rich("papersBold", { count: papers, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</span></Chip>
            {isFrozen(row) ? <Chip icon={Camera}>{tl("frozen")}</Chip> : null}
            {isFrozen(row) && row.records > LIBRARY_SOURCE_MAX ? <Chip>{tl("firstOf", { count: LIBRARY_SOURCE_MAX, total: row.records })}</Chip> : null}
          </div>
        }
      />
    );
  };

  return (
    <Enter ready={ready}>
      <div className="space-y-8 pb-24">
        {/* Its name heads the page, written where it shows. */}
        <div className="space-y-1">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={unnamed} aria-label={tc("name")} maxLength={200} className="w-full rounded-lg bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40" />
          <p className="text-sm text-muted-foreground">{t("newScreeningHint")}</p>
        </div>

        <Zone label={t("papers")}>
          <Segmented label={t("sourceKind")} value={kind} onChange={pick} fill="labels" options={KINDS.map((id) => ({ id, label: t(`kind.${id}`), icon: SOURCE_ICON[id] }))} />
          {/* While a kind has pages its list keeps a full page's height, so the pager stays put on a short last page. */}
          <div className="mt-3" style={kind !== "evidenceLibrary" && list.pager?.hasPages ? { minHeight: SOURCE_PAGE * SOURCE_ROW + 1 } : undefined}>
            {kind === "evidenceLibrary" ? (
              <LibrarySources
                state={libraries}
                notice={startError && !source ? startError : undefined}
                isOn={(row) => source?.id === rowKey(row)}
                onToggle={(row, library) => {
                  choose(librarySource({ library, row }));
                  setScope("all");
                }}
                onPasted={(held) => {
                  choose(librarySource(held));
                  setScope("all");
                }}
                scope={libraryScope}
              />
            ) : list.rows.length === 0 ? (
              <p className={cn(LIST, "px-4 py-8 text-center text-sm text-muted-foreground")}>{t(`noSets.${kind}`)}</p>
            ) : (
              <div className={cn(LIST, list.pager?.isStale && "pointer-events-none opacity-60")} role="radiogroup" aria-label={t("papersToScreen")}>
                {list.rows.map((s) => {
                  const on = s.id === source?.id;
                  return (
                    <SourceRow
                      key={s.id}
                      on={on}
                      onToggle={() => choose(s)}
                      disabled={s.count === 0}
                      icon={SOURCE_ICON[s.kind]}
                      label={s.kind === "search" ? <QueryText query={s.label} oql={s.search.field === OQL_FIELD} /> : s.label}
                      detail={
                        // As on a search's history card: one row that scrolls sideways under a fading edge.
                        s.kind === "search" ? (
                          <span className="block min-w-0 overflow-x-auto scrollbar-hover mask-r-from-[calc(100%-2rem)]">
                            <FilterChips filters={{ ...s.search, field: undefined, sortBy: undefined }} size="compact" singleLine />
                          </span>
                        ) : null
                      }
                      count={<Chip>{t("paperCount", { count: s.count })}</Chip>}
                    >
                      {/* Every set is picked from the same way: a range of its papers, or all of them; a search also has the page being read. */}
                      <PaperScope
                        search={s.kind === "search"}
                        scope={scope}
                        onScope={setScope}
                        range={[first, last]}
                        onRange={setRange}
                        total={top}
                        label={t("papersToScreen")}
                        summary={
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Chip className="text-foreground"><span>{t.rich("papersBold", { count: papers, n: (chunks) => <span className="font-semibold">{chunks}</span> })}</span></Chip>
                            {scope === "page" ? <Chip>{t("resultsPage", { page })}</Chip> : null}
                          </div>
                        }
                      />
                    </SourceRow>
                  );
                })}
              </div>
            )}
          </div>
          {kind !== "evidenceLibrary" && list.pager?.hasPages ? (
            <PageStepper className="pt-3" page={list.pager.page} pageCount={list.pager.pageCount} canPrevious={list.pager.canPrevious} canNext={list.pager.canNext} onPrevious={turn(list.pager.previous)} onNext={turn(list.pager.next)} />
          ) : null}
        </Zone>

        <Zone
          label={t("questions")}
          aside={
            // What the papers come from decides the shortcuts: a search's questions are its own (one
            // screening per search) and it can write more from its research question; an earlier
            // screening has questions to reuse.
            <span className="flex min-w-0 items-center gap-1">
              {source?.kind === "search" ? <Chip icon={ListChecks}>{t("sharedWithResults")}</Chip> : null}
              {source?.kind === "screening" ? (
                // The screening's name can be a whole query: it's cut to the room there is, and shown in full on hover.
                <TooltipHint label={fresh.length || !earlier ? t("importQuestions", { count: fresh.length, name: source.label }) : t("importedFrom", { name: source.label })} onlyWhenClipped>
                  <span className="flex min-w-0">
                    <Button variant="ghost" size="sm" className="h-7 min-w-0 shrink text-xs" onClick={() => adopt(fresh)} disabled={!fresh.length}>
                      <ListChecks className="text-primary" />
                      <span className="truncate">{fresh.length || !earlier ? t("importQuestions", { count: fresh.length, name: source.label }) : t("importedFrom", { name: source.label })}</span>
                    </Button>
                  </span>
                </TooltipHint>
              ) : null}
              {kind === "search" ? (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={generate} disabled={generating || !canGenerate || !source}>
                  <AiIcon working={generating} />{t("generate")}
                </Button>
              ) : null}
            </span>
          }
        >
          <div className={LIST}>
            {/* On a narrow screen a question takes a line of its own, with its points under it. */}
            <div className="grid grid-cols-[1.5rem_repeat(3,minmax(0,1fr))_2rem] items-center gap-3 px-4 py-2 text-xs text-muted-foreground sm:grid-cols-[1.5rem_1fr_repeat(3,4rem)_2rem]">
              <span />
              <span className="hidden sm:block">{t("question")}</span>
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
                  <div className="grid grid-cols-[1.5rem_repeat(3,minmax(0,1fr))_2rem] items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:grid-cols-[1.5rem_1fr_repeat(3,4rem)_2rem]">
                    <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums">{i + 1}</span>
                    <p className="col-span-4 min-w-0 text-sm sm:col-span-1">{q.text}</p>
                    {ANSWERS.map((a, column) => (
                      <Input key={a} type="number" value={q[a]} onChange={(e) => points(q.key, a, Number(e.target.value))} aria-label={t("pointsFor", { answer: t(`answer.${a}`), number: i + 1 })} className={cn("h-8 border-transparent px-1 text-center text-sm font-medium tabular-nums shadow-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none", column === 0 && "col-start-2 sm:col-start-auto", TINT[a].input)} />
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
          <div className={cn("space-y-3 rounded-2xl border p-4 transition-colors duration-300", unscored ? "border-dashed border-border" : "border-border-subtle bg-inset")}>
            <div className="flex items-center gap-3">
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-300", unscored ? "bg-muted text-muted-foreground/60" : "bg-success/15 ink-success")}>
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
                  className="[&_[data-slot=slider-range]]:bg-muted [&_[data-slot=slider-thumb]]:border-success [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-success/70"
                />
              )}
            </div>
          </div>
        </Zone>

        <Zone label={t("stars")}>
          <div className={cn("space-y-4 rounded-2xl border p-4 transition-colors duration-300", unscored ? "border-dashed border-border" : "border-border-subtle bg-inset")}>
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
                      <Star key={j} className={cn("size-2.5 transition-colors duration-300", unscored ? "text-muted-foreground/40" : "fill-rating text-rating")} />
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

        {/* What it screens with, as AI settings set it: changed there, not here (#689). */}
        {model ? <ModelsInUse label={t("model")} uses={[{ label: t("yesOrNo"), model }]} /> : null}

        <Zone label={t("collections")}>
          {source?.kind === "collection" ? (
            <label className="mb-3 flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-border-subtle px-4 py-2.5">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset", prune ? "text-primary" : "text-muted-foreground")}>
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

        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-4 rounded-2xl border border-border-subtle bg-background p-4 shadow-lg">
          <CreditCheck credits={credits} balance={balance} enough={enough} cap={spend.cap} />
          <div className="flex flex-wrap items-center gap-1.5">
            {slots ? <Chip icon={Gauge}>{t("atATime", { limit: slots.limit })}</Chip> : null}
            {waitingFor ? (
              <ClippedChip icon={Hourglass} className="max-w-56">{t("after", { name: waitingFor })}</ClippedChip>
            ) : null}
          </div>
          {/* A search's papers can cost less than the estimate: its page's answers are reused and its rating filter drops papers. The server checks what's left. */}
          <Button disabled={busy || unscored || estimate === undefined || (!enough && source?.kind !== "search") || papers < 1 || Boolean(savingEdits)} onClick={start}>
            {busy ? t("readingPapers") : t("screenPapers", { count: papers })}
          </Button>
        </div>
      </div>
    </Enter>
  );
}

/** One place the included papers can go, as the chat offers them: none, a new collection, or one you have. */
function DestinationRow({ on, onPick, icon: Icon, name, facts, children }: { on: boolean; onPick: () => void; icon: AppIcon; name?: string; facts?: ReactNode; children?: ReactNode }) {
  return (
    <div role="radio" aria-checked={on} tabIndex={0} onClick={onPick} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && e.target === e.currentTarget && onPick()} className={cn("flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors", on ? "bg-primary/5" : "hover:bg-muted")}>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset", on ? "text-primary" : "text-muted-foreground")}>
        <Icon className="size-4" />
      </span>
      {name ? <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span> : <span className="flex min-w-0 flex-1">{children}</span>}
      {facts}
      <PickMark on={on} />
    </div>
  );
}

