"use client";

import { AutoHeight } from "@/components/ui/auto-height";
import dynamic from "next/dynamic";

// The open screening's Papers page: every paper as a row, a column of votes per reviewer, and where
// the paper stands. A row opens the paper in a drawer at the window's side, with who voted what and when.

import { ListEmpty, ListRowsSkeleton, ListSearch } from "@/components/evidence-libraries/list-controls";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { createSerializer, parseAsArrayOf, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useConvex } from "convex/react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { AnswersDiffer, ArrowDown, ArrowUp, ArrowUpDown, Award, CalendarDays, Check, ChevronDown, ChevronRight, ChevronUp, Clock, Download, FileSearch, GitCompare, Hourglass, Layers, ListChecks, Play, RefreshCw, SlidersHorizontal, TriangleAlert, Undo2, Users, X, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { AnimatedNumber, Chip, Stars } from "./parts";
import { NoPapers } from "./overview";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { focusContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpFact } from "@/components/ui/help";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FadeRow } from "@/components/ui/fade-row";
import { SELECT_TRIGGER } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { showStyledToast } from "@/components/ui/sonner";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage, useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { EXTRACT_HREF, pickForExtraction } from "./extract";
import { inWorkspace, useWorkspace as usePageWorkspace } from "@/lib/workspaces/url";
import { blindOf, type Blind, invitedSaid, reasonCriteria, inOrder, growing, bylineOf, awaitedOn, splitsIn, readersOf, modelsOf, type Criterion, resolves, DECISIONS, RESULTS, castOf, keptOf, personIn, pointsMax, questionOf, sentencesOf, settledOf, taken, voteOn, votingReviewers, type Decision, type Paper, type Reviewer, type Result, shortName, othersRead } from "./data";
import { papersHref, screenHref } from "./links";
import { PdfRoom, Sentence, ReasonNoteField, VoteFacts, Byline, Faces, votesBy, AnswerMark, FILTER_ON, FilterMenu, Help, Kbd, LinkChip, Note, PaperStepper, ReasonChip, PaperFacts, ReasonRows, VoteButton, RetryRead, VotesHelp, ShutChip, ShutNote, VOTES_SHUT, votesShutOf, votesTitle, HiddenChip, blindSays, youFirst, Named, Panel, QuestionHint, QuestionName, RESULT_ICON, RESULT_STYLE, Reason, ResultChip, ReviewerMark, ReviewerName, Section, StateChip, TONE, Tally, VoteMark, BELOW_HEADER, UNDER_FRAME, kindIcon, SEARCH_PILL } from "./pieces";
import { Evidence, Matrix, Said } from "./screen";
import type { Open } from "./store";
import { useTranslations } from "next-intl";
import { useRtl, useWords } from "./words";
import { searchHistory, useOpenInAddress } from "./address";
import { givenReason, NOTE_LENGTH, OTHER_REASON } from "@/lib/screening/rules";
import type { ExportTab } from "./dialogs";
import { everyPaper, fileName, risOf, save, votesCsv } from "./export";
import { Discussion, DiscussionShut, type DiscussionDraft } from "./discussion";
import { useWorkspace } from "./workspace";
import { ScrollArea } from "@/components/ui/scroll-area";

// pdf.js is loaded only for a paper screened as its PDF.
const PaperPdf = dynamic(() => import("./paper-pdf"), { ssr: false });

const PAGE = 20;
/** What the count of a narrowed table is asked with: what narrows it, less what the count leaves to the list. */
type CountArgs = Omit<(typeof api.screening.paperViews.counts)["_args"], "workspaceId">;
/** Papers settled at once where many are settled together. */
const SETTLED_AT_ONCE = 10;
/** Papers one vote on a selection sends at a time: as many as the server takes in one call (convex/screening/voting.ts `VOTE_MANY`). */
const VOTE_MANY = 100;
/** How long a selection's Undo stays: long enough to read what was done, and reach it. */
const UNDO_MS = 10_000;
const ROW = 57;
/** A button in the papers' bar, the pill its filter menus and its search are. */
const PILL = "h-8 rounded-full px-3.5 text-xs";
/** The checks for new papers the Added filter offers: the latest of them. */
const CHECKS = 30;
type PapersT = ReturnType<typeof useTranslations<"screening.papers">>;
const notSaved = (t: PapersT, error: unknown) => showStyledToast("error", getErrorMessage(error, t("notSaved")));

/** The filters' sheet is open: the one value its key in the address takes. Starting or clearing a search is a step in the history; the letters between replace each other. */
const FILTERS_OPEN = ["open"] as const;
const SORTS = ["added", "title", "title-desc", "result", "newest", "split", "points"] as const;
type Sort = (typeof SORTS)[number];
/** Each order's sign: an arrow for the way a title runs, and what the others go by. */
const SORT_ICON: Record<Sort, AppIcon> = { added: Clock, title: ArrowDown, "title-desc": ArrowUp, result: ListChecks, newest: CalendarDays, split: GitCompare, points: Award };
const VOTED = ["any", ...DECISIONS, "none", "settled", "failed"] as const;
type Voted = (typeof VOTED)[number];

/**
 * What the table shows, kept in the address (papersHref in links.ts says what each means). `reviewer`
 * with `voted` narrows to one reviewer's votes, and `voted` alone to your own. `voted=settled` is the
 * conflicts that reviewer settled, and `voted=failed` the papers a model couldn't read. `reason` is why
 * a paper was excluded. `paper` is the one open: `first` and
 * `last` name it by its place on the page shown, while a step onto another page waits for that page. The
 * list keeps its own page in the address.
 */
const PLACE = {
  result: parseAsStringLiteral(["all", ...RESULTS] as const).withDefault("all"),
  by: parseAsStringLiteral(["reviewers", "criteria"] as const).withDefault("reviewers"),
  source: parseAsString.withDefault("all"),
  reviewer: parseAsString,
  voted: parseAsStringLiteral(VOTED).withDefault("any"),
  with: parseAsArrayOf(parseAsString).withDefault([]),
  reason: parseAsString,
  added: parseAsString.withDefault("all"),
  sort: parseAsStringLiteral(SORTS).withDefault("added"),
  q: parseAsString.withDefault(""),
  paper: parseAsString,
};

const addressOf = createSerializer(PLACE);
type Narrow = Partial<Record<"result" | "source" | "added" | "reviewer" | "voted" | "reason", string>>;
/**
 * A link on this page that narrows the table to something. Where the table is already narrowed to exactly that, the
 * same link takes it away again, so a second press undoes the first. `undo` names what the second press clears, where
 * that is less than what the first set. `aria-current` marks the link while it is what narrows the table. The first
 * press adds to what the table already shows and the second takes just that away, so the two leave the table as it was.
 * A paper that is open stays open through both, so a chip in its panel is still there to press again. Each kind of
 * filter holds one value, as the selects above the table do: a link to another reviewer replaces the one shown.
 */
function useNarrow(id: string, me: string) {
  const [place] = useQueryStates(PLACE);
  // A vote named without a reviewer is your own, as the table reads it.
  const shown = { ...place, reviewer: place.reviewer ?? (place.voted !== "any" ? me : (place.with[0] ?? null)) };
  return (to: Narrow, undo = Object.keys(to) as Array<keyof Narrow>) => {
    const on = Object.entries(to).every(([key, value]) => shown[key as keyof Narrow] === value);
    return { on, href: on ? addressOf(papersHref(id), { ...place, ...Object.fromEntries(undo.map((key) => [key, null])) }) : addressOf(papersHref(id), { ...place, ...(to as Partial<typeof place>) }), "aria-current": on ? ("true" as const) : undefined };
  };
}

/** Names as a phrase: "A", "A and B", "A, B and C". */

/** The Papers table as a page of the open screening. */
export function PapersPage() {
  const { open, exportTo } = useWorkspace();
  return <Papers open={open} onExport={exportTo} />;
}

/** The reasons a paper can be excluded for: each criterion not met, then the others. */

/** A reviewer's name, or a person's who settles conflicts without voting. */

function Papers({ open, onExport }: { open: Open; onExport: (tab: ExportTab) => void }) {
  const backwards = useRtl();
  const { screening } = open;
  // What is written in the drawer is kept for each paper, as Screen keeps it: stepping to the next paper and back finds it where it was, and a save refused after stepping on puts the note back on its own paper.
  const [notes, setNotes] = useState<Record<string, PaperNotes>>({});
  const [talks, setTalks] = useState<Record<string, DiscussionDraft>>({});
  const id = screening.id;
  const workspaceId = usePageWorkspace();
  const t = useTranslations("screening.papers");
  const screenWords = useTranslations("screening.screen");
  const words = useWords();
  const pieces = useTranslations("screening.pieces");
  // Its reviewers, and whoever was taken off with votes that still count: a result can rest on one of those votes, so its column and its filter stay.
  const reviewers = inOrder(votingReviewers(screening), open.me);
  const criteria = screening.criteria;
  // The criteria a reason can name: these, and the ones taken off that a kept result was excluded for.
  const reasonNames = reasonCriteria(screening);
  // A tab, a filter, an order or a page is a step Back returns from. Typing in the search box and going from paper to paper change the address in place.
  const [place, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  const narrow = useNarrow(id, open.me);
  const { result: filter, by: columns, source: from, reviewer, voted, with: also, reason, added, q: query, paper: opened } = place;
  // While the others' votes are kept from the person on the papers they have yet to vote on (convex/screening/view.ts `keepsVotes`), an order worked out from those votes is shut: the server gives the papers as they were added.
  const sort = open.keepsVotes && (place.sort === "split" || place.sort === "points") ? "added" : place.sort;
  // Where no paper can be in conflict and none is, there is no In conflict to filter by and no split to sort by.
  const splits = splitsIn(screening, open.counts.conflict, open.invited);
  // Most split votes needs a paper with two votes on it: two people, or a person and a model, whatever their votes decide.
  const twoVotes = splits || readersOf(screening, open.invited).each + modelsOf(screening).length > 1;
  const shownResults = RESULTS.filter((result) => result !== "conflict" || splits || filter === "conflict");
  /** Narrows or reorders the table. A list read another way is another list, which starts from its first page. */
  const go = (next: Parameters<typeof setPlace>[0]) => void setPlace(next);
  const clearFilters = () => go({ source: null, reviewer: null, voted: null, with: null, reason: null, added: null, q: null });
  // Opening a paper and closing it are steps Back returns from. Going from one open paper to another changes the address in place.
  // Each paper opened, by a click or a step, is a step in the browser's history: Back goes to the one that was open before.
  const show = (paperId: string) => void setPlace({ paper: paperId });
  const close = () => void setPlace({ paper: null });
  // The other reviewers as one word: the list itself is a new one on every draw.
  const alsoKey = also.join(",");
  const searched = useDebouncedValue(query.trim(), 300);
  // A selection belongs to the list it was made in: another tab, filter, search or order starts with none selected.
  const scope = [filter, from, reviewer, voted, alsoKey, reason, added, sort, searched].join("|");
  const [selection, setSelection] = useState({ scope, papers: [] as Paper[] });
  const pickedPapers = selection.scope === scope ? selection.papers : [];
  const chosen = pickedPapers.map((one) => one.id);
  const setPicked = (papers: Paper[]) => setSelection({ scope, papers });
  const pickOne = (paper: Paper) => setPicked(chosen.includes(paper.id) ? pickedPapers.filter((one) => one.id !== paper.id) : [...pickedPapers, paper]);
  // The filters' sheet, on a phone, is in the address: Back closes it.
  const [filteringOpen, setFilteringOpen] = useOpenInAddress("filters", FILTERS_OPEN);
  const filtering = filteringOpen !== null;
  const setFiltering = (next: boolean) => setFilteringOpen(next ? "open" : null);
  const top = useRef<HTMLDivElement>(null);

  // Whose votes narrow the table: the reviewer named, or you when only a vote is, or the first of the others where an address names only those. With others beside them, the table shows the papers all of them voted on.
  const who = reviewer ?? (voted !== "any" ? open.me : (also[0] ?? null));
  // The one named in the Reviewer control, where they are still one of its reviewers.
  const whoMark = reviewers.find((one) => one.id === who);
  const everyone = who ? [who, ...also.filter((one) => one !== who)] : [];
  /** Takes a reviewer into the ones the table is narrowed to, or out of them. With more than one, it is everyone's votes on a paper that count, so a single reviewer's kind of vote no longer applies. */
  const pick = (one: string) => {
    const next = everyone.includes(one) ? everyone.filter((id) => id !== one) : [...everyone, one];
    go({ reviewer: next[0] ?? null, with: next.length > 1 ? next.slice(1) : null, voted: next.length === 1 && next[0] === who ? (voted === "any" ? null : voted) : null });
  };
  /** Why a paper stands where it does, as a reason to find it by: what excluded it, or the criterion a Maybe was unclear on. */
  const reasonKey = (paper: Paper) => (paper.result === "exclude" ? paper.reason : paper.result === "maybe" ? criteria.find((criterion) => criterion.must && paper.cast.some((one) => one.vote?.answers[criterion.key] === "unclear"))?.key : undefined);

  // The table is read from the server a page at a time, narrowed and ordered there: a screening holds more papers than a page should.
  const others = everyone.filter((one) => one !== who);
  // What the table is narrowed to, beside the result its tab keeps: the list, the tabs' counts and "Select all" are all of these papers.
  const narrowed = {
    ...(from !== "all" ? { source: from as Id<"screeningSources"> } : {}),
    ...(added !== "all" ? { check: added === "start" ? ("start" as const) : (added as Id<"screeningChecks">) } : {}),
    ...(reason ? { reason } : {}),
    ...(who ? { reviewer: who } : {}),
    ...(who && voted !== "any" ? { voted } : {}),
  };
  // The server gives one reviewer's papers in the order they voted on them, and a search's in the order they best match: no other order is offered then, and the menu says which it is.
  const fixedOrder = searched ? ("bySearch" as const) : who ? (voted === "none" || voted === "failed" ? ("byPlace" as const) : ("byVote" as const)) : null;
  const matching = { jobId: id, ...(filter !== "all" ? { result: filter } : {}), ...narrowed, ...(others.length ? { also: others } : {}), ...(searched ? { text: searched } : {}) };
  const listed = useCursorPageAt("page", api.screening.paperViews.list, inWorkspace(workspaceId, { ...matching, ...(sort !== "added" ? { sort } : {}) }), PAGE, { scroll: false });
  const shown = listed.items;
  // How many papers stand each way is kept for the whole screening. Narrowed to a source, a check, a reason or a reviewer, the server counts them (convex/screening/paperViews.ts `counts`). Words looked for, the papers two reviewers share and the conflicts one person settled are found a page at a time, and their tabs carry no number.
  const anyNarrow = from !== "all" || Boolean(who) || Boolean(reason) || added !== "all" || Boolean(searched);
  const countable = anyNarrow && !searched && !others.length && voted !== "settled";
  const under = useProtectedQuery(api.screening.paperViews.counts, inWorkspace(workspaceId, countable ? ({ jobId: id, ...narrowed } as CountArgs) : "skip")).data;
  const tabCounts = anyNarrow ? (countable ? (under ?? undefined) : undefined) : open.counts;
  const countOf = (result: Result | "all") => (!tabCounts ? undefined : result === "all" ? (anyNarrow ? RESULTS.reduce((sum, one) => sum + tabCounts[one], 0) : open.total) : tabCounts[result]);
  const total = countOf(filter);
  // A count the server is still reading holds a digit's room, so the tabs don't widen when it arrives. Where none will come the tab has no number.
  const pending = countable && !under ? <span aria-hidden className="invisible tabular-nums">0</span> : undefined;
  // Every paper the table is narrowed to, read for a selection of them all: the pages after this one, a page at a time.
  const convex = useConvex();
  const [takingAll, setTakingAll] = useState(false);
  const selectAll = () => {
    if (!workspaceId || takingAll) return;
    setTakingAll(true);
    everyPaper(convex, { workspaceId, ...matching }).then(setPicked).catch((error) => notSaved(t, error)).finally(() => setTakingAll(false));
  };
  // When papers joined after the start: the latest checks that brought some.
  const checks = useCursorPage(api.screening.view.checks, inWorkspace(workspaceId, { jobId: id }), CHECKS);
  const arrivals = checks.items.filter((check) => !check.first && check.added > 0);
  // The Added filter keeps its place while the checks are read wherever papers can have come in after the start.
  const mayHaveArrivals = checks.isLoading && (Boolean(screening.living) || growing(screening).length > 0);
  const newest = open.latest?.id;

  // The open paper is read by itself, so a link to one shows it whatever page the table is on. A step onto another page names it by its place there until that page is read.
  const [held, setHeld] = useState<Paper | undefined>(undefined);
  const turning = (opened === "first" || opened === "last") && (listed.isStale || listed.isLoading);
  const openId = turning ? held?.id : opened === "first" ? shown[0]?.id : opened === "last" ? shown.at(-1)?.id : (opened ?? undefined);
  const read = useProtectedQuery(api.screening.paperViews.paper, inWorkspace(workspaceId, openId ? { jobId: id, paperId: openId as Id<"screeningResults"> } : "skip")).data;
  const found = read ?? shown.find((one) => one.id === openId);
  // The drawer keeps the paper it shows while the next one is read, so it never empties between two papers.
  if (found && found !== held) setHeld(found);
  const paper = opened && read !== null ? (found ?? held) : undefined;
  // The paper before, kept while the one asked for is read (by its id, or by its place on a page still loading): dimmed and out of reach.
  const stale = Boolean(paper && (turning || (openId && paper.id !== openId)));
  // Its place in a list still being read is not known: no position is said and no step is offered until the rows come.
  const at = paper && !listed.isStale ? shown.findIndex((one) => one.id === paper.id) : -1;
  const inView = at >= 0;
  const allShown = shown.length > 0 && shown.every((one) => chosen.includes(one.id));

  // The step to the paper before or after the open one. Past the page's last paper is the next page's first, and before its first the last of the page before.
  // A paper reached by its place on a page is named in its step of the history before the next step, so Back returns to that paper whatever the page then holds.
  const step = async (by: 1 | -1) => {
    const next = at >= 0 ? shown[at + by] : undefined;
    if (!next && (at < 0 || !(by === 1 ? listed.canNext : listed.canPrevious))) return;
    if ((opened === "first" || opened === "last") && paper) await setPlace({ paper: paper.id }, { history: "replace" });
    if (next) return void setPlace({ paper: next.id });
    void setPlace({ paper: by === 1 ? "first" : "last" });
    (by === 1 ? listed.next : listed.previous)();
  };
  const canStep = { previous: at > 0 || (at === 0 && listed.canPrevious), next: at >= 0 && (at < shown.length - 1 || listed.canNext) };

  // The open paper's row is brought to the middle of the window where it is off the screen: after a link that opened it, or a step onto another page. A row already in view stays where it is. The window's scroll is the outside system.
  useEffect(() => {
    if (!opened || !inView) return;
    // The table and the phone's list both carry the paper: the one that is drawn is its row.
    const row = [...document.querySelectorAll<HTMLElement>(`[data-paper="${CSS.escape(opened)}"]`)].find((one) => one.getClientRects().length);
    if (!row) return;
    const box = row.getBoundingClientRect();
    const covered = (row.closest("table")?.querySelector("thead") ?? document.querySelector("[data-sticky-page-header]"))?.getBoundingClientRect().bottom ?? 0;
    if (box.top < covered || box.bottom > window.innerHeight) row.scrollIntoView({ block: "center" });
    // Again when the table is put in another order or narrowed, which can move the row. Not on a search being typed or on papers arriving: the page would move under the person.
  }, [opened, inView, listed.page, filter, from, reviewer, voted, alsoKey, reason, added, sort]);

  // The keyboard is the outside system: J and K or the arrows step through the list.
  useEffect(() => {
    if (!opened) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Inside the paper's own drawer the keys still step; the drawer closes itself on Escape. Any other dialog or menu keeps its keys.
      if (target?.closest("[role=menu], [role=listbox], [role=dialog]:not([data-paper-drawer])") || event.key === "Escape") return;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable=true]")) return;
      // The arrows go the way the drawer's chevrons point: in a right-to-left language, Next is on the left.
      if (event.key === "j" || event.key === (backwards ? "ArrowLeft" : "ArrowRight")) step(1);
      else if (event.key === "k" || event.key === (backwards ? "ArrowRight" : "ArrowLeft")) step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The window's scroll is the outside system. The line under the page's header, in pixels: `top`'s scroll margin is that line and 1rem.
  const underHeader = () => parseFloat(getComputedStyle(top.current!).scrollMarginTop) - parseFloat(getComputedStyle(document.documentElement).fontSize);
  // The paper opened or stepped to has its row in view, under the table's head, also after a step onto another page.
  useLayoutEffect(() => {
    if (!opened || !top.current) return;
    const row = [...top.current.querySelectorAll<HTMLElement>(`[data-paper="${opened}"]`)].find((one) => one.getClientRects().length);
    if (!row) return;
    const head = top.current.querySelector("thead");
    const line = underHeader() + (head?.getClientRects().length ? head.offsetHeight : 0);
    const box = row.getBoundingClientRect();
    if (box.top < line) window.scrollBy(0, box.top - line);
    else if (box.bottom > window.innerHeight) window.scrollBy(0, box.bottom - window.innerHeight);
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps -- runs when another paper opens
  const list = useRef<HTMLDivElement>(null);

  // A reviewer's column fits their first name under their face.
  const reviewerWidth = 3.5;
  // The narrowest the table can be, in rem. Where its column is narrower, it scrolls sideways and its head row stops sticking.
  const tableWidth = 15 + 12 + (columns === "criteria" ? criteria.length * 4.5 : reviewers.length * reviewerWidth);
  const [fits, setFits] = useState(true);
  // The column's width is the outside system: measured before the first paint, then whenever it changes.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => setFits(element.clientWidth >= tableWidth * parseFloat(getComputedStyle(document.documentElement).fontSize));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tableWidth, open.total > 0]);

  // Read from the papers as they stand now, never from the selection's copies: a paper settled or voted on in the drawer since is left out.
  const pickedNow = pickedPapers.map((one) => listed.items.find((now) => now.id === one.id) ?? one);
  const conflictsPicked = pickedNow.filter((one) => one.result === "conflict");
  // The picked papers that wait for the person's own vote: what a vote on the selection is cast on. The rest, voted already, kept from them or not theirs, are left out, and the bar says how many.
  const waitsOnMe = (one: Paper) => !one.withdrawn && one.mine && one.cast.some((place) => place.reviewer === open.me && !place.vote && !place.hidden && !place.failed);
  const votablePicked = open.isReviewer && !screening.finishedAt ? pickedNow.filter(waitsOnMe) : [];
  // Many papers are settled a few at a time: hundreds of saves at once would each wait on the others.
  // Each save's outcome is kept: what is said, and what Undo takes back, is only what the server took.
  const each = async (papers: Paper[], save: (paper: Paper) => Promise<unknown>) => {
    const saved: Paper[] = [];
    let refused: unknown;
    for (let at = 0; at < papers.length; at += SETTLED_AT_ONCE) {
      const batch = papers.slice(at, at + SETTLED_AT_ONCE);
      (await Promise.allSettled(batch.map(save))).forEach((done, i) => (done.status === "fulfilled" ? saved.push(batch[i]!) : (refused ??= done.reason)));
    }
    return { saved, refused };
  };
  // A selection's votes go a hundred papers to a call (convex/screening/voting.ts `VOTE_MANY`), each call saying which it changed and when: Undo takes back only those votes, while they are still the ones cast then.
  type Cast = { ids: Id<"screeningResults">[]; at: number };
  const inHundreds = async (ids: Id<"screeningResults">[], save: (ids: Id<"screeningResults">[]) => Promise<{ changed: Id<"screeningResults">[]; at: number }>) => {
    const [saved, casts]: [Id<"screeningResults">[], Cast[]] = [[], []];
    let refused: unknown;
    for (let at = 0; at < ids.length; at += VOTE_MANY) {
      const batch = ids.slice(at, at + VOTE_MANY);
      try { const done = await save(batch); if (done.changed.length) casts.push({ ids: done.changed, at: done.at }); saved.push(...batch); } catch (error) { refused ??= error; }
    }
    return { saved, casts, changed: casts.flatMap((one) => one.ids), refused };
  };
  const undoCasts = (casts: Cast[]) => void Promise.allSettled(casts.map((one) => open.voteMany(one.ids, null, one.at))).then((done) => { const failed = done.find((one) => one.status === "rejected"); if (failed) notSaved(t, failed.reason); });
  const settleAll = async (decision: Decision, why?: { reason: string; note?: string }) => {
    const settling = conflictsPicked;
    // The selection goes at once, so its buttons can't settle the same papers again while these saves run; the ones the server refuses come back picked, to try again.
    setPicked([]);
    // Each settlement's moment, so Undo takes back only one still standing as it was made.
    const made = new Map<string, number>();
    const { saved, refused } = await each(settling, async (one) => { const at = await open.resolve(one.id, decision, why?.note, why?.reason); if (at !== null) made.set(one.id, at); });
    if (refused) setPicked(settling.filter((one) => !saved.includes(one)));
    if (refused) notSaved(t, refused);
    if (saved.length) toast(t("settledToast", { count: saved.length, result: words.result(decision) }), { duration: UNDO_MS, action: { label: t("undo"), onClick: () => void each(saved.filter((one) => made.has(one.id)), (one) => open.resolve(one.id, null, undefined, undefined, made.get(one.id))).then(({ refused: again }) => again && notSaved(t, again)) } });
  };
  const voteAll = async (decision: Decision, why?: { reason: string; note?: string }) => {
    const voting = votablePicked;
    // As settling does: the selection goes at once, and the papers the server refuses come back picked.
    setPicked([]);
    // A hundred papers a call. Only the papers the vote went on count: one voted on since is left as it is, and Undo never touches it.
    const ballot = { decision, ...(why?.reason ? { reason: why.reason } : {}), ...(why?.note ? { note: why.note } : {}) };
    const { saved: sent, refused, changed, casts } = await inHundreds(voting.map((one) => one.id as Id<"screeningResults">), (ids) => open.voteMany(ids, ballot));
    if (refused) setPicked(voting.filter((one) => !sent.includes(one.id)));
    if (refused) notSaved(t, refused);
    const since = sent.length - changed.length;
    if (changed.length) toast(t("votedToast", { count: changed.length, decision: words.decision(decision) }), { duration: UNDO_MS, ...(since ? { description: t("votedSince", { count: since }) } : {}), action: { label: t("undo"), onClick: () => undoCasts(casts) } });
    else if (since) toast(t("votedSince", { count: since }));
  };
  const decideAll = (label: string, count: number, run: (decision: Decision, why?: { reason: string; note?: string }) => void) => (
    <span className="flex items-center gap-1.5 border-s border-border-subtle ps-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {DECISIONS.map((decision) =>
        decision === "exclude" ? (
          <Popover key={decision}>
            <PopoverTrigger asChild><VoteButton decision={decision} size="sm" /></PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-80 p-3" onEscapeKeyDown={(event) => { if ((event.target as HTMLElement | null)?.closest("[data-reason-note]")) event.preventDefault(); }}>
              <ReasonPicker criteria={open.screening.criteria} many={count > 1} onPick={(key, note) => run("exclude", { reason: key, note })} />
            </PopoverContent>
          </Popover>
        ) : (
          <VoteButton key={decision} decision={decision} size="sm" onClick={() => run(decision)} />
        ),
      )}
    </span>
  );
  // The selection as a file: built by the builders the Export dialog uses, so the rows are the same and a vote hidden on this page is hidden in the file.
  const exportPicked = (as: "csv" | "ris") => {
    if (as === "csv") save(fileName({ ...open, screening: open.filed }, "selected-papers-votes", "csv", Date.now()), "text/csv", votesCsv(open.filed, pickedPapers));
    else save(fileName({ ...open, screening: open.filed }, "selected-papers", "ris", Date.now()), "application/x-research-info-systems", risOf(pickedPapers));
  };

  // What narrows the table, each as a chip that takes it away.
  const whoName = who && who !== open.me ? words.nameOn(open.screening, who) : null;
  const addedLabel = (at: string) => { const check = arrivals.find((one) => one.id === at); return at === "start" ? t("filter.atStart") : check ? words.ago(check.at) : t("chip.earlierCheck"); };
  const someone = { you: String(!whoName), name: whoName ?? "" };
  const namesOf = (ids: string[]) => words.listed(ids.map((one) => words.whoIs(open.screening, one, open.me)));
  // The source narrowed to: the Overview counts what it brought, this list the papers kept once duplicates were merged.
  const narrowedSource = screening.sources.find((one) => one.id === from);
  const merged = narrowedSource ? taken(narrowedSource) - keptOf(narrowedSource) : 0;
  const active = [
    from !== "all" ? { key: "source", label: t("chip.source", { name: narrowedSource?.name ?? t("chip.removed") }), shown: <Named name={t("filter.source")}>{narrowedSource?.name ?? t("chip.removed")}</Named>, clear: { source: null }, fact: merged && narrowedSource ? t("chip.sourceFact", { kept: keptOf(narrowedSource), merged }) : undefined } : null,
    who
      ? {
          key: "reviewer",
          label: voted === "any" ? (everyone.length > 1 ? t("chip.votedOnBy", { names: namesOf(everyone) }) : pieces("votesBy", someone)) : voted === "none" ? t("chip.waitingFor", someone) : voted === "settled" ? t("settledBy", someone) : voted === "failed" ? t("chip.couldNotRead", someone) : t("chip.voted", { ...someone, decision: words.decision(voted) }),
          clear: { reviewer: null, voted: null, with: null },
        }
      : null,
    // Beside a reviewer's own kind of vote, the others are named apart.
    also.length && voted !== "any" ? { key: "with", label: t("chip.alsoVotedOnBy", { names: namesOf(also) }), clear: { with: null } } : null,
    reason ? { key: "reason", label: words.failed(reason, reasonNames), shown: <Reason reason={reason} criteria={reasonNames} />, clear: { reason: null } } : null,
    added !== "all" ? { key: "added", label: t("chip.added", { when: addedLabel(added) }), shown: <Named name={t("filter.added")}>{addedLabel(added)}</Named>, clear: { added: null } } : null,
  ].filter((one) => one !== null);
  const anyFilter = active.length > 0 || Boolean(query.trim());

  if (!open.total) return open.gathering || open.screening.checking ? <p className="px-6 py-20 text-center text-sm text-muted-foreground">{t("noPapers.gathering")}</p> : <NoPapers open={open} />;

  const reviewerOptions = reviewers;
  const settles = (reviewerId: string) => resolves(screening, reviewerId);
  // What the server has counted of the reviewer the table is narrowed to. The conflicts someone settled are not counted apart.
  const tally = reviewers.find((one) => one.id === who)?.tally;
  const countVoted = (kind: Voted) => (!tally || kind === "settled" ? undefined : kind === "any" ? tally.cast : kind === "none" ? tally.waiting : tally[kind]);
  // The filters, in the row over the table and in a phone's sheet.
  const filters = (trigger: string) => (
    <>
      {screening.sources.length > 1 ? (
        <FilterMenu
          name={t("filter.source")}
          value={from}
          onChange={(next) => go({ source: next === "all" ? null : next })}
          className={trigger}
          choices={[{ value: "all", label: t("filter.all"), icon: <Layers />, count: open.total }, ...screening.sources.map((source) => { const Icon = kindIcon(source.kind); return { value: source.id as string, label: source.name, icon: <Icon />, count: keptOf(source) }; })]}
        />
      ) : null}
      {/* Any number of reviewers: with several, the table shows the papers all of them voted on. The menu stays open while they are picked. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-slot="select-trigger" data-size="sm" aria-label={t("filter.reviewersLabel", { anyone: String(!everyone.length), names: namesOf(everyone) })} className={cn(SELECT_TRIGGER, everyone.length > 0 && FILTER_ON, trigger)}>
            <span className="text-muted-foreground">{everyone.length > 1 ? t("filter.reviewers") : t("filter.reviewer")}</span>
            {everyone.length > 1 ? (
              <span className="flex items-center">{everyone.map((one, i) => { const mark = reviewerOptions.find((option) => option.id === one); return mark ? <span key={one} className={cn("flex rounded-full ring-2 ring-card", i > 0 && "-ms-1")}><ReviewerMark reviewer={mark} className="size-4" /></span> : null; })}</span>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5 font-medium">{who ? <>{whoMark ? <ReviewerMark reviewer={whoMark} className="size-4" /> : null}<span className="truncate">{who === open.me ? words.t("you") : words.nameOn(open.screening, who)}</span></> : t("filter.anyone")}</span>
            )}
            <ChevronDown className="size-4 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={cn("w-64", AVATARS_FADE_IN)}>
          <DropdownMenuItem onSelect={() => go({ reviewer: null, voted: null, with: null })}><Users /><span className="flex-1">{t("filter.anyone")}</span>{everyone.length ? null : <Check className="size-4" />}</DropdownMenuItem>
          {[[t("filter.people"), reviewerOptions.filter((one) => one.kind === "person")], [t("filter.models"), reviewerOptions.filter((one) => one.kind === "model")]].map(([label, list]) =>
            (list as Reviewer[]).length ? (
              <div key={label as string} role="group" aria-label={label as string}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{label as string}</DropdownMenuLabel>
                {(list as Reviewer[]).map((one) => (
                  <DropdownMenuItem key={one.id} role="menuitemcheckbox" aria-checked={everyone.includes(one.id)} onSelect={(event) => { event.preventDefault(); pick(one.id); }}>
                    <ReviewerMark reviewer={one} className="size-4" /><span className="min-w-0 flex-1 truncate">{words.youOr(one, open.me)}</span>{everyone.includes(one.id) ? <Check className="size-4" /> : null}
                  </DropdownMenuItem>
                ))}
              </div>
            ) : null,
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {who && everyone.length === 1 ? (
        <FilterMenu
          name={t("filter.vote")}
          value={voted}
          onChange={(next) => go({ reviewer: who, voted: next === "any" ? null : next })}
          className={trigger}
          choices={[
            { value: "any" as Voted, label: t("filter.anyVote"), icon: <ListChecks />, count: countVoted("any") },
            // Votes kept from the person looking are no list to open: each decision says why, as the column's menu does.
            ...DECISIONS.map((decision) => { const { icon: Icon, tone } = RESULT_STYLE[decision]; return { value: decision as Voted, label: words.decision(decision), icon: <Icon />, tone, ...(tally?.kept ? { shut: words.t("hiddenWhileToDo") } : { count: countVoted(decision) }) }; }),
            { value: "none" as Voted, label: words.t("noVote.yet"), icon: <Hourglass />, count: countVoted("none"), group: t("filter.noVote") },
            ...(countVoted("failed") ? [{ value: "failed" as Voted, label: words.t("noVote.failed"), icon: <TriangleAlert />, tone: "destructive" as const, count: countVoted("failed"), group: t("filter.noVote") }] : []),
            ...(settles(who) ? [{ value: "settled" as Voted, label: t("filter.settled"), icon: <GitCompare />, tone: "info" as const, count: countVoted("settled"), group: t("filter.decisions") }] : []),
          ]}
        />
      ) : null}
      {arrivals.length || mayHaveArrivals ? (
        <FilterMenu
          name={t("filter.added")}
          value={added}
          onChange={(next) => go({ added: next === "all" ? null : next })}
          className={trigger}
          choices={[
            { value: "all", label: t("filter.anyTime"), icon: <Clock />, count: open.total },
            // A screening started with no source brought nothing at the start: no choice opens an empty list.
            ...(open.total > arrivals.reduce((sum, check) => sum + check.added, 0) ? [{ value: "start", label: t("filter.atStart"), icon: <Play /> }] : []),
            ...arrivals.map((check) => ({ value: check.id as string, label: words.ago(check.at), icon: <RefreshCw />, tone: "primary" as const, count: check.added, group: t("filter.afterStart") })),
          ]}
        />
      ) : null}
    </>
  );
  const sorter = (trigger: string) => (
    <FilterMenu name={t("filter.order")} lead={<ArrowUpDown className="size-3.5" />} value={fixedOrder ? "added" : sort} onChange={(next) => go({ sort: next === "added" ? null : next })} narrows={false} align="end" className={trigger} choices={SORTS.filter((one) => one !== "split" || twoVotes || place.sort === "split").map((one) => { const Icon = SORT_ICON[one]; return { value: one, label: one === "added" && fixedOrder ? t(`sort.${fixedOrder}Label`) : t(`sort.${one}`), icon: <Icon />, ...(one !== "added" && fixedOrder ? { shut: t(`sort.${fixedOrder}`) } : open.keepsVotes && (one === "split" || one === "points") ? { shut: blindOf(screening, open.invited) === "people" ? t("sort.peopleShut") : t("sort.shut") } : {}) }; })} />
  );
  // Pills, as the tabs and the search box in the same bar are. A long value is cut sooner where the page is narrow, so more of the row is in view.
  const trigger = "h-8 w-auto max-w-48 gap-1.5 rounded-full px-3.5 text-xs @5xl/papers:max-w-72";

  // A column head that orders the table: pressed again, the other way round.
  // Where a search or a reviewer fixes the order (`fixedOrder`), the head is its name and orders nothing, as the Order menu says.
  const sortHead = (label: string, on: boolean, next: Sort | null, descending = false) => fixedOrder ? <span>{label}</span> : (
    <button type="button" onClick={() => go({ sort: next })} className={cn("-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50", on && "text-primary")}>
      {label}
      {on ? (descending ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />) : <ArrowUpDown className="size-3 opacity-40" />}
    </button>
  );
  const showReason = columns === "reviewers";
  // The Reason column shows wherever the table is wide enough for it, beside an open paper too.
  const reasonHidden = showReason ? "@max-[60rem]/table:hidden" : "hidden";
  const lastCell = "w-48 pe-4 sm:pe-6 lg:w-60";

  return (
    <div ref={top} className={cn("@container/papers", BELOW_HEADER)}>
      {/* Row one: where the papers stand, and the search. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 pt-4 sm:px-6">
        {/* Six tabs don't fit a phone's width, and a row of tabs never runs off the screen: there they are one menu, with the same signs and counts. */}
        <FilterMenu
          name={t("filter.result")}
          value={filter}
          onChange={(next) => go({ result: next === "all" ? null : next })}
          className="h-8 w-full rounded-full px-3.5 text-xs sm:w-auto @4xl/papers:hidden"
          choices={[{ value: "all" as typeof filter, label: t("filter.all"), icon: <Layers />, count: countOf("all") }, ...shownResults.map((result) => { const Icon = RESULT_ICON[result]; return { value: result as typeof filter, label: words.result(result), icon: <Icon />, tone: RESULT_STYLE[result].tone, count: countOf(result) }; })]}
        />
        {/* The six results side by side need the card's room: until there is, they are the one menu a phone has, so they never run past its edge. */}
        <div className="@max-4xl/papers:hidden">
          <Segmented
            label={t("filter.result")}
            value={filter}
            onChange={(next) => go({ result: next === "all" ? null : next })}
            options={[
              { id: "all" as const, label: t("filter.all"), detail: countOf("all") === undefined ? pending : <span className="tabular-nums text-muted-foreground"><AnimatedNumber value={countOf("all")!} /></span> },
              ...shownResults.map((result) => ({ id: result, label: words.result(result), icon: RESULT_ICON[result], detail: !tabCounts ? pending : <span className={cn("tabular-nums", tabCounts[result] ? TONE[RESULT_STYLE[result].tone].ink : "text-muted-foreground")}><AnimatedNumber value={tabCounts[result]} /></span> })),
            ]}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 max-sm:w-full">
          <ListSearch box="min-w-0 flex-1 @2xl/papers:max-w-md" value={query} onChange={(event) => void setPlace({ q: event.target.value || null }, searchHistory(query, event.target.value))} placeholder={t("find")} aria-label={t("findLabel")} className={SEARCH_PILL} />
          {/* The included papers can go to extraction from the list that shows them, whether or not every other paper is settled: the Overview offers the same once they all are. */}
          {/* An extraction reads a screening of the workspace it runs in: a guest's own workspace has none of this one's. */}
          {filter === "include" && open.counts.include && open.canChange ? <Button asChild variant="outline" size="sm" className={cn(PILL, "shrink-0")}><NextLink href={EXTRACT_HREF} onClick={() => pickForExtraction(workspaceId, open.screening, open.counts.include)}><FileSearch />{t("extractIncluded")}</NextLink></Button> : null}
          {/* Under a wide window the bar's Export is in its menu: here it is beside the list it exports. */}
          <Button variant="outline" size="sm" className={cn(PILL, "max-sm:hidden xl:hidden")} onClick={() => onExport("papers")}><Download />{t("export")}</Button>
          <Button variant="outline" size="sm" className={cn(PILL, "@2xl/papers:hidden")} onClick={() => setFiltering(true)}>
            <SlidersHorizontal />{t("filters")}
            {active.length ? <span className="rounded-full bg-primary/12 px-1.5 text-2xs tabular-nums text-primary">{active.length}</span> : null}
          </Button>
          <VoteMarksHelp blind={blindOf(screening, open.invited)} className="@2xl/papers:hidden">{t("marksOnPhone")}</VoteMarksHelp>
        </div>
      </div>

      {/* Row two, on one line at every width: what the columns show, what narrows the list, and its order. Where the filters don't all fit, the run of them scrolls sideways under a fade, and the order keeps its place at the row's end. Taking every filter away is with the chips under this row. */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-4 sm:px-6 @max-2xl/papers:hidden">
        {criteria.length ? <div className="shrink-0"><Segmented label={t("filter.showColumns")} value={columns} onChange={(next) => void setPlace({ by: next === "reviewers" ? null : next })} options={[{ id: "reviewers", label: t("filter.votes") }, { id: "criteria", label: t("filter.answers") }]} /></div> : null}
        {/* Its margin and padding give the pills' focus rings room inside the box that cuts what runs past it. */}
        <FadeRow scrolls scrollbar="none" className="-m-1 flex flex-1 items-center gap-2 p-1 *:shrink-0">{filters(trigger)}</FadeRow>
        <div className="shrink-0">{sorter(trigger)}</div>
      </div>

      {/* A filter by how someone else voted can't count the votes hidden from the person looking: it says how many it leaves out, as the Overview and the files do. */}
      {open.keepsVotes && who && who !== open.me && screening.reviewers.find((one) => one.id === who)?.tally?.kept && (DECISIONS as readonly string[]).includes(voted) ? <div className="px-4 pb-3 sm:px-6"><ShutNote by="vote">{t("hiddenLeftOut")}</ShutNote></div> : null}
      {/* What narrows the list, each a chip that takes it away, and one press that takes them all. On a phone this is where the filters show. */}
      {active.length ? (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 @max-2xl/papers:pt-3 sm:px-6">
          {active.map((one) => (
            <span key={one.key} className="contents">
              <Button variant="secondary" size="xs" className="h-6 max-w-full gap-1 rounded-md bg-primary/10 pe-1 text-xs font-medium text-primary hover:bg-primary/15" aria-label={t("chip.remove", { label: one.label })} onClick={() => go(one.clear)}>
                <span className="flex min-w-0 items-center gap-1 truncate [&_.text-muted-foreground]:text-current [&_.text-muted-foreground]:opacity-70">{"shown" in one && one.shown ? one.shown : one.label}</span><X className="size-3.5 opacity-70" />
              </Button>
              {"fact" in one && one.fact ? <Chip>{one.fact}</Chip> : null}
            </span>
          ))}
          <Button variant="ghost" size="xs" className="h-6 text-xs" onClick={clearFilters}><X />{t("chip.clearFilters")}</Button>
        </div>
      ) : null}

      <Sheet open={filtering} onOpenChange={setFiltering}>
        <SheetContent side="bottom" className="gap-0 p-0 @2xl/papers:hidden">
          <SheetHeader className="border-b border-border-subtle px-4 py-3"><SheetTitle>{t("filters")}</SheetTitle><SheetDescription className="sr-only">{t("filtersSays")}</SheetDescription></SheetHeader>
          <div className="grid gap-2 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] [&>[data-slot=select-trigger]]:w-full [&>[data-slot=select-trigger]]:max-w-none [&>[data-slot=select-trigger]]:justify-start [&>[data-slot=select-trigger]>svg:last-child]:ms-auto">
            {filters("h-10 text-sm")}
            {sorter("h-10 text-sm")}
            <Button variant="outline" className="mt-2" onClick={() => setFiltering(false)}>{total === undefined ? t("showPapers") : t("showCount", { count: total })}</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* What can be done with the selected papers. It floats over the foot of the window, so selecting a row moves no row. */}
      <AnimatePresence>
        {chosen.length ? (
          <motion.div key="chosen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2, ease: EASE }} className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4 max-lg:bottom-24">
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-border-subtle bg-card px-3 py-2 shadow-lg">
              <span className="px-1 text-sm font-medium tabular-nums">{t("selection.selected", { count: chosen.length })}</span>
              {/* Every paper on the page is selected and the table has more pages: the rest are one press away. */}
              {allShown && listed.hasPages && (total === undefined || chosen.length < total) ? <Button variant="outline" size="sm" className="h-7" disabled={takingAll} onClick={selectAll}>{takingAll ? <Spinner className="size-3.5" /> : null}{total === undefined ? t("selection.everyPage") : t("selection.all", { count: total })}</Button> : null}
              {/* A vote on the papers that wait for yours, and settling the ones in conflict: the same three buttons, Exclude asking why. */}
              {votablePicked.length ? decideAll(t("selection.voteAs", { count: votablePicked.length }), votablePicked.length, voteAll) : null}
              {/* Picked papers none of which waits for the person's vote say so, where the vote buttons would be. */}
              {open.isReviewer && !screening.finishedAt && votablePicked.length < pickedPapers.length && !(votablePicked.length === 0 && open.canResolve && conflictsPicked.length) ? <span className="text-xs text-muted-foreground">{votablePicked.length ? t("selection.notYours", { count: pickedPapers.length - votablePicked.length }) : t("selection.noneYours", { count: pickedPapers.length })}</span> : null}
              {conflictsPicked.length && open.canResolve && !screening.finishedAt ? decideAll(t("selection.settleAs", { count: conflictsPicked.length }), conflictsPicked.length, settleAll) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-7"><Download />{t("export")}</Button></DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end">
                  <DropdownMenuItem onSelect={() => exportPicked("ris")}>{t("selection.ris")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => exportPicked("csv")}>{pickedPapers.some((one) => !one.sees) ? t("selection.csvSeen") : t("selection.csvAll")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setPicked([])}>{t("selection.clear")}</Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid border-t border-border-subtle">
        <div ref={list} className="@container/table min-w-0">
          {/* A full page's height while there are pages, so a short last page doesn't move the pager. The table scrolls sideways only where it can't fit, which would stop its head row sticking. */}
          {/* While the page is read it keeps the height of the rows it will hold, as many as the filter counts up to a page; what is left over slides. */}
          <AutoHeight>
          <Wide fits={fits} style={{ minHeight: listed.isLoading ? (Math.min(total ?? PAGE, PAGE) + 2) * ROW : listed.hasPages ? (PAGE + 2) * ROW : undefined }} className={cn("transition-opacity", listed.isStale && "pointer-events-none opacity-60")}>
            {listed.isLoading ? (
              <>
                {/* The table's two head rows, then as many rows as the page will hold. */}
                <div aria-hidden style={{ height: 2 * ROW }} className="border-b border-border-subtle @max-2xl/papers:hidden" />
                <ListRowsSkeleton rows={Math.min(total ?? PAGE, PAGE)} height={ROW} icon={false} label={t("table.loading")} className="w-[100cqw] px-2" />
              </>
            ) : shown.length ? (
              <>
                {/* As wide as the column and no wider: the frame around it scrolls sideways for the table, and would let a long title stretch the list. */}
                <ul className="w-[100cqw] divide-y divide-border-subtle @2xl/papers:hidden">
                  {shown.map((one) => {
                    const isOpen = paper?.id === one.id;
                    return (
                      <li key={one.id} data-paper={one.id} className={cn("flex gap-3 px-4 py-3 transition-colors", isOpen && "bg-muted")}>
                        <Checkbox className="mt-0.5" checked={chosen.includes(one.id)} onCheckedChange={() => pickOne(one)} aria-label={t("table.select", { title: one.title })} />
                        <button type="button" aria-expanded={isOpen} onClick={() => (isOpen ? close() : show(one.id))} className="block min-w-0 flex-1 space-y-2 text-start outline-none focus-visible:underline">
                          <span dir="auto" className="line-clamp-2 text-sm font-medium">{one.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{bylineOf(one)}</span>
                          <span className="flex items-start gap-2">
                            {/* The marks stand without names here: your own is ringed, as your face is where faces stand without names. A large team's wrap onto a second line, and the result keeps its place at the end of the first. */}
                            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                              {castOf(screening, one).map(({ reviewer: r, vote, failed, hidden }) => <VoteMark key={r.id} vote={vote} failed={failed} settled={Boolean(settledOf(one).final)} hidden={hidden} who={r.id === open.me ? words.t("you") : r.name} className={r.id === open.me ? "ring-2 ring-primary/70 ring-offset-1 ring-offset-card" : undefined} />)}
                            </span>
                            <ResultChip result={one.result} className="shrink-0" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <table className="w-full table-fixed text-sm @max-2xl/papers:hidden" style={{ minWidth: `${tableWidth}rem` }}>
                  <TableHeader className={cn("z-10 bg-card shadow-[0_1px_0_var(--color-border-subtle)] [&_tr]:border-b-0", fits && cn("sticky", UNDER_FRAME))}>
                    <TableRow className="hover:bg-transparent">
                      <TableHead rowSpan={2} className="w-12 ps-4 sm:ps-6">
                        <Checkbox checked={allShown ? true : shown.some((one) => chosen.includes(one.id)) ? "indeterminate" : false} onCheckedChange={() => setPicked(allShown ? pickedPapers.filter((p) => !shown.some((one) => one.id === p.id)) : [...pickedPapers, ...shown.filter((one) => !chosen.includes(one.id))])} aria-label={t("table.selectPage")} />
                      </TableHead>
                      <TableHead rowSpan={2} aria-sort={sort === "title" ? "ascending" : sort === "title-desc" ? "descending" : "none"}>
                        {sortHead(t("table.paper"), sort === "title" || sort === "title-desc", sort === "title" ? "title-desc" : "title", sort === "title-desc")}
                      </TableHead>
                      <TableHead colSpan={columns === "criteria" ? criteria.length : reviewers.length} className="h-8 px-1 pt-2 text-center" style={{ width: `${columns === "criteria" ? criteria.length * 4.5 : reviewers.length * reviewerWidth}rem` }}>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          {columns === "criteria" ? t("table.answers") : t("table.votes")}
                          {columns === "criteria" ? (
                            <Help title={t("table.answers")} side="bottom">
                              <p>{t("answersHelp.says")}</p>
                              <Legend>
                                <LegendRow mark={<AnswerMark answer="yes" label={t("answersHelp.yes")} />}>{t("answersHelp.yesSays")}</LegendRow>
                                <LegendRow mark={<AnswerMark answer="no" label={t("answersHelp.no")} />}>{t("answersHelp.noSays")}</LegendRow>
                                <LegendRow mark={<AnswerMark answer="unclear" label={t("answersHelp.unclear")} />}>{t("answersHelp.unclearSays")}</LegendRow>
                                <LegendRow mark={<DifferMark />}>{t("answersHelp.differ")}</LegendRow>
                              </Legend>
                            </Help>
                          ) : (
                            <VoteMarksHelp blind={blindOf(screening, open.invited)}>{t("marksInTable")}</VoteMarksHelp>
                          )}
                        </span>
                      </TableHead>
                      <TableHead rowSpan={2} className={cn("w-52 ps-6", reasonHidden)}>
                        <span className="inline-flex items-center gap-1">
                          {t("table.reason")}
                          <Help title={t("table.reason")} side="bottom" facts={<><HelpFact>{t("reasonHelp.includedOnly")}</HelpFact><HelpFact>{t("reasonHelp.mostCommon")}</HelpFact>{screening.scoring.stars.length ? <HelpFact>{t("reasonHelp.stars", { count: screening.scoring.stars.length, points: screening.scoring.stars.map(words.num).join(", ") })}</HelpFact> : null}</>}>
                            <p>{t("reasonHelp.says")}</p>
                            <p>{t("reasonHelp.points", { canChange: String(open.canChange), workspace: screening.workspace.name })}</p>
                          </Help>
                        </span>
                      </TableHead>
                      <TableHead rowSpan={2} aria-sort={sort === "result" ? "ascending" : "none"} className={cn("text-end", lastCell, !fits && "sticky end-0 bg-card")}>
                        {sortHead(t("table.result"), sort === "result", sort === "result" ? null : "result")}
                      </TableHead>
                    </TableRow>
                    <TableRow className="border-b-0 hover:bg-transparent">
                      {columns === "reviewers"
                        ? reviewers.map((one) => (
                            <TableHead key={one.id} className="h-auto px-0 pb-2 text-center align-top">
                              <DropdownMenu>
                                <TooltipHint label={votesBy(pieces, one, open.me)}>
                                  <DropdownMenuTrigger asChild>
                                    <button type="button" aria-label={votesBy(pieces, one, open.me)} className="mx-auto flex w-full flex-col items-center gap-1 rounded-md py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted">
                                      <ReviewerMark reviewer={one} you={one.id === open.me} />
                                      {/* Each head opens a menu of that reviewer's votes, and says so with the arrow a menu has. */}
                                      <span className="flex max-w-full items-center gap-0.5 px-0.5 text-2xs font-normal text-muted-foreground"><span className="truncate">{/* The column is narrow: a first word under the face, with the whole name in its menu and its tooltip. */}{one.id === open.me ? words.t("you") : (words.twinEffort(one) ?? words.firstName(one.name))}</span><ChevronDown aria-hidden className="size-3 shrink-0 opacity-70" /></span>
                                    </button>
                                  </DropdownMenuTrigger>
                                </TooltipHint>
                                <DropdownMenuContent align="center" className="w-auto min-w-60 [&_[role=menuitem]]:whitespace-nowrap">
                                  <DropdownMenuLabel><ReviewerName reviewer={one} you={one.id === open.me} /></DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  {/* Only the lists that hold papers: a way of voting they never used, or one kept from you, would open empty. */}
                                  {DECISIONS.filter((decision) => !one.tally || (!one.tally.kept && one.tally[decision] > 0)).map((decision) => {
                                    const Icon = RESULT_STYLE[decision].icon;
                                    return (
                                      <DropdownMenuItem key={decision} asChild>
                                        <NextLink href={papersHref(id, { reviewer: one.id, voted: decision })}><Icon />{t("menu.papersVoted", { you: String(one.id === open.me), name: shortName(one), decision: words.decision(decision) })}</NextLink>
                                      </DropdownMenuItem>
                                    );
                                  })}
                                  {!one.tally || one.tally.waiting > 0 ? <DropdownMenuItem asChild><NextLink href={papersHref(id, { reviewer: one.id, voted: "none" })}><ListChecks />{t("menu.papersWaiting", { you: String(one.id === open.me), name: shortName(one) })}</NextLink></DropdownMenuItem> : null}
                                  {/* A model's papers it couldn't read are a list of their own, as its row on the Overview opens them. */}
                                  {one.tally?.failed ? <DropdownMenuItem asChild><NextLink href={papersHref(id, { reviewer: one.id, voted: "failed" })}><TriangleAlert />{words.t("noVote.failed")}</NextLink></DropdownMenuItem> : null}
                                  {one.tally && !one.tally.waiting && !one.tally.failed && (one.tally.kept || DECISIONS.every((decision) => !one.tally![decision])) ? <DropdownMenuItem disabled><Hourglass />{one.tally.kept ? words.t("hiddenWhileToDo") : words.t("noVote.yet")}</DropdownMenuItem> : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableHead>
                          ))
                        : criteria.map((criterion) => (
                            <TableHead key={criterion.key} className="h-auto px-0.5 pb-2 text-center align-bottom whitespace-normal">
                              <QuestionName question={questionOf(criterion.key, criteria)} label={criterion.short} className="line-clamp-2 text-2xs leading-4 font-medium" />
                            </TableHead>
                          ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="border-t border-border-subtle">
                    {shown.map((one) => {
                      const cast = castOf(screening, one);
                      const state = settledOf(one);
                      const waitsForMe = open.isReviewer && !screening.finishedAt && !state.final && cast.some((entry) => entry.reviewer.id === open.me && !entry.vote && !entry.failed);
                      const isOpen = paper?.id === one.id;
                      return (
                        <TableRow key={one.id} data-paper={one.id} data-state={isOpen ? "selected" : undefined} className="cursor-pointer border-border-subtle" style={{ height: ROW }} onClick={() => (isOpen ? close() : show(one.id))}>
                          <TableCell className="ps-4 sm:ps-6" onClick={(event) => event.stopPropagation()}>
                            <Checkbox checked={chosen.includes(one.id)} onCheckedChange={() => pickOne(one)} aria-label={t("table.select", { title: one.title })} />
                          </TableCell>
                          <TableCell className="py-2 whitespace-normal">
                            <button type="button" aria-expanded={isOpen} className="block w-full min-w-0 text-start outline-none focus-visible:underline">
                              <span dir="auto" className="line-clamp-2 text-sm font-medium leading-5">
                                {one.title}
                                {one.batch !== undefined && one.batch === newest ? <StateChip tone="primary" className="ms-2 h-5 align-[1px] px-1.5 text-2xs">{t("table.new")}</StateChip> : null}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">{bylineOf(one)}</span>
                            </button>
                          </TableCell>
                          {columns === "reviewers"
                            ? reviewers.map((r) => {
                                const theirs = cast.find((entry) => entry.reviewer.id === r.id);
                                return <TableCell key={r.id} className="px-0 text-center">{theirs ? <VoteMark vote={theirs.vote} failed={theirs.failed} settled={Boolean(state.final)} hidden={theirs.hidden} who={r.id === open.me ? words.t("you") : r.name} className="align-middle" /> : null}</TableCell>;
                              })
                            : criteria.map((criterion) => {
                                const given = [...new Set(cast.flatMap((entry) => entry.vote?.answers[criterion.key] ?? []))];
                                return (
                                  <TableCell key={criterion.key} className="px-1 text-center">
                                    {given.length === 1 ? <span className="inline-flex align-middle"><AnswerMark answer={given[0]!} label={criterion.short} /></span> : given.length > 1 ? <DifferMark label={t("table.differOn", { name: criterion.short })} /> : null}
                                  </TableCell>
                                );
                              })}
                          <TableCell className={cn("ps-6", reasonHidden)} onClick={(event) => (event.target as HTMLElement).closest("a") && event.stopPropagation()}>
                            <Why paper={one} open={open} reasonKey={reasonKey(one)} />
                          </TableCell>
                          <TableCell className={cn("text-end", lastCell, !fits && "sticky end-0 bg-card")} onClick={(event) => (event.target as HTMLElement).closest("a") && event.stopPropagation()}>
                            <span className="inline-flex items-center gap-1.5">
                              {/* A result a person settled, against the votes, carries their face: it opens what they settled. */}
                              {state.resolvedBy ? (
                                <TooltipHint label={t("settledBy", { you: String(state.resolvedBy === open.me), name: words.nameOn(open.screening, state.resolvedBy) })}>
                                  <NextLink href={narrow({ reviewer: state.resolvedBy, voted: "settled" }).href} aria-current={narrow({ reviewer: state.resolvedBy, voted: "settled" })["aria-current"]} aria-label={t("settledBy", { you: String(state.resolvedBy === open.me), name: words.nameOn(open.screening, state.resolvedBy) })} className="flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                                    <IdentityAvatar name={words.nameOn(open.screening, state.resolvedBy)} imageUrl={personIn(screening, state.resolvedBy)?.imageUrl} className="size-5" />
                                  </NextLink>
                                </TooltipHint>
                              ) : null}
                              {waitsForMe ? (
                                <Button asChild size="xs" className="h-6"><NextLink href={screenHref(id, { paper: one.id })}>{t("table.vote")}<ChevronRight /></NextLink></Button>
                              ) : (
                                <ResultChip result={state.result} />
                              )}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
              </>
            ) : (
              <ListEmpty
                icon={Layers}
                action={anyFilter ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {/* Where more of the list is still to read, nothing found yet is said as such, with the way on, as Screen says it. */}
                    {listed.canNext ? <Button variant="outline" size="sm" onClick={() => listed.next()}>{screenWords("queue.readFurther")}</Button> : null}
                    <Button variant="outline" size="sm" onClick={clearFilters}>{t("chip.clearFilters")}</Button>
                  </div>
                ) : (
                  <>
                    {/* Nothing has got this far, and the papers that could are still short of a vote or split: each count opens them. */}
                    {filter === "include" || filter === "maybe" || filter === "exclude" ? (
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {(["waiting", "conflict"] as const).map((result) => (open.counts[result] ? <LinkChip key={result} href={papersHref(id, { result })} tone={RESULT_STYLE[result].tone} icon={RESULT_STYLE[result].icon}>{t(`table.stillOpen.${result}`, { count: open.counts[result] })}</LinkChip> : null))}
                      </div>
                    ) : null}
                  </>
                )}
              >
                {anyFilter ? (listed.canNext ? screenWords("queue.noMatchYet") : t("table.noMatch")) : words.empty(filter, Boolean(screening.finishedAt))}
              </ListEmpty>
            )}
          </Wide>
          </AutoHeight>
          {listed.hasPages ? <CommandCenterPagination className="border-t border-border-subtle p-4 sm:px-6" currentPage={listed.page} itemLabel={t("table.pageItems")} steps={{ canPrevious: listed.canPrevious, canNext: listed.canNext, onPrevious: () => { listed.previous(); top.current?.scrollIntoView({ block: "start" }); }, onNext: () => { listed.next(); top.current?.scrollIntoView({ block: "start" }); }, offset: listed.offset, shown: shown.length, total, ...(total === undefined ? {} : { pageCount: Math.ceil(total / PAGE) }) }} /> : null}
        </div>

      </div>
      {/* The paper opens in a drawer at the window's side, from its top to its foot, and scrolls there on its own: the place a record's details open in most products with a table. It never sits in the page, under the filters, where how much of it shows would depend on how far the page is scrolled. */}
      <Sheet open={Boolean(paper)} onOpenChange={(next) => !next && close()}>
        {/* It opens with the focus on itself, so no button's tooltip covers the paper's title. */}
        {/* Escape in the field where another reason is written goes back to the reasons, as its Back button shows: it doesn't close the paper. */}
        <SheetContent data-paper-drawer showCloseButton={false} onOpenAutoFocus={focusContent} onEscapeKeyDown={(event) => { if ((event.target as HTMLElement | null)?.closest("[data-reason-note]")) event.preventDefault(); }} className={`w-full gap-0 p-0 outline-none sm:max-w-lg xl:max-w-xl ${AVATARS_FADE_IN}`}>
          <SheetTitle className="sr-only">{paper?.title ?? t("panel.paper")}</SheetTitle>
          <SheetDescription className="sr-only">{t("panel.says")}</SheetDescription>
          {/* Each paper has its own scroll, so the next one starts at its title and not where the last was left. */}
          {/* The paper before stays while the one asked for is read, dimmed and out of reach: a vote can only go to the paper the address names. */}
          {paper ? <ScrollArea key={paper.id} shades inert={stale} className={cn("min-h-0 flex-1 transition-opacity", stale && "opacity-55")}><PaperPanel paper={paper} open={open} notes={notes[paper.id] ?? {}} setNotes={(update) => setNotes((all) => ({ ...all, [paper.id]: update(all[paper.id] ?? {}) }))} talk={talks[paper.id]} onTalk={(update) => setTalks((all) => ({ ...all, [paper.id]: update(all[paper.id] ?? { text: "", asking: null }) }))} onClose={close} place={{ at: at >= 0 ? listed.offset + at : -1, of: total }} onStep={(by) => void step(by)} canStep={canStep} /></ScrollArea> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The mark for a criterion its reviewers answered differently. In no result's colour: answers that differ are not a paper in conflict. */
function DifferMark({ label }: { label?: string }) {
  const t = useTranslations("screening.papers");
  return (
    <span role="img" aria-label={label ?? t("answersHelp.differ")} className="inline-flex size-6 items-center justify-center rounded-md bg-foreground/[0.07] align-middle text-foreground">
      <AnswersDiffer aria-hidden className="size-3.5" />
    </span>
  );
}

function Legend({ children }: { children: ReactNode }) {
  return <div className="space-y-1.5 pt-1 text-foreground">{children}</div>;
}
function LegendRow({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  // A row that wraps keeps its mark on the first line.
  return <p className="flex items-start gap-2.5 [&>:first-child]:mt-px [&>:first-child]:shrink-0">{mark}{children}</p>;
}

/** What each vote mark means, over the table's columns and beside a phone's search. `children` says where the marks are. */
function VoteMarksHelp({ blind, children, className }: { /** How the screening hides the others' votes until you vote (./data.ts `blindOf`). */ blind: Blind; children: ReactNode; className?: string }) {
  const t = useTranslations("screening.papers");
  const words = useWords();
  return (
    <Help title={t("marks.title")} side="bottom" className={className}>
      <p>{children}</p>
      {blindSays(words, blind) ? <p>{blindSays(words, blind)}</p> : null}
      <Legend>
        {DECISIONS.map((decision) => <LegendRow key={decision} mark={<VoteMark vote={{ decision }} who={t("marks.aReviewer")} />}>{t("marks.voted", { decision: words.decision(decision) })}</LegendRow>)}
        {blind === "all" || blind === "people" ? <LegendRow mark={<VoteMark vote={{ decision: "include" }} hidden who={t("marks.aReviewer")} />}>{blind === "people" ? t("marks.peopleHidden") : t("marks.hidden")}</LegendRow> : null}
        <LegendRow mark={<VoteMark who={t("marks.aReviewer")} />}>{words.t("noVoteSays.yet")}</LegendRow>
        <LegendRow mark={<VoteMark settled who={t("marks.aReviewer")} />}>{words.t("noVoteSays.none")}</LegendRow>
        <LegendRow mark={<VoteMark failed who={t("marks.aModel")} />}>{words.t("noVoteSays.failed")}</LegendRow>
        <LegendRow mark={<span className="size-6" />}>{t("marks.empty")}</LegendRow>
      </Legend>
    </Help>
  );
}

/** A link inside a row, which opens what it names rather than the row's paper. */
/** The table's frame. It scrolls sideways only where the table can't fit: a frame that scrolls would stop the head row sticking to the page. */
function Wide({ fits, style, className, children }: { fits: boolean; style: CSSProperties; className?: string; children: ReactNode }) {
  return fits ? <div style={style} className={className}>{children}</div> : <ScrollArea axis="x" shades style={style} className={className}>{children}</ScrollArea>;
}

const REASON_LINK = "rounded-sm outline-none decoration-muted-foreground/50 underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50";

/** What put a paper where it stands: the criterion it failed, how its reviewers split, or whose vote it waits for. Each opens the papers it names. */
function Why({ paper, open, reasonKey }: { paper: Paper; open: Open; reasonKey?: string }) {
  const t = useTranslations("screening.papers");
  const words = useWords();
  const id = open.screening.id;
  const narrow = useNarrow(id, open.me);
  const state = settledOf(paper);
  const visible = paper.sees;
  const entries = castOf(open.screening, paper);
  const cast = entries.flatMap((one) => one.vote ?? []);
  if (state.result === "waiting") {
    const missing = awaitedOn(open.screening, paper).sort((a, b) => Number(b.id === open.me) - Number(a.id === open.me));
    // Someone invited who hasn't joined holds a place the rule waits for, with no face to show yet.
    const invited = invitedSaid(words, open.screening, paper, open.invited);
    const invitedSays = invited.length ? <TooltipHint label={words.listed(invited)} onlyWhenClipped><span className="min-w-0 truncate">{words.listed(invited)}</span></TooltipHint> : null;
    if (!missing.length) return <span className="flex items-center gap-2 text-xs text-muted-foreground">{invited.length ? <>{open.screening.finishedAt ? t("why.noVoteFrom") : t("why.waitingOn")}{invitedSays}</> : t("why.nobodyCanVote")}</span>;
    const mine = missing[0]!.id === open.me;
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {/* Once it is finished nobody is waited on: the line says who cast no vote. */}
        <span className={cn("shrink-0", mine && !open.screening.finishedAt && "font-medium text-primary")}>{open.screening.finishedAt ? t("why.noVoteFrom") : mine ? t("why.waitingOnYou") : t("why.waitingOn")}</span>
        <Faces
          reviewers={missing}
          me={open.me}
          linkOf={(one) => {
            const link = narrow({ reviewer: one.id, voted: "none" });
            return { href: link.href, on: link.on, says: t(link.on ? "menu.stopPapersWaiting" : "menu.papersWaiting", { you: String(one.id === open.me), name: one.name }) };
          }}
        />
        {invitedSays}
      </span>
    );
  }
  // What whoever settled it wrote down, beside the votes they settled: the reason a settled paper has.
  const settledNote = state.resolvedBy && state.note ? <TooltipHint label={state.note} onlyWhenClipped><span className="min-w-0 truncate text-xs text-muted-foreground">{words.quoted(state.note)}</span></TooltipHint> : null;
  if (!visible) return settledNote;
  if (state.result === "conflict" || state.resolvedBy) return <span className="flex min-w-0 items-center gap-2"><Tally votes={cast} className="shrink-0" />{settledNote}</span>;
  if (reasonKey && (state.result === "exclude" || state.result === "maybe")) {
    const label = state.result === "exclude" ? words.failed(reasonKey, reasonCriteria(open.screening)) : words.unclear(reasonKey, reasonCriteria(open.screening));
    // Pressed again while the table is narrowed to this reason, it takes the reason away and keeps the result.
    const link = narrow({ result: state.result, reason: reasonKey }, ["reason"]);
    // Another reason is what its voter wrote: it stands beside the reason, as a settled paper's note does.
    const written = reasonKey === OTHER_REASON ? cast.find((vote) => vote.reason === OTHER_REASON && vote.note)?.note : undefined;
    if (written) return <span className="flex min-w-0 items-center gap-2"><NextLink href={link.href} aria-current={link["aria-current"]} className={cn("shrink-0 text-xs", link.on ? "font-medium text-foreground" : "text-muted-foreground", REASON_LINK)}><Reason reason={reasonKey} criteria={reasonCriteria(open.screening)} /></NextLink><TooltipHint label={written} onlyWhenClipped><span className="min-w-0 truncate text-xs text-muted-foreground">{words.quoted(written)}</span></TooltipHint></span>;
    return (
      <QuestionHint question={questionOf(reasonKey, reasonCriteria(open.screening), "label")} label={label}>
        {/* An excluded paper's reason narrows the table to it. A Maybe's unclear criterion names why and opens nothing: the list narrows by exclusion reasons only, and a link to it would open empty. */}
        {state.result === "exclude" ? (
          <NextLink href={link.href} aria-current={link["aria-current"]} className={cn("block truncate text-xs", link.on ? "font-medium text-foreground" : "text-muted-foreground", REASON_LINK)}><Reason reason={reasonKey} criteria={reasonCriteria(open.screening)} /></NextLink>
        ) : (
          <span className="block truncate text-xs text-muted-foreground"><Reason reason={reasonKey} criteria={reasonCriteria(open.screening)} unclear /></span>
        )}
      </QuestionHint>
    );
  }
  // An included paper carries the stars its answers earn, as it is saved with them.
  const score = state.result === "include" && paper.points !== undefined ? { points: paper.points, stars: paper.stars ?? 0, of: pointsMax(open.screening) } : null;
  return score ? <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground"><Stars count={score.stars} />{t("pointsOf", { points: score.points, max: score.of })}</span> : null;
}

/** The drawer's own scroll is the outside system: a step that opens low in it is brought into view once, as it is first drawn. Kept outside the panel so it is the same function on every draw: one made anew each draw would be called again whenever a model reads on, and pull the drawer back. */
const intoView = (part: HTMLElement | null) => part?.scrollIntoView({ block: "nearest", behavior: "smooth" });

/** The reasons a paper is excluded for, with a note. "Another reason" needs the note written. */
function ReasonPicker({ criteria, many = false, note: given, onNote, onPick, onBack }: { criteria: Criterion[]; /** The reason is for several papers picked together. */ many?: boolean; /** The note the step before already holds. */ note?: string; onNote?: (note: string) => void; onPick: (reason: string, note?: string) => void; onBack?: () => void }) {
  const t = useTranslations("screening.papers");
  const screen = useTranslations("screening.screen");
  const words = useWords();
  const [own, setOwn] = useState("");
  // "Another reason" is written down, as on Screen: the field opens in place of the reasons, Enter excludes and Escape goes back.
  const [writing, setWriting] = useState(false);
  const note = given ?? own;
  const setNote = onNote ?? setOwn;
  if (writing) {
    return (
      <form data-reason-note className="space-y-2" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setWriting(false); } }} onSubmit={(event) => { event.preventDefault(); if (note.trim()) onPick(OTHER_REASON, note.trim()); }}>
        {/* Escape anywhere in the note's form goes back to the reasons, as its Back button shows, and never closes what it sits in. */}
        <ReasonNoteField value={note} onChange={setNote} className="bg-card" />
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-9 rounded-xl" onClick={() => setWriting(false)}>{t("back")}<Kbd className="pointer-coarse:hidden">Esc</Kbd></Button>
          <Button type="submit" variant="destructive" className="h-9 rounded-xl" disabled={!note.trim()}><X />{words.decision("exclude")}<Kbd className="pointer-coarse:hidden border-current/30 bg-transparent text-current">↵</Kbd></Button>
        </div>
      </form>
    );
  }
  return (
    // Escape goes back from the reasons, as from the note's form, and never closes what they sit in: the drawer lets a key from inside `data-reason-note` through, and the first reason, which has the focus, passes it up here.
    <div data-reason-note={onBack ? "" : undefined} className="space-y-2" onKeyDown={onBack ? (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onBack(); } } : undefined}>
      <ReasonRows criteria={criteria} many={many} onPick={(reason) => (reason === OTHER_REASON && !note.trim() ? setWriting(true) : onPick(reason, note.trim() || undefined))} />
      {onBack ? <Button variant="ghost" size="sm" className="w-full" onClick={onBack}>{t("back")}<Kbd className="pointer-coarse:hidden">Esc</Kbd></Button> : null}
    </div>
  );
}

/** A note for a vote and one for a result, as written in the drawer and not yet saved. */
type PaperNotes = Partial<Record<"vote" | "result", string>>;

/** One paper beside the table: what it says, who voted what on each criterion and when, your own vote where it is yours to give, and the final decision when they disagree. */
function PaperPanel({ paper, open, notes, setNotes, talk, onTalk, onClose, onStep, canStep, place }: { paper: Paper; open: Open; notes: PaperNotes; setNotes: (update: (now: PaperNotes) => PaperNotes) => void; talk: DiscussionDraft | undefined; onTalk: (update: (now: DiscussionDraft) => DiscussionDraft) => void; onClose: () => void; onStep: (by: 1 | -1) => void; canStep: { previous: boolean; next: boolean }; /** Where it is in the list, and how many the list holds where that is counted. */ place: { at: number; of?: number } }) {
  const t = useTranslations("screening.papers");
  const words = useWords();
  const pieces = useTranslations("screening.pieces");
  const screen = useTranslations("screening.screen");
  const { screening } = open;
  const id = screening.id;
  // A finished screening takes no vote and settles nothing until it is reopened: the panel says so where its buttons were.
  const finished = screening.finishedAt !== undefined;
  const narrow = useNarrow(id, open.me);
  const [shown, setShown] = useState<{ reviewer: string; criterion: string } | null>(null);
  // What is being decided in the panel: your own vote, or the paper's result. Excluding asks for the reason first.
  const [deciding, setDeciding] = useState<"vote" | "result" | null>(null);
  const [reasonFor, setReasonFor] = useState<"vote" | "result" | null>(null);
  // A note for your vote and one for the paper's result, apart: someone who both reviews it and settles it writes each in its own place, as on Screen.
  // Each starts as what is saved, your vote's note or the result's, until it is written in (`notes`, which Papers keeps for each paper): a vote changed here keeps its note, as on Screen.
  // A vote just sent shows as cast until the server's answer comes, so the drawer never shows the vote before it.
  const [sent, setSent] = useState<{ paper: string; decision: Decision; reason?: string } | null>(null);
  const setNote = (kind: "vote" | "result", text: string) => setNotes((all) => ({ ...all, [kind]: text }));
  const state = settledOf(paper);
  const visible = paper.sees;
  const cast = youFirst(castOf(screening, paper), open.me);
  const saved = voteOn(paper, open.me);
  const mine = sent?.paper === paper.id ? ({ ...saved, decision: sent.decision, reason: sent.reason } as NonNullable<typeof saved>) : saved;
  const noteOf = (kind: "vote" | "result") => notes[kind] ?? (kind === "vote" ? (mine?.note ?? "") : (state.resolvedBy ? (state.note ?? "") : ""));
  const isMine = cast.some((one) => one.reviewer.id === open.me);
  const quoting = shown ? cast.find((one) => one.reviewer.id === shown.reviewer && one.vote) : undefined;
  const quotedCriterion = shown && quoting ? screening.criteria.find((c) => c.key === shown.criterion) : undefined;
  const shut = votesShutOf(visible, cast);
  const blind = blindOf(screening, open.invited);
  // The words the criteria mark, as Screen marks them: the drawer is a place people vote too.
  const terms = open.screening.criteria.flatMap((criterion) => criterion.terms);
  // The sentence marked in the abstract: the one a model named for the answer of its that is open.
  const quoted = quotedCriterion && quoting?.reviewer.kind === "model" ? (quoting.vote?.passages?.[quotedCriterion.key] ?? -1) : -1;
  const sentences = sentencesOf(paper.abstract);
  const source = screening.sources.find((one) => one.id === paper.source);
  // The paper's two chips that narrow the table: each shows when it does, and takes it away on a second press.
  const added = paper.batch !== undefined ? narrow({ added: paper.batch }) : null;
  const from = source ? narrow({ source: source.id }) : null;
  const failed = cast.filter((one) => one.failed);
  const score = state.result === "include" && paper.points !== undefined ? { points: paper.points, stars: paper.stars ?? 0, of: pointsMax(screening) } : null;
  // The reviewers the paper still waits for: who an override settles it without.
  const awaited = awaitedOn(screening, paper);
  const settle = (kind: "vote" | "result", decision: Decision, reason?: string, withNote?: string) => {
    const said = withNote ?? (noteOf(kind).trim() || undefined);
    // Saved at once, with a way back, as a vote on Screen and a settling over a selection have: what stood before is put back. Refused, the toast that said it was done goes, and the note written comes back to be sent again.
    const typed = noteOf(kind);
    // Refused, the editor the vote came from opens again with what was written, so nothing is written twice.
    const wasOpen = deciding === kind;
    // The note sent comes back where it was left as sent, or emptied by the save: a newer one written meanwhile stays.
    const refused = (error: unknown) => { toast.dismiss(shownToast); setNotes((all) => (all[kind] === undefined || all[kind] === typed ? { ...all, [kind]: typed } : all)); if (wasOpen) setDeciding(kind); notSaved(t, error); };
    // What was written is what is saved once the server has it: the field then shows the saved note, so the next change keeps it too.
    // A note changed again while the vote was being saved is kept: only the one sent gives way to the saved note.
    const done = () => { setSent(null); setNotes(({ [kind]: now, ...rest }) => (now === undefined || now === typed ? rest : { ...rest, [kind]: now })); };
    const failed = (error: unknown) => { setSent(null); refused(error); };
    // When the server stamped it: Undo puts back what stood before only while this one still stands.
    let stamped: number | undefined;
    const stampedAt = (at: number | null) => { if (at !== null) stamped = at; done(); };
    if (kind === "vote") setSent({ paper: paper.id, decision, reason });
    // Undo waits for this save's answer, so it always names the moment it took back.
    const saving = kind === "vote" ? open.vote(paper.id, { decision, answers: { ...mine?.answers }, reason, note: said }).then(stampedAt, failed) : open.resolve(paper.id, decision, said, reason).then(stampedAt, failed);
    const undo = () => saving.then(() => {
      if (stamped === undefined) return;
      return (kind === "vote" ? open.vote(paper.id, saved ? { decision: saved.decision, answers: saved.answers, ...(saved.reason ? { reason: saved.reason } : {}), ...(saved.note ? { note: saved.note } : {}) } : null, { onlyAt: stamped }) : open.resolve(paper.id, state.resolvedBy ? (state.final ?? null) : null, state.note, state.reason, stamped)).catch((error) => notSaved(t, error));
    });
    // Undo puts back only what you did: a result someone else settled is theirs, and isn't put back in your name.
    const mayUndo = kind === "vote" || !state.resolvedBy || state.resolvedBy === open.me;
    const shownToast = toast(kind === "vote" ? t("panel.youVoted", { decision: words.decision(decision) }) : t("settledToast", { count: 1, result: words.result(decision) }), mayUndo ? { action: { label: t("undo"), onClick: () => void undo() } } : undefined);
    setDeciding(null);
    setReasonFor(null);
  };
  // Excluding asks why only where nothing says it yet, as on Screen (lib/screening/rules.ts `givenReason`).
  const exclude = (kind: "vote" | "result") => {
    const reason = givenReason(screening.criteria, mine?.answers, noteOf(kind), kind === "result");
    if (reason) settle(kind, "exclude", reason);
    else setReasonFor(kind);
  };
  const buttons = (kind: "vote" | "result") =>
    reasonFor === kind ? (
      <div ref={intoView}><ReasonPicker criteria={screening.criteria} note={noteOf(kind)} onNote={(text) => setNote(kind, text)} onPick={(reason, withNote) => settle(kind, "exclude", reason, withNote)} onBack={() => setReasonFor(null)} /></div>
    ) : (
      <div className="space-y-2">
        {/* The note wraps and grows to a few lines, as on Screen: a long one stays in view as it is written. */}
        <Textarea maxLength={NOTE_LENGTH} rows={1} value={noteOf(kind)} onChange={(event) => setNote(kind, event.target.value)} placeholder={kind === "vote" && othersRead(screening, open.me, open.invited) ? screen("note.voting") : screen("note.settling")} aria-label={screen("note.label")} className="max-h-24 min-h-8 resize-none bg-card py-1.5 text-sm max-lg:min-h-14" />
        <div className="grid grid-cols-3 gap-2">
          {DECISIONS.map((decision) => <VoteButton key={decision} decision={decision} on={kind === "vote" && mine?.decision === decision} className={kind === "vote" && mine?.decision === decision ? undefined : "bg-card"} onClick={() => (decision === "exclude" ? exclude(kind) : settle(kind, decision))} />)}
        </div>
      </div>
    );

  return (
    <div className="space-y-5 px-4 pb-6 sm:px-6">
      {/* Where it is in the list, and the way through it: it stays in view while the paper is read. */}
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-1 border-b border-border-subtle bg-card px-4 py-2.5 sm:-mx-6 sm:px-6">
        <span className="me-auto text-xs tabular-nums text-muted-foreground">{place.at >= 0 ? (place.of === undefined ? words.num(place.at + 1) : t("panel.placeOf", { at: place.at + 1, of: place.of })) : t("panel.notInList")}</span>
        <PaperStepper onStep={onStep} canPrevious={canStep.previous} canNext={canStep.next} />
        <TooltipHint label={<span className="flex items-center gap-2">{t("panel.close")}<Kbd className="pointer-coarse:hidden">Esc</Kbd></span>}><Button variant="ghost" size="icon" className="-me-2 size-7 text-muted-foreground pointer-coarse:size-10" aria-label={t("panel.close")} aria-keyshortcuts="Escape" onClick={onClose}><X /></Button></TooltipHint>
      </div>
      <div className="space-y-2">
        <h2 dir="auto" className="text-base font-semibold leading-snug">{paper.title}</h2>
        <Byline paper={paper} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ResultChip result={state.result} />
        {score ? <Chip><Stars count={score.stars} />{t("pointsOf", { points: score.points, max: score.of })}</Chip> : null}
        <PaperFacts paper={paper} source={from && source ? { name: source.name, kind: source.kind, href: from.href, on: from.on, current: from["aria-current"] } : undefined} added={added && paper.addedAt !== undefined ? { at: paper.addedAt, href: added.href, on: added.on, current: added["aria-current"] } : undefined} />
      </div>
      {paper.pdf ? <PdfRoom pages={1} shape={paper.pdf.shape}><PaperPdf id={open.screening.id} paper={paper} terms={terms} firstPage /></PdfRoom> : <p dir="auto" className="text-sm leading-6">{sentences.map((sentence, i) => <Sentence key={i} at={i} text={sentence} quoted={quoted === i} terms={terms} lit={[]} />)}</p>}

      {/* Your own vote, where the paper is yours to vote on. While it waits for you, it is the one thing here that needs you. */}
      {isMine && open.isReviewer ? (
        mine && (deciding !== "vote" || finished) ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("panel.yourVote")}</h3>
            <div className="flex items-center gap-2 text-sm">
              <VoteMark vote={mine} who={words.t("you")} />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">{t("panel.youVoted", { decision: words.decision(mine.decision) })}{mine.reason ? <ReasonChip reason={mine.reason} criteria={reasonCriteria(screening)} className="min-w-0 shrink" /> : null}</span>
              {finished || paper.withdrawn ? null : <Button variant="ghost" size="xs" onClick={() => { setDeciding("vote"); setNote("vote", noteOf("vote")); }}>{t("panel.changeIt")}</Button>}
            </div>
          </section>
        ) : finished || paper.withdrawn ? (
          <ShutNote by="reviewer">{paper.withdrawn ? screen("shut.left") : screen("shut.finished", { canChange: String(open.canChange) })}</ShutNote>
        ) : (
          <Panel tone="primary" className="space-y-2 p-3 ring-1 ring-primary/20">
            <h3 className="text-sm font-medium">{mine ? t("panel.changeVote") : state.resolvedBy === open.me ? screen("votes.settledBy", { you: "true", name: "" }) : state.final ? t("panel.settledWithoutYou") : t("panel.waitingForYou")}</h3>
            {buttons("vote")}
            {/* Changing a vote can be let go, as the override can: the vote stands as it was. */}
            {/* Or taken back, and the paper waits for the person's vote again: what a selection's Undo does, for as long as the screening runs. */}
            {mine && reasonFor !== "vote" ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setDeciding(null); setNotes(({ vote: _typed, ...rest }) => rest); void open.vote(paper.id, null, mine.at === undefined ? {} : { onlyAt: mine.at }).catch((error) => notSaved(t, error)); }}><Undo2 />{t("panel.takeBack")}</Button>
                <Button variant="ghost" size="sm" onClick={() => { setDeciding(null); setNotes(({ vote: _typed, ...rest }) => rest); }}>{t("panel.cancel")}</Button>
              </div>
            ) : null}
          </Panel>
        )
      ) : null}

      {/* A conflict that is the person looking's to settle stands here, over the votes it settles: it is what the paper needs from them, and under the votes and the discussion it was a screen away. */}
      {!finished && !state.resolvedBy && open.canResolve && state.result === "conflict" ? (
        <Panel tone="info" className="space-y-2 p-3 ring-1 ring-info/25">
          <h3 className="text-sm font-medium">{t("panel.settleConflict")}</h3>
          {buttons("result")}
        </Panel>
      ) : null}

      {/* While the rule hides the others' votes, the table is the one Screen draws: a lock where a vote is cast, the rule's chip beside the title and its reason under the table. */}
      <Section title={screen(votesTitle(screening.rule, cast))} help={<VotesHelp blind={blind} side="left" />} aside={shut.kept ? <HiddenChip blind={blind} /> : undefined}>
          <ScrollArea axis="x" shades className="rounded-2xl border border-border-subtle"><div className="p-3"><Matrix criteria={screening.criteria} cast={cast} me={open.me} hidden={shut.none} settled={Boolean(state.final)} shown={shown} onShow={setShown} passage={quoting?.vote && shown ? (quoting.reviewer.kind === "model" ? <Evidence paper={paper} reviewer={quoting.reviewer} vote={quoting.vote} criterion={screening.criteria.find((c) => c.key === shown.criterion)!} /> : <Said reviewer={quoting.reviewer} vote={quoting.vote} criterion={screening.criteria.find((c) => c.key === shown.criterion)!} criteria={screening.criteria} you={quoting.reviewer.id === open.me} />) : undefined} /></div></ScrollArea>
        {shut.kept ? <ShutNote by="vote">{VOTES_SHUT(pieces, blind, cast, open.me)}</ShutNote> : null}
        {!shut.none ? (
          <ul className="space-y-2 pt-1">
            {failed.map(({ reviewer }) => {
              const unread = reviewer.tally?.failed ?? 0;
              const retry = open.retryOf(reviewer);
              return (
                // On a phone the button goes under the name, so the name is never cut short.
                <li key={reviewer.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-xs sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                  <ReviewerMark reviewer={reviewer} className="size-5" />
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><ReviewerName reviewer={reviewer} className="font-medium" /><VoteFacts vote={undefined} failed criteria={screening.criteria} /></span>
                  {open.canChange && !open.screening.finishedAt ? <RetryRead papers={unread} cost={words.creditsOf(retry.cost)} short={retry.short ? words.creditsOf(retry.short) : undefined} onRetry={() => void open.retry(reviewer).catch((error) => notSaved(t, error))} className="justify-self-start max-sm:col-start-2" /> : null}
                </li>
              );
            })}
            {cast.filter((one) => one.vote).map(({ reviewer, vote }) => (
              <li key={reviewer.id} className="flex items-start gap-2 text-xs">
                <ReviewerMark reviewer={reviewer} className="size-5" />
                <span className="min-w-0 flex-1 space-y-1.5">
                  <ReviewerName reviewer={reviewer} you={reviewer.id === open.me} className="font-medium" />
                  <VoteFacts vote={vote} criteria={reasonCriteria(screening)} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {/* What its reviewers said to each other, where its votes show and there is something to talk over. Where a rule keeps it shut, the rule stands in its place. */}
      {visible ? <Discussion open={open} paper={paper} draft={talk} onDraft={onTalk} /> : <DiscussionShut open={open} />}

      {/* The paper's result: settled by a person where its reviewers disagree, and open to change after that. */}
      {state.resolvedBy ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IdentityAvatar name={words.nameOn(open.screening, state.resolvedBy)} imageUrl={personIn(screening, state.resolvedBy)?.imageUrl} className="size-5" />
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">{t("settledBy", { you: String(state.resolvedBy === open.me), name: words.nameOn(screening, state.resolvedBy) })}{state.reason ? <ReasonChip reason={state.reason} criteria={reasonCriteria(screening)} className="min-w-0 shrink" /> : null}{state.note ? <span className="text-muted-foreground">{words.quoted(state.note)}</span> : null}</span>
          {open.canResolve && !finished ? <Button variant="ghost" size="xs" onClick={() => void open.resolve(paper.id, null).catch((error) => notSaved(t, error))}><Undo2 />{t("panel.reopen")}</Button> : null}
        </div>
      ) : !open.canResolve || finished ? (
        state.result === "conflict" && !finished ? (
          <Panel tone="info" className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <IdentityAvatar name={words.nameOn(open.screening, screening.rule.resolver)} imageUrl={personIn(screening, screening.rule.resolver)?.imageUrl} className="size-6" />
            <span className="min-w-0 flex-1">{t("panel.waitingToSettle", { you: String(screening.rule.resolver === open.me), name: words.nameOn(screening, screening.rule.resolver) })}</span>
            <LinkChip href={papersHref(id, { result: "conflict" })} tone="info">{t("panel.everyConflict")}</LinkChip>
          </Panel>
        ) : null
      ) : state.result === "conflict" ? null : deciding === "result" ? (
        // Opened from a button at the foot of the drawer, it is brought into view: its three buttons would otherwise open under the fold.
        <section ref={intoView} className="space-y-2">
          <h3 className="flex items-center gap-1 text-sm font-medium">
            {t("panel.override")}
            <Help title={t("panel.overrideTitle")} side="left" facts={<><HelpFact>{t("panel.votesKept")}</HelpFact><HelpFact icon={Undo2}>{t("panel.canReopen")}</HelpFact></>}>
              <p>{t("panel.overrideSays")}</p>
            </Help>
          </h3>
          {/* Settling it now ends the wait for whoever has yet to vote: said before it is done (it was only seen afterwards, as their column going). */}
          {awaited.length ? <Note icon={Hourglass}>{t("panel.yetToVote", { who: awaited.every((one) => one.id === open.me) ? "you" : awaited.length === 1 ? "one" : awaited.some((one) => one.id === open.me) ? "withYou" : "others", names: words.listed(awaited.map((one) => words.youOr(one, open.me))) })}</Note> : null}
          {buttons("result")}
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setDeciding(null)}>{t("panel.cancel")}</Button>
        </section>
      ) : visible ? (
        <Button variant="outline" size="sm" onClick={() => setDeciding("result")}>{t("panel.override")}</Button>
      ) : (
        // The result is hidden with the votes until the person looking has voted, so it can't be overridden yet. The button stays, shut, with what opens it.
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled>{t("panel.override")}</Button>
          <ShutChip by="vote">{t("panel.afterYouVote")}</ShutChip>
        </div>
      )}
    </div>
  );
}
