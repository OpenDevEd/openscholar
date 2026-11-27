"use client";

import dynamic from "next/dynamic";

// The open screening's Screen page: your queue on the left, the paper with everyone's votes in the
// middle, your answers to the criteria on the right, and the vote at the foot of the window. One paper
// at a time, answered and voted on with keys. Conflicts are settled in the same place, with what the
// reviewers said to each other about them. From a laptop's width the page fits the window and each of
// the three scrolls on its own. Under that the page scrolls.

import { ListEmpty, ListLoading, ListRowsSkeleton, ListSearch } from "@/components/evidence-libraries/list-controls";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useDragControls, useMotionValue, useTransform } from "motion/react";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { searchHistory, useOpenInAddress } from "./address";
import { ArrowLeft, ArrowRight, Asterisk, ChevronDown, ChevronRight, CircleCheck, CircleHelp, Clock, Eye, GitCompare, Highlighter, History, Hourglass, ListChecks, MessagesSquare, ModelsIcon, MoreHorizontal, PanelLeft, PanelLeftOpen, PenLine, Quote, RefreshCw, TriangleAlert, Undo2, UserPlus, X, type AppIcon } from "@/components/icons";
import { Chip, Meter, RequiredMark } from "./parts";
import { EASE } from "@/components/settings/model-map";
import { LIST, Segmented } from "@/components/settings/parts";
import { PageStepper } from "@/components/shared/page-stepper";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpFact } from "@/components/ui/help";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AutoHeight } from "@/components/ui/auto-height";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { showStyledToast } from "@/components/ui/sonner";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useIsTablet } from "@/lib/hooks";
import { decide, leansOpen, modelsAdvise, NOTE_LENGTH, OTHER_REASON } from "@/lib/screening/rules";
import { ANSWERS, type Answer } from "@/lib/screening/rules";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace as usePageWorkspace } from "@/lib/workspaces/url";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { blindOf, invitedOn, reasonCriteria, termsPattern, bylineOf, awaitedOn, DECISIONS, castOf, splitsIn, questionOf, sentencesOf, settledOf, voteOn, type Criterion, type Decision, type Paper, type Reviewer, type Vote, shortName } from "./data";
import { Discussion, DiscussionShut } from "./discussion";
import { papersHref, screenHref, settingsHref } from "./links";
import { PdfRoom, ReasonNoteField, VoteFacts, Byline, ANSWER_SIGN, ActionBar, AnswerMark, BELOW_HEADER, DiscussionLink, PaperStepper, ReasonChip, PaperFacts, ReasonLabel, ReasonRows, VoteButton, DIFFER, VotesHelp, ShutChip, ShutNote, VOTES_SHUT, votesShutOf, HiddenChip, youFirst, CriterionText, FilterMenu, Help, Kbd, LinkChip, Panel, QuestionName, RESULT_STYLE, ResultChip, ReviewerMark, ReviewerName, Section, StateChip, TONE, TabCount, Tally, VoteMark, Named, RESULT_ICON, type Tone, notReviewerSays, SEARCH_PILL } from "./pieces";
import { useKept } from "./drafts";
import type { Ballot, Open } from "./store";
import { useWorkspace } from "./workspace";
import { useWords } from "./words";

// pdf.js is loaded only for a paper screened as its PDF.
const PaperPdf = dynamic(() => import("./paper-pdf"), { ssr: false });

type Queue = "todo" | "again" | "done" | "conflicts";
const QUEUE_PAGE = 12;
/** Each queue's count in the colour of what it holds: what waits for you is primary, a conflict is blue, what is done is neither. The tabs carry no icons, which would not fit the three on one line of the queue's column. */
const QUEUE_TONE: Record<Queue, Tone> = { todo: "primary", again: "warning", done: "neutral", conflicts: "info" };
const KEYS: Record<Decision, string> = { include: "I", maybe: "M", exclude: "E" };
/** The keys, each with who it is for: a vote's are for whoever may vote here, an answer's for whoever answers the criteria. */
const SHORTCUTS: Array<[string[], "select" | "answer" | "include" | "maybe" | "exclude" | "next" | "previous" | "undo" | "queue" | "keys", ("vote" | "answer")?]> = [[["1…9"], "select"], [["Y", "N", "U"], "answer", "answer"], [["I"], "include", "vote"], [["M"], "maybe", "vote"], [["E"], "exclude", "vote"], [["S", "J", "→"], "next"], [["K", "←"], "previous"], [["Z"], "undo", "vote"], [["Q"], "queue"], [["?"], "keys"]];
/** The queue's sheet is open: the one value its key in the address takes. */
const LIST_OPEN = ["open"] as const;
const ANSWER_KEY: Record<Answer, string> = { yes: "Y", no: "N", unclear: "U" };
/** The bar is one row of controls on a wide screen, and grows by a row where a note is being written. */
const BAR_HEIGHT = "lg:min-h-[4.5rem]";
/**
 * From a laptop's width Screen is a workbench that fits the window (LibraryPageShell's `fill`): the page never scrolls,
 * and each of its panes does. A pane is the product's ScrollArea with its shades, so a bar and a fade at the edge
 * show that it scrolls and what runs past it never looks cut off. Under that width a pane has no height of its own
 * and the page scrolls.
 */
const PANE = "min-w-0 lg:min-h-0";
/** From a window 1400px wide the page has three columns, the same for the bar under them: the queue, the paper, your answers. Under that, three would leave the paper a strip to read in (365px at 1280). */
const WIDE = "min-[87.5rem]:grid-cols-[19rem_minmax(0,1fr)_22rem] 2xl:grid-cols-[22rem_minmax(0,56rem)_minmax(28rem,1fr)]";
/** The same columns with the queue folded away: its column closes to nothing and the paper takes its width. The tracks keep their form, so the change slides. */
const FOLDED = "min-[87.5rem]:grid-cols-[0rem_minmax(0,1fr)_22rem] 2xl:grid-cols-[0rem_minmax(0,56rem)_minmax(28rem,1fr)]";
/** The bar keeps its first part while the queue is folded. From 2xl, where the paper's column has a width of its own, the vote gives up the queue's width, so it still ends where the paper does and the last vote stays under the answers. */
const BAR_FOLDED = "2xl:grid-cols-[22rem_minmax(0,34rem)_minmax(28rem,1fr)]";
const SLIDES = "min-[87.5rem]:transition-[grid-template-columns] min-[87.5rem]:duration-300 min-[87.5rem]:ease-out motion-reduce:transition-none";
/** On a very wide window your answers and the last vote keep a width that reads, at the start of their column. */
const BESIDE = "2xl:max-w-[36rem]";
/** From a laptop's width the queue's bar is a row of its own over the panes. Up to 1400px there are two columns under it: the paper, with your answers beside it, and the queue's list opens from the window's side. */
const COLUMNS = "lg:max-[87.5rem]:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_minmax(0,1fr)]";
/**
 * The queue's bar, and its tabs in it: from 1400px as wide as the queue's column under them. An empty queue shows the same bar, so its tabs stand where they did.
 * Under 1400px the paper's column can be narrower than the bar's parts: the tabs take what room there is between their own width and 18rem, and what still does not fit goes to a second line.
 */
const QUEUE_BAR = "border-b border-border-subtle p-3 lg:max-[87.5rem]:flex-wrap lg:max-[87.5rem]:px-8";
const QUEUE_TABS = "lg:max-w-[18rem] lg:min-w-max lg:flex-1 min-[87.5rem]:w-[17.5rem] min-[87.5rem]:max-w-none min-[87.5rem]:flex-none 2xl:w-[20.5rem]";
/** The bar under them: under 1400px, where you are and the vote. */
const BAR_COLUMNS = `lg:grid-cols-[19rem_minmax(0,1fr)] ${WIDE}`;
/** A filter over the queue's list: a pill as wide as the queue's column. */
const QUEUE_FILTER = "h-8 w-full rounded-full px-3.5 text-xs";
/** What helps with a criterion's answer, named under its question: a word with its sign that opens it in place and closes it again. */
const AID = "flex h-5 items-center gap-1 rounded text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50";
const NO_PACE = { sum: 0, n: 0 };
/** Among the answers reviewers gave to one criterion, in their order, the place of the first that stands apart from the answer most of them gave. */
const apartAt = (given: Array<Answer | undefined>) => {
  const most = ANSWERS.map((answer) => given.filter((one) => one === answer).length);
  const top = ANSWERS[most.indexOf(Math.max(...most))];
  return given.findIndex((one) => one !== undefined && one !== top);
};

/** A list with one item put in at a place. */
const insertAt = <T,>(list: T[], at: number, item: T) => [...list.slice(0, at), item, ...list.slice(at)];
/** A vote as it is cast again: what an undo puts back. */
const ballotOf = (vote: Vote): Ballot => ({ decision: vote.decision, answers: vote.answers, ...(vote.reason ? { reason: vote.reason } : {}), ...(vote.note ? { note: vote.note } : {}) });

/**
 * Where someone is, kept in the address: the queue, the paper open in it, what they searched for, which
 * of their own votes they asked for, and the order of what is still to do (as added, the newest arrivals
 * first, or the ones the models would include first). The page of the queue is kept there by the list itself.
 */
const PLACE = {
  queue: parseAsStringLiteral(["todo", "again", "done", "conflicts"] as const).withDefault("todo"),
  paper: parseAsString,
  q: parseAsString.withDefault(""),
  voted: parseAsStringLiteral(["any", ...DECISIONS] as const).withDefault("any"),
  order: parseAsStringLiteral(["dealt", "fresh", "lean"] as const).withDefault("dealt"),
};

/** Screen as a page of the open screening. */
export function ScreenPage() {
  const { open } = useWorkspace();
  return <Screen open={open} />;
}

function Screen({ open }: { open: Open }) {
  const { screening } = open;
  const t = useTranslations("screening.screen");
  const pieces = useTranslations("screening.pieces");
  const words = useWords();
  const id = screening.id;
  const criteria = screening.criteria;
  // The criteria a reason can name: these, and the ones taken off that a kept result was excluded for.
  const reasonNames = reasonCriteria(screening);
  const tablet = useIsTablet();
  const workspaceId = usePageWorkspace();
  // Another queue, order or choice of votes is a step Back returns from. Going from paper to paper and typing in the search box change the address in place.
  const [place, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  const router = useWorkspaceRouter();
  const { paper: inAddress, q: find, voted, order } = place;
  // A step back past a page's first paper names the page's last one as "last": the paper it is shows once the page arrives, and is named before the next step, so Back and Forward show it again.
  const fromEnd = inAddress === "last";
  const picked = fromEnd ? null : inAddress;
  // Someone who is not a reviewer has no paper to do: they read the conflicts.
  const queue: Queue = open.isReviewer ? place.queue : "conflicts";
  const searched = useDebouncedValue(find.trim(), 300);
  // What the server has counted of the person's own papers and votes.
  const counted = screening.reviewers.find((one) => one.id === open.me)?.tally;
  // The queue as the server holds it, a page at a time: found by a paper's title or authors, Done by your vote, and To do in the order asked for.
  // It is read as it stands, so a paper you have dealt with leaves it and the ones after it move up. The open one is the exception: it keeps its place, with your vote on it, until you move on.
  const listed = useCursorPageAt("page", api.screening.paperViews.queue, inWorkspace(workspaceId, { jobId: id, queue, ...(queue === "todo" ? { order } : {}), ...(queue === "done" && voted !== "any" ? { voted } : {}), ...(searched ? { text: searched } : {}) }), QUEUE_PAGE, { scroll: false });
  const holding = `${id}:${queue}:${order}:${searched.toLowerCase()}:${voted}`;
  // With no paper named in the address, the page's first is the open one, and stays it while the queue changes under the person: someone else settling a conflict never swaps the paper being read, or written about, for the next one.
  const [led, setLed] = useState<{ of: string; id: string } | null>(null);
  const leading = `${holding}:${listed.page}${fromEnd ? ":last" : ""}`;
  // The list shown is the one asked for: not an earlier search or page that stays up while the new one is read.
  const arrived = !listed.isLoading && !listed.isStale;
  if (!picked && arrived && led?.of !== leading && listed.items[0]) setLed({ of: leading, id: (fromEnd ? listed.items.at(-1)! : listed.items[0]).id });
  // It follows a paper the address names too. Whatever then takes the name out, a search, a page turn, another order or choice of votes, leaves that paper open until the list asked for arrives, and never the first paper of a page read long before.
  // Marked as named, so an entry that names no paper (Back to where the queue opened) opens the list's first paper, never the one named after it.
  if (picked && led?.id !== picked) setLed({ of: `${leading}:named`, id: picked });
  // Until the list asked for arrives, the paper that was open stays open.
  const opened = picked ?? (led && (led.of === leading || !arrived) ? led.id : null);
  // The open paper is read by itself, so Back, a reload or a link shows the paper its address says, whether or not the queue still holds it.
  const named = useProtectedQuery(api.screening.paperViews.paper, inWorkspace(workspaceId, opened ? { jobId: id, paperId: opened as Id<"screeningResults"> } : "skip")).data;
  const { folded, guides, paced: paces, set: setKept } = useKept();
  const paced = paces[open.me] ?? NO_PACE;
  const myVote = (one: Paper) => voteOn(one, open.me);
  // Dealt with: no longer among what the queue holds. In To do that is a paper you voted on, in Vote again one whose vote you have cast again, and in Conflicts one that is settled. Done keeps every paper, and dims one that is no longer the vote it is narrowed to.
  const dealtWith = (one: Paper) => (queue === "todo" ? Boolean(myVote(one)) : queue === "again" ? !myVote(one)?.flagged : queue === "conflicts" ? one.result !== "conflict" : voted !== "any" && myVote(one)?.decision !== voted);

  const paper: Paper | undefined = (opened ? (named ?? listed.items.find((one) => one.id === opened)) : undefined) ?? (opened && named === undefined ? undefined : listed.items[0]);
  // Typing in the search box takes the paper out of the address, so the first paper found opens.
  // Starting a search, and clearing one, is a step in the history: the list changes in front of the person. The letters typed between replace each other.
  const setFind = (next: string) => {
    const how = searchHistory(find, next);
    const step = how.history === "push";
    const search = () => void setPlace({ q: next, paper: null }, how);
    if (step && !picked && paper) void setPlace({ paper: paper.id }, { history: "replace" }).then(search);
    else search();
  };
  // The open paper is still being read by itself: a paper from a link or from Back, which the list doesn't hold.
  const opening = Boolean(opened) && named === undefined && !paper;
  // Where the open paper stood in the list when the list last held it. Once your vote takes it out of the queue it is shown there still. A paper opened from a link, which the list never held, leads the first page.
  const [stood, setStood] = useState<{ id: string; at: number; page: number } | null>(null);
  const inPage = paper ? listed.items.findIndex((one) => one.id === paper.id) : -1;
  if (paper && inPage >= 0 && (stood?.id !== paper.id || stood.at !== inPage || stood.page !== listed.page)) setStood({ id: paper.id, at: inPage, page: listed.page });
  const kept = paper && inPage < 0 && !listed.isLoading && (stood?.id === paper.id ? stood.page === listed.page : listed.page === 1);
  const items = kept ? insertAt(listed.items, stood?.id === paper.id ? Math.min(stood.at, listed.items.length) : 0, paper) : listed.items;
  const at = paper ? items.findIndex((one) => one.id === paper.id) : -1;
  const sentences = useMemo(() => sentencesOf(paper?.abstract ?? ""), [paper?.abstract]);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  // "Another reason" is written before it is saved: the paper whose reason is being written.
  const [writing, setWriting] = useState<string | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const article = useRef<HTMLDivElement>(null);
  // A pane's scroll and the keyboard's focus are the outside systems. A paper that has just been drawn starts at its title, not where the last one was left. Where nothing else holds the keyboard, the paper takes it, so the arrows, Space and Page Down read on through a long paper as they would scroll a page.
  const startAtTop = useCallback((drawn: HTMLElement | null) => {
    if (!drawn) return;
    drawn.closest<HTMLElement>("[data-slot=scroll-area-viewport]")?.scrollTo({ top: 0 });
    // Where the page itself scrolls, on a phone, a paper read to its end leaves the next one's title above the window: it is brought back under the bars.
    if (drawn.getBoundingClientRect().top < 0) drawn.scrollIntoView({ block: "start" });
    if (document.activeElement === document.body) article.current?.focus({ preventScroll: true });
  }, []);
  // The queue's own scroll is the outside system: the open paper's row is brought into view when it is drawn and when it becomes the open one, so the list always shows the paper beside it.
  const openRow = useCallback((row: HTMLElement | null) => {
    if (row?.getClientRects().length) row.scrollIntoView({ block: "nearest" });
  }, []);
  // Every paper the page moves to is a step in the browser's history, by a vote or a key or a click alike: Back goes to the paper that was on the screen before it. Typing a search, or naming the paper already open, steps nowhere.
  const openIt = (next: Paper, { inPlace = false }: { /** Takes the place of the entry the person is on: a refused vote's paper coming back, a paper picked from the queue's sheet. */ inPlace?: boolean } = {}) => {
    const move = () => void setPlace({ paper: next.id }, inPlace ? { history: "replace" } : undefined);
    // The paper on the screen that the address doesn't name yet (the first one a queue opens on) is named first, in its own entry, so Back comes back to it.
    if (!inPlace && !picked && paper && paper.id !== next.id) void setPlace({ paper: paper.id }, { history: "replace" }).then(move);
    else move();
    setReasonFor(null);
    setWriting(null);
    setShown(null);
    // The note's field was opened for the paper being left: the next one starts with it shut, and keeps its room.
    setNoting(false);
    // The button just pressed keeps neither the keyboard nor a pressed look on the next paper.
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest("[data-decision]")) document.activeElement.blur();
    // Below a laptop's width the page is what scrolls: where the next paper's title is out of sight, the page moves to it. From there up the page stays still and the paper's own pane starts each paper at its top (`startAtTop`).
    requestAnimationFrame(() => {
      const top = article.current?.getBoundingClientRect().top;
      // Under what is held at the window's top, the page's bar and the screening's strip: the paper's scroll margin is that line and 1rem.
      const margin = article.current ? parseFloat(getComputedStyle(article.current).scrollMarginTop) : 0;
      const line = margin - parseFloat(getComputedStyle(document.documentElement).fontSize);
      // The page is moved by hand. The paper sits in a pane, and scrollIntoView gives the scroll margin to that pane, which doesn't scroll here: the page would then stop with the title under the held top.
      if (top !== undefined && (top < line || top > window.innerHeight / 2)) window.scrollBy({ top: top - margin });
    });
  };
  // Past the page's last paper is the next page's first, and before its first the page before.
  const turn = (to: () => void, end = false) => {
    const step = () => { void setPlace({ paper: end ? "last" : null }); to(); };
    // As with a paper: the one on the screen gets its own entry before the page moves on.
    if (!picked && paper) void setPlace({ paper: paper.id }, { history: "replace" }).then(step);
    else step();
  };
  // Before the list asked for changes (another queue, order or vote picked), the paper on the screen is named in its own entry, so Back comes back to it whatever the queue has done since.
  const namedThen = (next: () => void) => {
    if (!picked && paper) void setPlace({ paper: paper.id }, { history: "replace" }).then(next);
    else next();
  };
  const go = (index: number) => {
    if (index >= items.length && listed.canNext) return turn(listed.next);
    if (index < 0 && listed.canPrevious) return turn(listed.previous, true);
    const next = items[Math.max(0, Math.min(items.length - 1, index))];
    if (next) openIt(next);
  };
  const failed = (error: unknown) => showStyledToast("error", getErrorMessage(error, t("notSaved")));

  const [advance, setAdvance] = useState(true);
  // The paper a vote last opened, and when. A press on it within a double-click's half second is the same press again (Safari counts each tap of a double tap as one click), not a vote on a paper nobody has read. The vote buttons also ignore a click counted twice, a double-click at whatever speed the system allows.
  const advanced = useRef<{ paper: string; at: number } | null>(null);
  // On a phone the note field opens when asked for, so the paper keeps the room.
  const [noting, setNoting] = useState(false);
  // On a phone the queue opens over the paper.
  // The queue's sheet, on a phone or a tablet, is in the address: Back closes it.
  const [listingOpen, setListingOpen] = useOpenInAddress("list", LIST_OPEN);
  const listing = listingOpen !== null;
  // Opening the queue's sheet names the paper under it first, as any step does, so Back from a paper picked in it comes back to that paper.
  const setListing = (next: boolean | ((now: boolean) => boolean), how?: { inPlace?: boolean }) => {
    const open = typeof next === "function" ? next(listing) : next;
    if (open && !listing && !picked && paper) void setPlace({ paper: paper.id }, { history: "replace" }).then(() => setListingOpen("open"));
    else setListingOpen(open ? "open" : null, how);
  };
  const [answers, setAnswers] = useState<Record<string, Record<string, Answer>>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Array<{ paper: Paper; decision: Decision; reason?: string; noted: boolean; before: Vote | null; resolved: boolean; queue: Queue; at: number }>>([]);
  // The server's counts move a moment after a vote. Until they do, the votes and settlings made here since are taken off them, so To do and the bar never read one behind the paper that has moved on.
  const [base, setBase] = useState({ toDo: open.toDo, conflicts: open.conflicts, at: 0 });
  if (base.toDo !== open.toDo || base.conflicts !== open.conflicts) setBase({ toDo: open.toDo, conflicts: open.conflicts, at: history.length });
  const since = history.slice(base.at);
  // A first vote on a paper takes it off To do; settling a paper that was in conflict takes it off Conflicts. Changing a vote or a settled result moves neither.
  const toDo = Math.max(0, open.toDo - since.filter((one) => !one.resolved && one.queue === "todo" && one.before === null).length);
  const conflicts = Math.max(0, open.conflicts - since.filter((one) => one.resolved && one.paper.result === "conflict").length);
  const last = history.findLast((one) => one.queue === queue) ?? null;
  const [shown, setShown] = useState<{ reviewer: string; criterion: string } | null>(null);
  // The criterion being looked at on the open paper: the words marked for it stand out in the abstract, and Y, N and U answer it. It belongs to its paper, so another paper starts with none.
  const [lit, setLit] = useState<{ paper: string; key: string } | null>(null);
  // On a phone the paper is dragged sideways to vote: how far it has been dragged shows which vote it would cast.
  const swipe = useDragControls();
  const dragged = useMotionValue(0);
  const includeShows = useTransform(dragged, [24, 110], [0, 1]);
  const excludeShows = useTransform(dragged, [-110, -24], [1, 0]);

  const resolving = queue === "conflicts";
  // Settling a conflict decides the paper for everyone. It is not the settler's own vote.
  const nextAfter = t("nextAfter", { settling: String(resolving) });
  const mine = paper ? myVote(paper) : undefined;
  const visible = paper?.sees ?? false;
  // Your own column first, then the other people, then the models, the same on every paper.
  const cast = paper ? youFirst(castOf(screening, paper), open.me) : [];
  // The last thing done here, read as it stands now: what the vote led to shows beside it.
  const lastRead = useProtectedQuery(api.screening.paperViews.paper, inWorkspace(workspaceId, last && last.paper.id !== paper?.id ? { jobId: id, paperId: last.paper.id } : "skip")).data;
  const lastPaper = last ? (last.paper.id === paper?.id ? paper : (lastRead ?? last.paper)) : undefined;
  // No vote is cast, and no conflict settled, in a finished screening: the buttons give way to a line that says so.
  const finished = Boolean(screening.finishedAt);
  // While another queue picked is read, the rows and paper still up are the last queue's: they stay where they are, dimmed and out of reach, until the new queue's arrive. One the counts say is empty says so at once.
  // Any change to the list asked for counts (another queue, order, vote picked in Done, or search): the paper of the list before is never voted on while the new one is read.
  const [arrivedList, setArrivedList] = useState(holding);
  if (arrived && arrivedList !== holding) setArrivedList(holding);
  // A page turned and not read yet counts too.
  const switching = (arrivedList !== holding || listed.isStale) && !picked;
  // Nothing is voted or settled on the last queue's paper while it stands dimmed: not by a press, not by a key.
  const mayDecide = !finished && !switching && (resolving ? open.canResolve : open.isReviewer);
  const answering = !finished && !resolving && open.isReviewer && !switching;
  const settlesHere = screening.rule.resolver === open.me;
  const settler = words.nameOn(screening, screening.rule.resolver);

  // What a paper can be excluded for: no reason, which Enter gives, a duplicate, or another reason, which is written in the note. Each has its key.
  const reasonGroups = words.excludeGroups();
  const reasons = reasonGroups.flatMap((group) => group.list);

  const decideOn = (decision: Decision, reason?: string) => {
    if (!paper || !mayDecide) return;
    // The note as the field shows it: a draft, even one emptied on purpose, else the vote's saved note. What the field shows is what is saved: a note is never dropped out of sight.
    const note = (notes[paper.id] !== undefined ? notes[paper.id] : resolving ? "" : (mine?.note ?? "")).trim() || undefined;
    // A reason no criterion covers is written down: the note field asks for it, and the vote is saved once there is one.
    if (decision === "exclude" && reason === OTHER_REASON && !note) {
      setReasonFor(null);
      return setWriting(paper.id);
    }
    const cast = { paper, decision, reason, noted: Boolean(note), before: resolving ? null : (mine ?? null), resolved: resolving, queue, at: Date.now() };
    setHistory((all) => [...all, cast]);
    // A vote the server refuses was never cast: it leaves "your last vote", and its paper is the open one again.
    const refused = (error: unknown) => {
      setHistory((all) => all.filter((one) => one !== cast));
      openIt(paper, { inPlace: true });
      failed(error);
    };
    // Each vote after the first of a sitting adds the time since the one before to the person's pace. Five minutes or more is a break, not a paper.
    const gap = history.length ? (Date.now() - history.at(-1)!.at) / 1000 : Infinity;
    if (gap < 300) setKept({ paced: { ...paces, [open.me]: { sum: paced.sum + gap, n: paced.n + 1 } } });
    if (resolving) open.resolve(paper.id, decision, note, reason).catch(refused);
    // The answers given before stay: a new vote adds to them, and a criterion named as the reason becomes a no.
    else open.vote(paper.id, { decision, answers: { ...mine?.answers, ...answers[paper.id] }, reason, note }).catch(refused);
    setReasonFor(null);
    setWriting(null);
    const waits = (one: Paper) => one.id !== paper.id && !dealtWith(one);
    // The next one down that still waits, or failing that the first that does: a paper skipped earlier comes round again once the end is reached.
    const next = advance && queue !== "done" ? (items.find((one, index) => index > at && waits(one)) ?? items.find(waits)) : undefined;
    if (next) {
      advanced.current = { paper: next.id, at: Date.now() };
      openIt(next);
    }
    // Staying on the paper: the address names it from now on, so it keeps its place in the list with the vote on it.
    else if (!picked) void setPlace({ paper: paper.id }, { history: "replace" });
  };
  const answerIt = (criterion: string, answer: Answer, keep = false) => {
    if (!paper) return;
    // A second press on the chosen answer takes it back. A key only ever sets it: pressed twice, the answer stays. What is shown is what was set here and, under it, what the vote holds, so both are counted.
    const given = { ...(resolving ? undefined : mine?.answers), ...answers[paper.id] };
    if (given[criterion] === answer && !keep) delete given[criterion];
    else given[criterion] = answer;
    setAnswers((all) => ({ ...all, [paper.id]: given }));
    // On a paper you have voted on, the answer joins the vote at once.
    if (mine && !resolving) open.vote(paper.id, { ...ballotOf(mine), answers: given }).catch(failed);
  };
  const press = (decision: Decision) => {
    if (!paper || !mayDecide || (advanced.current?.paper === paper.id && Date.now() - advanced.current.at < 500)) return;
    // Excluding asks why, unless your own answers already say: no reason, a duplicate or another reason. A title and abstract needs none.
    const failed = decision === "exclude" && !resolving ? decide({ ...Object.fromEntries(criteria.map((c) => [c.key, "yes" as Answer])), ...mine?.answers, ...answers[paper.id] }, criteria).reason : undefined;
    // A note already written is the reason, for a vote as for settling a conflict: nothing more is asked.
    const written = (notes[paper.id] ?? (resolving ? "" : (mine?.note ?? ""))).trim();
    if (decision === "exclude" && !failed && written) decideOn("exclude", OTHER_REASON);
    else if (decision === "exclude" && !failed) setReasonFor(paper.id);
    else decideOn(decision, failed);
  };
  const undo = () => {
    if (!last) return;
    if (last.resolved) open.resolve(last.paper.id, null).catch(failed);
    else open.vote(last.paper.id, last.before ? ballotOf(last.before) : null).catch(failed);
    openIt(last.paper);
    setHistory((all) => all.filter((one) => one !== last));
  };

  // The keyboard is the outside system: one listener for the keys the buttons show. The reasons' keys are the menu's own. It reads this render's paper and handlers whenever a key comes, so a key always acts on the paper on the screen.
  const onKey = useEffectEvent(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=listbox]")) return;
      // While the last queue stands dimmed, no key reaches it: not a vote, an answer or a step.
      if (switching) return;
      const key = event.key.toLowerCase();
      // A held vote key votes once: its repeats would land on the papers opened after it.
      if (event.repeat && (key === "i" || key === "m" || key === "e")) return;
      // Inside a group of choices the arrow keys move between the choices, as they do everywhere.
      if (key.startsWith("arrow") && target?.closest("[role=radiogroup]")) return;
      const numbered = /^[1-9]$/.test(key) ? criteria[Number(key) - 1] : undefined;
      if (numbered) {
        light(numbered);
        bring(numbered);
      } else if ((key === "y" || key === "n" || key === "u") && toAnswer) {
        answerIt(toAnswer.key, key === "y" ? "yes" : key === "n" ? "no" : "unclear", true);
        // On to the next one still unanswered, so a paper's criteria are a run of keys. With a criterion picked, the next one is picked in its place. With none picked, none is: the keys then answer the first criterion still unanswered.
        const next = criteria.slice(criteria.indexOf(toAnswer) + 1).find((criterion) => given[criterion.key] === undefined);
        if (current) setLit(next && paper ? { paper: paper.id, key: next.key } : null);
        const upNext = current ? next : criteria.find((criterion) => criterion !== toAnswer && given[criterion.key] === undefined);
        if (upNext) bring(upNext);
        // With the last one answered, what the answers point to shows under them: it is brought into view, where the pane had it below its foot.
        else if (!tablet) requestAnimationFrame(() => requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-hint]")].find((one) => one.getClientRects().length)?.scrollIntoView({ block: "nearest" })));
      } else if (key === "i") press("include");
      else if (key === "m") press("maybe");
      else if (key === "e") press("exclude");
      else if (key === "z") undo();
      // The queue: its pane where it has one, and the list that opens over the page where it has none.
      else if (key === "q") {
        if (window.matchMedia("(min-width: 87.5rem)").matches) setKept({ folded: !folded });
        else setListing((now) => !now);
      }
      else if (key === "?") setKeysOpen(true);
      else if (key === "arrowright" || key === "j" || key === "s") go(at + 1);
      else if (key === "arrowleft" || key === "k") go(at - 1);
      else return;
      event.preventDefault();
    },
  );
  useEffect(() => {
    const listen = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, []);

  const given: Record<string, Answer> = paper && !resolving ? { ...mine?.answers, ...answers[paper.id] } : {};
  const current = paper && lit?.paper === paper.id ? criteria.find((criterion) => criterion.key === lit.key) : undefined;
  // The criterion Y, N and U answer: the one being looked at, or the first still unanswered.
  const toAnswer = answering ? (current ?? criteria.find((criterion) => given[criterion.key] === undefined)) : undefined;
  /** Looks at a criterion, or away from it when it is the one being looked at. The words marked for it open under the question and stand out in the abstract. The paper is never scrolled: whoever is reading the votes further down keeps their place. */
  const light = (criterion: Criterion) => {
    if (!paper) return;
    setLit(current === criterion ? null : { paper: paper.id, key: criterion.key });
    setShown(null);
  };
  /** The answers' pane is the outside system: a criterion the keys move to is brought into view in it, where it has a pane of its own. */
  const bring = (criterion: Criterion) => {
    if (!tablet) requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>(`[data-criterion="${CSS.escape(criterion.key)}"]`)].find((one) => one.getClientRects().length)?.scrollIntoView({ block: "nearest" }));
  };
  // Answers point to a vote only through a must-have: with none, every answer is a nice-to-have, and no answer says Include or Exclude.
  const pointsTo = Object.keys(given).length && criteria.some((criterion) => criterion.must) ? decide(given, criteria) : null;
  const failing = pointsTo?.reason ? criteria.find((criterion) => criterion.key === pointsTo.reason) : criteria.find((criterion) => criterion.must && given[criterion.key] === "unclear");
  // The vote your answers lead to, once they say why: a must-have answered No or Unclear, or every must-have met. Its button is outlined only then, with the line that explains it.
  const pointed = !mine && pointsTo && (failing || (pointsTo.decision === "include" && criteria.filter((criterion) => criterion.must).every((criterion) => given[criterion.key] === "yes"))) ? pointsTo.decision : null;
  // Against your vote only where the answers say why, as above, and never for an exclusion whose reason is not a criterion: a duplicate is excluded whatever the answers.
  const sayWhy = Boolean(failing) || criteria.filter((criterion) => criterion.must).every((criterion) => given[criterion.key] === "yes");
  const beyondCriteria = mine?.decision === "exclude" && Boolean(mine.reason) && !criteria.some((criterion) => criterion.key === mine.reason);
  const against = mine && pointsTo && sayWhy && !beyondCriteria && pointsTo.decision !== mine.decision && (pointsTo.decision === "exclude" || mine.decision === "exclude");
  const quoting = paper && shown ? cast.find((one) => one.reviewer.id === shown.reviewer && one.vote) : undefined;
  const quotedCriterion = quoting ? criteria.find((c) => c.key === shown!.criterion) : undefined;
  // The sentence marked in the abstract: the one a model named for the answer of its that is open.
  const quotedSentence = quotedCriterion && quoting?.reviewer.kind === "model" ? (quoting.vote?.passages?.[quotedCriterion.key] ?? -1) : -1;
  const source = paper ? screening.sources.find((one) => one.id === paper.source) : undefined;
  const fromSource = source?.read?.taken ?? 0;
  // What your last vote did: put the paper in conflict, or went against what others voted.
  const madeConflict = last && !last.resolved && lastPaper?.result === "conflict";
  const differ = last && !last.resolved && lastPaper?.sees ? lastPaper.cast.filter((one) => one.reviewer !== open.me && one.vote && one.vote.decision !== last.decision).length : 0;
  // The other must-haves the last Exclude's answers failed, beside the one it gave as its reason.
  // The must-have the last vote excluded for, where it was one.
  const lastReason = last && last.decision === "exclude" && last.reason && criteria.some((criterion) => criterion.key === last.reason) ? last.reason : null;
  const alsoFailed = last && !last.resolved && last.decision === "exclude" && last.reason ? criteria.filter((criterion) => criterion.must && criterion.key !== last.reason && (lastPaper ? myVote(lastPaper) : undefined)?.answers[criterion.key] === "no").length : 0;
  // Everything in this queue is voted on: say so, where the buttons are.
  const through = queue !== "done" && items.length > 0 && !listed.canNext && items.every(dealtWith);
  const state = paper ? settledOf(paper) : undefined;
  // Whoever the paper waits for: the reviewers on it, and anyone invited who holds a place in the rule without having joined.
  const waitsOn = paper && state?.result === "waiting" ? [...awaitedOn(screening, paper).map((one) => (one.id === open.me ? words.t("youInline") : shortName(one))), ...(invitedOn(screening, paper, open.invited) ? [words.t("invitedWaiting", { count: invitedOn(screening, paper, open.invited) })] : [])] : [];
  // What the counter says: how many are left to do, or where you are among the ones done.
  const left = resolving ? conflicts : queue === "again" ? open.flagged : toDo;
  const narrowed = Boolean(find.trim()) || (queue === "done" && voted !== "any");
  // How long what is left will take to screen, at the person's own pace: a usual 45 seconds a paper to start with, moved towards their own by each vote, so the figure never lurches after two quick ones.
  const pace = Math.max(8, (45 * 3 + paced.sum) / (3 + paced.n));
  const minutes = Math.round((left * pace) / 60);
  const timeLeft = mayDecide && queue !== "done" && left > 0 ? (minutes < 1 ? t("bar.underMinute") : minutes < 90 ? t("bar.minutes", { minutes }) : t("bar.hours", { hours: Math.round(minutes / 60) })) : null;
  // Dragging the paper casts a vote only where a vote is still to cast, on a screen that is touched.
  const swipeable = tablet && answering && mayDecide && !mine && Boolean(paper) && writing !== paper?.id;
  const hasNote = Boolean(paper && (notes[paper.id] ?? (resolving ? "" : (mine?.note ?? ""))).trim());
  // The note's field is open when it was asked for, when it holds a note, and always for the reason a conflict is settled with.
  // Undo takes back what was last done here: a reviewer's vote, or the decision of whoever settles a conflict.
  const undoSays = t("shortcuts.undo", { settling: String(resolving) });
  const noteOpen = resolving || noting || hasNote;
  /** Escape leaves the note: an empty one closes, one with words in it stays and gives the keys back to the page. */
  const leaveNote = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    event.currentTarget.blur();
    if (!hasNote) setNoting(false);
  };

  // A vote cast before a criterion became a must-have asks for a new one: its queue shows while any does, and while it is the one open.
  // Conflicts is a queue only where a paper can be in conflict, or one is: with one vote on each paper there is none to settle.
  const splits = splitsIn(screening, conflicts, open.invited) || queue === "conflicts";
  const queues = open.isReviewer ? (["todo", ...(open.flagged || queue === "again" ? (["again"] as const) : []), "done", ...(splits ? (["conflicts"] as const) : [])] as const) : (["conflicts"] as const);
  const tabs = (
    <Segmented
      label={t("queue.label")}
      value={queue}
      fill="labels"
      // Another queue is a step in the history, and the paper on the screen is named in its own entry first, so Back comes back to it whatever the queue has done since.
      onChange={(which) => namedThen(() => router.push(screenHref(id, which === "todo" ? undefined : { queue: which })))}
      options={queues.map((which) => ({
        id: which,
        label: t(`queue.${which}`),
        detail: <TabCount value={which === "todo" ? toDo : which === "again" ? open.flagged : which === "done" ? (counted?.cast ?? 0) : conflicts} tone={QUEUE_TONE[which]} />,
      }))}
    />
  );

  // One paper of the queue, in the column beside the paper and in the sheet a phone opens.
  const row = (one: Paper, pick: (paper: Paper) => void) => {
    const vote = myVote(one);
    const result = settledOf(one);
    // The open paper stays in its place once it is dealt with, until you move on. It is dimmed then: voted on in To do, settled in Conflicts. So is a paper that is no longer the vote Done is narrowed to.
    const dealt = dealtWith(one);
    const said = one.messages;
    const asksMe = Boolean(one.asked);
    const isOpen = one.id === paper?.id;
    return (
      <li key={one.id}>
        <button ref={isOpen ? openRow : undefined} type="button" data-queue-paper={one.id} aria-current={isOpen || undefined} onClick={() => pick(one)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-start transition-colors", isOpen ? "bg-primary/8" : "hover:bg-muted")}>
          <span className={cn("min-w-0 flex-1 transition-opacity", dealt && "opacity-55")}>
            <span dir="auto" className={cn("line-clamp-2 text-sm leading-5", isOpen ? "font-semibold" : "font-medium")}>{one.title}</span>
            <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">{bylineOf(one, true)}</span>
              {/* New is what the last check brought, as on Papers. */}{one.batch !== undefined && one.batch === open.latest?.id && queue === "todo" ? <StateChip tone="primary" className="h-5 px-1.5 text-2xs">{t("row.new")}</StateChip> : null}
              {queue === "done" && vote ? <span className="ms-auto shrink-0">{words.ago(vote.at)}</span> : null}
            </span>
          </span>
          {/* What was said about it, where anything was: lit where the last line asks the person looking. */}
          {said ? <span role="img" aria-label={asksMe ? t("row.askedYou") : t("row.messages", { count: said })} className={cn("mt-0.5 flex shrink-0 items-center gap-0.5 text-xs tabular-nums", asksMe ? "font-medium text-primary" : "text-muted-foreground")}><MessagesSquare aria-hidden className="size-3.5" />{said}</span> : null}
          {resolving ? (
            result.result === "conflict" ? <Tally votes={one.cast.flatMap((place) => place.vote ?? [])} className="mt-0.5 shrink-0 gap-1.5" /> : result.final ? <VoteMark vote={{ decision: result.final }} who={t("result")} /> : null
          ) : vote ? <VoteMark vote={vote} who={t("yourVote")} /> : null}
        </button>
      </li>
    );
  };
  // How many the queue holds, where it is counted: Done by your votes (all of them, or the decision it is narrowed to), the others by what is left. A search isn't counted, and its pager says only the page.
  const queueTotal = searched ? undefined : queue === "done" ? (voted === "any" ? (counted?.cast ?? 0) : (counted?.[voted] ?? 0)) : left;
  const pager = (className: string) => (listed.hasPages ? <PageStepper className={className} {...(queueTotal !== undefined ? { pageCount: Math.max(1, Math.ceil(queueTotal / QUEUE_PAGE)) } : {})} page={listed.page} canPrevious={listed.canPrevious} canNext={listed.canNext} onPrevious={() => turn(listed.previous)} onNext={() => turn(listed.next)} /> : null);
  const findField = (className: string) => (
    <ListSearch box={className} value={find} onChange={(event) => setFind(event.target.value)} placeholder={t("queue.find")} aria-label={t("queue.findLabel")} className={SEARCH_PILL} />
  );

  // A reviewer asked the person looking about a paper: the chip opens that paper, where the question is.
  const askedChip = open.asked && open.askedFirst ? <LinkChip href={screenHref(id, { queue: "conflicts", paper: open.askedFirst })} tone="primary" icon={MessagesSquare} className="w-fit shrink-0">{t("queue.asked", { count: open.asked })}</LinkChip> : null;
  // What narrows the queue and puts it in order: over its list in its own column, and in the drawer that holds the list where it has no column.
  const queueFilters = (className: string) => (
    <>
      {queue === "done" ? (
        <FilterMenu
          name={t("yourVote")}
          value={voted}
          onChange={(next) => namedThen(() => void setPlace({ voted: next, paper: null }))}
          className={className}
          choices={[
            { value: "any" as typeof voted, label: t("filter.any"), icon: <ListChecks />, count: counted?.cast ?? 0 },
            ...DECISIONS.map((decision) => { const { icon: Icon, tone } = RESULT_STYLE[decision]; return { value: decision as typeof voted, label: words.decision(decision), icon: <Icon />, tone, count: counted?.[decision] ?? 0 }; }),
          ]}
        />
      ) : null}
      {queue === "todo" && toDo > 1 ? (
        <FilterMenu
          name={t("filter.order")}
          value={order}
          onChange={(next) => namedThen(() => void setPlace({ order: next, paper: null }))}
          narrows={false}
          className={className}
          choices={[
            { value: "dealt" as typeof order, label: t("filter.dealt"), icon: <Clock /> },
            // Offered while new papers wait, and kept while it is the order chosen: voting on the last new paper must not rename the order to another.
            ...(open.latest?.mine || order === "fresh" ? [{ value: "fresh" as typeof order, label: t("filter.fresh"), icon: <RefreshCw /> }] : []),
            { value: "lean" as typeof order, label: t("filter.lean"), icon: <ModelsIcon />, // To do holds only papers you have yet to vote on, so on a screening that hides votes this order never opens there: the reason says what this screening does, in words that need no setting's name, and promises no vote that would open it.
            ...(leansOpen(screening.rule) ? {} : { shut: t("filter.leanShut") }) },
          ]}
        />
      ) : null}
    </>
  );
  // A queue with nothing in it, not because of a search: the whole width says so, under the queue's tabs. While the queue is read the tabs stand alone, where they will be.
  // Only the first read of the queue stands alone like this. A paper read by itself later loads in its own pane: the queue beside it, with its search box, stays where it is and keeps the keyboard.
  // One the counts say is empty says so at once.
  // A list the counts already say is empty says so at once: To do and the others by what is left, Done by your votes, all of them or the ones picked. Just after a vote here the counts lag it, so the list itself is waited for.
  // Only a pending vote that moves a count (a first vote, a conflict settled) makes the counts lag; changing a vote moves none.
  const known = !searched && !picked && queueTotal === 0 && !since.some((one) => (!one.resolved && one.queue === "todo" && one.before === null) || (one.resolved && one.paper.result === "conflict") || (queue === "done" && voted !== "any" && !one.resolved));
  const reading = listed.isLoading;
  // A queue the counts say holds papers is read in the place it will take: its rows from 1400px, and a paper in the pane beside them. Done has no count, and a search may find some.
  if (reading && (queue === "done" || left > 0 || narrowed)) {
    return (
      <div role="status" aria-label={t("queue.loading")} className={cn("grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:divide-x lg:divide-border-subtle", COLUMNS, folded ? FOLDED : WIDE)}>
        {open.isReviewer ? <div className={cn("lg:col-start-1 lg:row-start-1 min-[87.5rem]:col-end-3", QUEUE_BAR)}><div className={QUEUE_TABS}>{tabs}</div></div> : null}
        <div className={cn("hidden min-[87.5rem]:col-start-1 min-[87.5rem]:row-start-2 min-[87.5rem]:block min-[87.5rem]:overflow-hidden", folded && "min-[87.5rem]:invisible min-[87.5rem]:border-e-0")}>
          <div className="w-[19rem] 2xl:w-[22rem]">
            <div className="p-3"><SkeletonBar className="h-8 w-full rounded-full" /></div>
            <ListRowsSkeleton rows={Math.min(left || QUEUE_PAGE, QUEUE_PAGE)} height={72} icon={false} label={t("queue.loading")} className="border-t border-border-subtle" />
          </div>
        </div>
        <PaperSkeleton className="lg:col-start-1 lg:row-start-2 min-[87.5rem]:col-start-2" />
      </div>
    );
  }
  if (reading || (switching && known) || (!paper && !narrowed && !opening)) {
    return (
      <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        {open.isReviewer ? <div className={QUEUE_BAR}><div className={QUEUE_TABS}>{tabs}</div></div> : null}
        <div className="lg:flex lg:flex-1 lg:flex-col lg:justify-center">{reading ? <ListLoading label={t("queue.loading")} /> : <Empty open={open} queue={queue} />}</div>
      </div>
    );
  }

  const voteButton = (decision: Decision) => {
    const on = resolving ? Boolean(state?.resolvedBy) && state?.final === decision : mine?.decision === decision;
    return (
      <VoteButton key={decision} decision={decision} on={on} pointed={pointed === decision} data-decision aria-haspopup={decision === "exclude" ? "menu" : undefined} onClick={decision === "exclude" && !tablet ? undefined : (event) => event.detail < 2 && press(decision)}>
        <Kbd className={cn("max-lg:hidden @max-[30rem]/vote:hidden", decision === "include" && "font-mono", on && "border-current/30 bg-transparent text-current")}>{KEYS[decision]}</Kbd>
      </VoteButton>
    );
  };

  // What the reviewers say to each other about it, wherever its votes show. Drawn with the votes, in whichever of their two places is on the page.
  const discussion = paper && visible ? <div data-discussion><Discussion open={open} paper={paper} /></div> : null;
  // Where the others' votes are still hidden, what they wrote is too, and the rule stands in its place.
  const noDiscussion = paper && !discussion ? <DiscussionShut open={open} /> : null;
  const said = paper?.messages ?? 0;
  // What scrolls is the outside system: the discussion is brought to the top of its pane from a laptop's width, and of the page under that. The page is moved by hand, for the reason `openIt` gives.
  const reach = (mark: "data-discussion" | "data-votes" | "data-criteria") => {
    const part = [...document.querySelectorAll<HTMLElement>(`[${mark}]`)].find((one) => one.getClientRects().length);
    if (!part) return;
    if (tablet) window.scrollBy({ top: part.getBoundingClientRect().top - (article.current ? parseFloat(getComputedStyle(article.current).scrollMarginTop) : 0), behavior: "smooth" });
    else part.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const toDiscussion = () => reach("data-discussion");
  /** Opens the answer to a criterion that stands apart from the others, in the table of votes, and goes to the table. */
  const showApart = (criterion: Criterion) => {
    const who = cast[apartAt(cast.map((one) => one.vote?.answers[criterion.key]))];
    if (!who) return;
    setLit(null);
    setShown({ reviewer: who.reviewer.id, criterion: criterion.key });
    reach("data-votes");
  };
  // Everyone's votes on the open paper. It is drawn in one of two places: under the paper from a laptop's width, and after your answers under it, where one column has to put the questions before the others' votes.
  // A vote kept from you until you vote: the models' advice shows before it, so only the people's can be.
  const shut = votesShutOf(visible, cast);
  const blind = blindOf(screening, open.invited);
  const everyonesVotes = paper ? (
                    <Section
                      // As advice the models' votes settle nothing on a paper a person has: the heading says so on this paper's votes, never on a paper only models voted on.
                      title={modelsAdvise(screening.rule, cast.filter((one) => one.reviewer.kind === "person").length, cast.filter((one) => one.reviewer.kind === "model").length) ? t("votes.titleAdvice") : t("votes.title")}
                      help={<VotesHelp blind={blind} />}
                      aside={
                        !visible ? (
                          shut.kept ? <HiddenChip blind={blind} /> : null
                        ) : state ? (
                          <>
                            <span className="text-xs text-muted-foreground">{t("result")}</span>
                            <ResultChip result={state.result} />
                            {state.result === "conflict" ? <><Tally votes={cast.flatMap((one) => one.vote ?? [])} /><span className="text-xs text-muted-foreground">{t("votes.forSettler", { you: String(settlesHere), name: settler })}</span></> : null}
                            {state.result === "waiting" && waitsOn.length ? <span className="text-xs text-muted-foreground">{t("votes.waitingFrom", { names: words.listed([...waitsOn.slice(0, 2), ...(waitsOn.length > 2 ? [t("votes.more", { count: waitsOn.length - 2 })] : [])]) })}</span> : null}
                            {state.resolvedBy ? <span className="min-w-0 truncate text-xs text-muted-foreground">{t("votes.settledBy", { you: String(state.resolvedBy === open.me), name: words.nameOn(screening, state.resolvedBy) })}</span> : null}
                            {/* What the reviewers said about it is further down the pane: this goes there. */}
                            {discussion ? <DiscussionLink count={said} writes={open.isReviewer || open.canResolve} onClick={toDiscussion} /> : null}
                            {!state.resolvedBy && state.result === "exclude" && state.reason ? <ReasonChip reason={state.reason} criteria={reasonNames} /> : null}
                          </>
                        ) : null
                      }
                    >
                      {state?.resolvedBy && state.note ? <p className="text-sm text-muted-foreground">{words.quoted(state.note)}</p> : null}
                      <ScrollArea axis="x" shades data-votes className="scroll-mt-4 rounded-2xl border border-border-subtle">
                      <div className="p-3">
                        <Matrix
                          criteria={criteria}
                          cast={cast}
                          me={open.me}
                          hidden={shut.none}
                          settled={Boolean(state?.final)}
                          shown={shown}
                          onShow={setShown}
                          passage={quoting && quotedCriterion ? (quoting.reviewer.kind === "model" ? <Evidence paper={paper} reviewer={quoting.reviewer} vote={quoting.vote} criterion={quotedCriterion} /> : <Said reviewer={quoting.reviewer} vote={quoting.vote} criterion={quotedCriterion} criteria={criteria} you={quoting.reviewer.id === open.me} />) : null}
                        />
                      </div>
                      </ScrollArea>
                      {shut.kept ? <ShutNote by="vote">{VOTES_SHUT(pieces, blind, cast, open.me)}</ShutNote> : null}
                    </Section>
  ) : null;

  // The note's field: the one line on a wide screen, or the two on a narrow one.
  const focusNote = () => requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-note]")].find((one) => one.getClientRects().length)?.focus());
  // The note's button opens its field and closes it again. A field that holds a note stays: the button then takes the keyboard to it.
  const toggleNote = () => {
    if (!hasNote) setNoting(!noting);
    if (hasNote || !noting) focusNote();
  };
  // What your answers say before, or against, your vote. It sits with the answers from a laptop's width and over the vote buttons under it, where the answers can be a screen away from the button they outline.
  // Every must-have the answers fail the same way is named, not only the first: two answered No are both why.
  const unmet = failing ? criteria.filter((criterion) => criterion.must && given[criterion.key] === given[failing.key]) : [];
  const numbers = unmet.map((criterion) => criteria.indexOf(criterion) + 1);
  const why = failing ? { answer: given[failing.key] === "no" ? "no" : "unclear", many: String(numbers.length > 1), numbers: words.listed(numbers.map(words.num)) } : null;
  const strong = (chunk: ReactNode) => <span className="font-medium text-foreground">{chunk}</span>;
  const hint = against && mine ? (
    <Panel tone="warning" className="px-3 py-2.5 text-xs ink-warning">{why ? t("hint.againstWhy", { voted: words.decision(mine.decision), points: words.decision(pointsTo!.decision), ...why }) : t("hint.against", { voted: words.decision(mine.decision), points: words.decision(pointsTo!.decision) })}</Panel>
  ) : pointed && why ? (
    <Panel className="px-3 py-2.5 text-xs text-muted-foreground">{t.rich("hint.pointsWhy", { points: words.decision(pointed), ...why, b: strong })}</Panel>
  ) : pointed ? (
    <Panel className="px-3 py-2.5 text-xs text-muted-foreground">{t.rich("hint.allMet", { points: words.decision("include"), b: strong })}</Panel>
  ) : null;
  // The same in one line, for the bar a phone holds at its foot: a paragraph there covers the answer just given.
  const hintLine = against && mine ? (
    <p className="truncate text-xs ink-warning">{t.rich("hint.againstLine", { voted: words.decision(mine.decision), points: words.decision(pointsTo!.decision), b: (chunk) => <span className="font-medium">{chunk}</span> })}</p>
  ) : pointed ? (
    <p className="truncate text-xs text-muted-foreground">{t.rich("hint.pointsLine", { points: words.decision(pointed), b: strong })}</p>
  ) : null;

  return (
    <>
      <div aria-busy={switching || undefined} className={cn("grid grid-cols-1 max-lg:pb-64 lg:min-h-0 lg:flex-1 lg:divide-x lg:divide-border-subtle", COLUMNS, SLIDES, folded ? FOLDED : WIDE, "*:not-first:transition-opacity", switching && "*:not-first:pointer-events-none *:not-first:opacity-60")}>
        {/* The queue's bar: its tabs and the way to its list, over the queue and the paper from a laptop's width. The button has one place and one look. From 1400px it hides the queue's pane and shows it again, and under that it opens the list over the page. */}
        {/* With no paper to show, the bar has the whole width, as there are no answers to sit beside. */}
        <div className={cn("flex flex-col gap-2 lg:col-start-1 lg:row-start-1 lg:flex-row lg:items-center lg:gap-3", QUEUE_BAR, paper ? "min-[87.5rem]:col-end-3" : "lg:-col-end-1 lg:border-e-0")}>
            {/* The button starts where the paper's text does, and stays there while the queue's column closes. */}
            <div className={QUEUE_TABS}>{tabs}</div>
            {/* Under 1400px the queue's list has no column of its own. It opens over the page, with its search and filters: from the foot on a phone, from the side on a wider screen. While a search or a filter narrows the queue the button stays, so the search can be changed. */}
            {items.length > 1 || narrowed ? <Button variant="outline" size="sm" className="w-full shrink-0 lg:w-auto min-[87.5rem]:hidden" onClick={() => setListing(true)}><ListChecks />{t("queue.see")}</Button> : null}
            <Button variant="outline" size="sm" aria-expanded={!folded} className="ms-8 shrink-0 max-[87.5rem]:hidden" onClick={() => setKept({ folded: !folded })}>
              {folded ? <PanelLeftOpen /> : <PanelLeft />}
              {/* Both names take the same room, so the one that shows never moves what follows the button. */}
              <span className="grid *:col-start-1 *:row-start-1"><span className={cn(folded && "invisible")}>{t("queue.hide")}</span><span className={cn(!folded && "invisible")}>{t("queue.show")}</span></span>
            </Button>
            {askedChip}
            <Sheet open={listing} onOpenChange={setListing}>
              <SheetContent side={tablet ? "bottom" : "left"} className={cn("flex flex-col gap-0 p-0 min-[87.5rem]:hidden", tablet && "max-h-[85dvh]")}>
                <SheetHeader className="space-y-3 border-b border-border-subtle p-4">
                  <SheetTitle>{t(`queue.${queue}`)}</SheetTitle>
                  <SheetDescription className="sr-only">{t("queue.everyPaper")}</SheetDescription>
                  {findField("")}
                  {queueFilters(QUEUE_FILTER)}
                </SheetHeader>
                <ScrollArea shades className="min-h-0 flex-1">
                <ul className="divide-y divide-border-subtle">
                  {items.map((one) => row(one, (picked) => { openIt(picked, { inPlace: true }); setListing(false, { inPlace: true }); }))}
                  {!items.length ? <li className="px-4 py-8 text-center text-sm text-muted-foreground">{t("queue.noMatch")}</li> : null}
                </ul>
                </ScrollArea>
                {pager("border-t border-border-subtle px-3 py-2")}
              </SheetContent>
            </Sheet>
        </div>

        {/* The queue's pane, from 1400px: its search and filters at its top, the list under them, which scrolls, and the list's pages at its foot where it has more than one. */}
        {/* Folded away, its column closes to nothing and it leaves the page and the keyboard's path once it has closed. What it holds keeps its width while the column slides. */}
        <div className={cn("hidden min-[87.5rem]:col-start-1 min-[87.5rem]:row-start-2 min-[87.5rem]:flex min-[87.5rem]:min-h-0 min-[87.5rem]:flex-col min-[87.5rem]:overflow-hidden min-[87.5rem]:transition-[visibility] min-[87.5rem]:duration-300", folded && "min-[87.5rem]:invisible min-[87.5rem]:border-e-0")}>
          <div className="flex min-h-0 w-[19rem] flex-1 flex-col 2xl:w-[22rem]">
            <div className="space-y-2 p-3">
              {findField("")}
              {queueFilters(QUEUE_FILTER)}
            </div>
            <ScrollArea key={holding} shades className="flex min-h-0 flex-1 border-t border-border-subtle">
              <ul className="divide-y divide-border-subtle">
                {items.map((one) => row(one, openIt))}
              </ul>
            </ScrollArea>
            {listed.hasPages ? <div className="flex justify-center border-t border-border-subtle px-2 py-1.5">{pager("w-28")}</div> : null}
          </div>
        </div>

        {!paper && opening ? (
          <PaperSkeleton label={t("queue.loadingPaper")} className="lg:col-start-1 lg:-col-end-1 lg:row-start-2 min-[87.5rem]:col-start-2" />
        ) : !paper ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center lg:col-start-1 lg:-col-end-1 lg:row-start-2 min-[87.5rem]:col-start-2">
            <p className="text-sm font-medium">{t("queue.noMatch")}</p>
            <Button size="sm" variant="outline" onClick={() => void setPlace({ paper: null, q: null, voted: null })}>{t("queue.showWhole")}</Button>
          </div>
        ) : (
          <>
            {/* The paper, and everyone's votes under it: the pane in the middle, which a long paper scrolls. */}
            <div className={cn("lg:col-start-1 lg:row-start-2 lg:flex lg:flex-col min-[87.5rem]:col-start-2", PANE)}>
            <ScrollArea shades className="lg:min-h-0 lg:flex-1">
              <div ref={article} tabIndex={-1} role="region" aria-label={t("paper.label")} className={cn("outline-none", BELOW_HEADER)}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={paper.id} ref={startAtTop} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: EASE }} className={cn("max-w-[46rem] scroll-mt-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+var(--screening-frame,0px))] space-y-8 p-5 sm:p-8 2xl:max-w-none", folded && "min-[87.5rem]:max-w-none")}>
                    {/* On a touch screen the paper is dragged to vote: right to include, left to exclude, which asks its reason as the button does. A finger that moves up or down scrolls the page as before. */}
                    <motion.article
                      className="relative space-y-4"
                      drag={swipeable ? "x" : false}
                      dragControls={swipe}
                      dragListener={false}
                      dragDirectionLock
                      dragSnapToOrigin
                      dragElastic={0.5}
                      dragConstraints={{ left: 0, right: 0 }}
                      style={{ x: dragged, touchAction: "pan-y" }}
                      onPointerDown={(event) => { if (swipeable && event.pointerType === "touch") swipe.start(event); }}
                      onDragEnd={(_, info) => {
                        if (info.offset.x > 110 || info.velocity.x > 700) press("include");
                        else if (info.offset.x < -110 || info.velocity.x < -700) press("exclude");
                      }}
                    >
                      {swipeable ? (
                        <>
                          <motion.span aria-hidden style={{ opacity: includeShows }} className="pointer-events-none absolute start-0 top-0 z-10 -rotate-6 rounded-lg border-2 border-success bg-card px-2 py-0.5 text-sm font-bold ink-success">{words.decision("include")}</motion.span>
                          <motion.span aria-hidden style={{ opacity: excludeShows }} className="pointer-events-none absolute end-0 top-0 z-10 rotate-6 rounded-lg border-2 border-destructive bg-card px-2 py-0.5 text-sm font-bold ink-destructive">{words.decision("exclude")}</motion.span>
                        </>
                      ) : null}
                      <h2 dir="auto" className="text-xl font-semibold leading-snug tracking-tight text-balance">{paper.title}</h2>
                      <Byline paper={paper} />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PaperFacts paper={paper} source={source ? { name: source.name, kind: source.kind, href: papersHref(id, { source: source.id }), label: t("paper.fromSource", { count: fromSource, source: source.name }) } : undefined} added={paper.batch !== undefined && paper.addedAt !== undefined ? { at: paper.addedAt, href: papersHref(id, { added: paper.batch }) } : undefined} />
                        {/* That reviewers have written about the paper shows as it opens, with the way to what they wrote. */}
                        {discussion && said ? <DiscussionLink count={said} onClick={toDiscussion} /> : null}
                        {/* A paper read as its PDF is many screens long: the votes under it are a press away from its head. */}
                        {paper.pdf ? <button type="button" onClick={() => reach("data-votes")} className="flex h-6 shrink-0 items-center gap-1 rounded-full bg-foreground/[0.07] px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">{t("votes.title")}<ChevronDown aria-hidden className="size-3.5" /></button> : null}
                      </div>
                      <div className="space-y-3">
                        {/* A paper with no abstract is read as the PDF it is. */}
                        {paper.pdf ? <PdfRoom pages={paper.pdf.pages ?? 1} shape={paper.pdf.shape}><PaperPdf id={id} paper={paper} terms={criteria.flatMap((c) => c.terms)} /></PdfRoom> : (
                        <p dir="auto" className="text-[0.95rem] leading-7">
                          {sentences.map((sentence, i) => <Sentence key={i} at={i} text={sentence} quoted={quotedSentence === i} terms={criteria.flatMap((c) => c.terms)} lit={current?.terms ?? []} />)}
                        </p>
                        )}
                        {/* What the marked words are, under the text they are in: they were taken for evidence someone had picked. */}
                        {criteria.some((criterion) => criterion.terms.length) ? <p className="text-xs text-muted-foreground">{t.rich("paper.marked", { mark: (chunk) => <mark className="rounded-sm bg-primary/15 px-1 text-foreground">{chunk}</mark> })}</p> : null}
                      </div>
                    </motion.article>

                    {/* Under a laptop's width the votes follow your answers, further down: the questions come first there. */}
                    <div className="space-y-8 max-lg:hidden">{everyonesVotes}{discussion ?? noDiscussion}</div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </ScrollArea>
            </div>

            {/* Your answers to the criteria: a pane of their own. Each paper has its own, so another paper's start at their top. */}
            <ScrollArea key={paper.id} shades className={cn("border-t border-border-subtle lg:border-t-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 min-[87.5rem]:col-start-3", PANE)}>
              <div data-criteria className={cn("p-5", BESIDE)}>
                <Section
                  title={answering ? t("criteria.yours") : t("criteria.title")}
                  // How many there are, at the head: the pane scrolls, and the last ones sit under its fold.
                  aside={criteria.length ? <span className="text-xs tabular-nums text-muted-foreground">{answering ? t("criteria.answered", { answered: criteria.filter((criterion) => given[criterion.key] !== undefined).length, count: criteria.length }) : words.count("criteria", criteria.length)}</span> : undefined}
                  help={
                    <Help title={answering ? t("criteria.yours") : t("criteria.title")} side={tablet ? undefined : "left"} facts={<><HelpFact icon={Asterisk}>{t("criteria.mustHaveFact")}</HelpFact><HelpFact icon={CircleHelp}>{t("criteria.guidanceFact")}</HelpFact><HelpFact icon={Highlighter}>{t("criteria.markedFact")}</HelpFact><HelpFact>{t.rich("criteria.showsFact", { mark: (chunk) => <mark className="-ms-0.5 rounded-sm bg-primary/15 px-1 text-foreground">{chunk}</mark> })}</HelpFact></>}>
                      {answering ? t("criteria.helpAnswering") : t("criteria.helpReading")}
                    </Help>
                  }
                >
                  {/* What the star means, in sight: it was taken for "an answer is required". */}
                  {criteria.some((criterion) => criterion.must) ? <p className="text-xs leading-5 text-muted-foreground"><span className="-ms-1 me-1"><RequiredMark /></span>{t("criteria.mustHave", { answering: String(answering) })}</p> : null}
                  {criteria.length ? (
                    <ol key={paper.id} className={LIST}>
                      {criteria.map((criterion, i) => {
                        const answered = answers[paper.id]?.[criterion.key] ?? (resolving ? undefined : mine?.answers[criterion.key]);
                        const split = cast.flatMap((one) => one.vote?.answers[criterion.key] ?? []);
                        const marked = criterion.terms.length > 0;
                        const guideKey = `${id}:${criterion.key}`;
                        const guided = guides.includes(guideKey);
                        return (
                          // The rows' parts keep their own room, with no gap between them: the passage opens and closes from nothing.
                          <li key={criterion.key} data-criterion={criterion.key} className={cn("scroll-my-3 px-3 py-3 transition-colors duration-200", current === criterion && "bg-primary/5", toAnswer === criterion && "lg:bg-primary/5")}>
                            <div className="flex items-start gap-2.5 text-sm leading-5">
                              {/* The number is the criterion's key. From a laptop's width, where there are keys, the one Y, N and U answer wears it as a key. */}
                              <span className={cn("flex h-5 w-4 shrink-0 items-center justify-center rounded text-xs tabular-nums text-muted-foreground", toAnswer === criterion && "lg:bg-primary/15 lg:font-semibold lg:text-primary lg:outline lg:outline-1 lg:outline-offset-1 lg:outline-primary/30")}>{i + 1}</span>
                              <span className="min-w-0 flex-1"><CriterionText text={criterion.text} must={criterion.must} /></span>
                            </div>
                            {/* What helps with the answer, each named under the question and opened in place, so nothing covers the answers: the guidance its author wrote, which stays open from paper to paper, and the words its author marked for it, which then stand out in the abstract. */}
                            {criterion.note || marked ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 ps-6.5">
                                {criterion.note ? (
                                  <button type="button" aria-expanded={guided} onClick={() => setKept({ guides: guided ? guides.filter((one) => one !== guideKey) : [...guides, guideKey] })} className={cn(AID, guided ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                    <CircleHelp aria-hidden className="size-3.5" />{t("criteria.guidance")}<ChevronDown aria-hidden className={cn("size-3 opacity-60 transition-transform duration-200", guided && "rotate-180")} />
                                  </button>
                                ) : null}
                                {marked ? (
                                  <button type="button" aria-expanded={current === criterion} aria-label={t("criteria.markedFor", { n: i + 1 })} onClick={() => light(criterion)} className={cn(AID, current === criterion ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                                    <Highlighter aria-hidden className="size-3.5" />{t("criteria.markedWords")}<ChevronDown aria-hidden className={cn("size-3 opacity-60 transition-transform duration-200", current === criterion && "rotate-180")} />
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                            <AnimatePresence initial={false}>
                              {guided && criterion.note ? (
                                <motion.div key="guidance" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden">
                                  <p className="ms-6.5 mt-2 rounded-xl bg-inset p-2.5 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{criterion.note}</p>
                                </motion.div>
                              ) : null}
                            </AnimatePresence>
                            <AnimatePresence initial={false}>
                              {current === criterion && marked ? (
                                <motion.div key="marked" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden">
                                  <p className="ms-6.5 mt-2 flex flex-wrap gap-1.5 rounded-xl bg-warning/12 p-2.5 text-xs leading-5">{criterion.terms.map((term) => <mark key={term} className="rounded-sm bg-warning/30 px-1 text-foreground">{term}</mark>)}</p>
                                </motion.div>
                              ) : null}
                            </AnimatePresence>
                            {answering ? (
                              <div role="radiogroup" aria-label={t("criteria.answerTo", { n: i + 1 })} className="mt-2.5 grid grid-cols-[repeat(3,minmax(max-content,1fr))] gap-1.5 ps-6.5">{/* Three of one width, unless a language's word for an answer is longer than its third: then that one takes what it needs. */}
                                {ANSWERS.map((answer) => {
                                  const { icon: Icon, tone } = ANSWER_SIGN[answer];
                                  const label = pieces(`answer.${answer}`);
                                  const on = answered === answer;
                                  return (
                                    <button key={answer} type="button" role="radio" aria-checked={on} onClick={() => answerIt(criterion.key, answer)} className={cn("flex h-8 min-w-0 items-center justify-center gap-1 rounded-md border px-1.5 text-xs font-medium transition-colors", on ? cn("border-transparent ring-1 ring-current/40", TONE[tone].chip) : "border-border-subtle text-muted-foreground hover:bg-muted hover:text-foreground")}>
                                      {/* On the criterion the keys answer, from a laptop's width, each answer's key stands where its sign does, in its sign's colour: the row says which key gives which answer, and nothing gets wider. */}
                                      <Icon className={cn("size-3.5 shrink-0", !on && TONE[tone].ink, toAnswer === criterion && "lg:hidden")} />
                                      {toAnswer === criterion ? <Kbd className={cn("max-lg:hidden", on ? "border-current/30 bg-transparent text-current" : TONE[tone].ink)}>{ANSWER_KEY[answer]}</Kbd> : null}
                                      <span className="truncate">{label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : visible && split.length ? (
                              // Read, not answered: how the reviewers answered it, so where they differ shows beside the paper and not only in the table under it.
                              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 ps-6.5">
                                {ANSWERS.map((answer) => {
                                  const count = split.filter((one) => one === answer).length;
                                  const { icon: Icon, tone } = ANSWER_SIGN[answer];
                                  const label = pieces(`answer.${answer}`);
                                  // The answer by name with how many gave it: a sign and a number alone had to be worked out.
                                  return count ? <span key={answer} className={cn("flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium tabular-nums", TONE[tone].chip)}><Icon aria-hidden className="size-3.5" />{label} {words.num(count)}</span> : null;
                                })}
                                {new Set(split).size > 1 ? <button type="button" aria-label={t("criteria.differFor", { n: i + 1 })} onClick={() => showApart(criterion)} className={DIFFER}>{t("answersDiffer")}<ChevronRight aria-hidden className="size-3" /></button> : null}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <Panel className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="min-w-0 flex-1 text-muted-foreground">{t("criteria.none")}</span>
                      {open.canChange ? <Button asChild size="sm" variant="outline"><NextLink href={settingsHref(id, "criteria")}>{t("criteria.add")}</NextLink></Button> : null}
                    </Panel>
                  )}
                  {hint ? <div data-hint className="scroll-mb-3 max-lg:hidden">{hint}</div> : null}
                </Section>
              </div>
              <div className="space-y-8 border-t border-border-subtle p-5 sm:p-8 lg:hidden">{everyonesVotes}{discussion ?? noDiscussion}</div>
            </ScrollArea>
          </>
        )}
      </div>

      {paper ? (
        /* The vote stays at the foot of the window: under the panes from a laptop's width, where it is the workbench's last row. From 1400px it has three parts under the three columns: where you are in the queue, the vote, and the last vote with its way back. Under that the last vote's way back sits with where you are. On a phone the bar is fixed to the foot, its last row clear of the assistant's button. */
        <ActionBar className="max-lg:fixed max-lg:inset-x-0 max-lg:z-30 md:max-lg:start-20 lg:shrink-0">
          <div className={cn("flex flex-col gap-2 px-3 pt-3 pb-[max(1.75rem,env(safe-area-inset-bottom))] lg:grid lg:items-stretch lg:gap-0 lg:p-0", BAR_HEIGHT, BAR_COLUMNS, SLIDES, folded && BAR_FOLDED)}>
            {/* Where you are */}
            <div className="flex flex-wrap items-center gap-1 max-lg:order-last max-lg:min-h-10 max-lg:ps-9 max-lg:pe-[4.5rem] lg:content-center lg:gap-y-1.5 lg:px-4 lg:py-2">
              {/* How many are left, and from 1400px how long they take at the person's pace. On a phone the queue's tab already counts them, and the row keeps its room for the last vote and the note. */}
              <span className="me-1 flex items-baseline gap-1.5 text-xs tabular-nums max-sm:hidden">
                <span className="font-medium">{queue === "done" && kept ? t("bar.notInList") : queue === "done" || !mayDecide ? (queueTotal === undefined && listed.canNext ? words.num(listed.offset + at + 1) : t("bar.atOf", { at: listed.offset + at + 1, count: queueTotal ?? listed.offset + items.length })) : t("bar.left", { count: left })}</span>
                {timeLeft ? <span className="text-muted-foreground max-[87.5rem]:hidden">{timeLeft}</span> : null}
              </span>
              <PaperStepper onStep={(by) => go(at + by)} canPrevious={at > 0 || listed.canPrevious} canNext={at < items.length - 1 || listed.canNext} />
              {/* Under 1400px the last vote has no part of the bar to itself, so its way back sits here. */}
              {/* With it, the vote it takes back, and a pen on its corner where a note was saved with it: on these widths nothing else says what was just saved. */}
              {/* Its place is held before the first vote too, so the bar keeps its rows when the way back appears. */}
              {last ? <span className="flex items-center gap-1 min-[87.5rem]:hidden"><TooltipHint label={undoSays}><Button variant="ghost" size="icon" className="size-8" aria-label={undoSays} onClick={undo}><Undo2 /></Button></TooltipHint><span className="relative flex"><VoteMark vote={{ decision: last.decision }} who={last.resolved ? t("bar.settledAs") : t("bar.lastVote")} />{last.noted ? <PenLine role="img" aria-label={t("bar.withNote")} className="absolute -end-1.5 -top-1.5 size-3.5 rounded-full bg-card p-px text-muted-foreground" /> : null}</span></span> : <span aria-hidden className="invisible flex items-center gap-1 min-[87.5rem]:hidden"><span className="size-8" /><span className="size-6" /></span>}
              <Popover open={keysOpen} onOpenChange={setKeysOpen}>
                <TooltipHint label={t("shortcuts.title")}>
                  {/* The key that opens the list is the button. Its name shows beside it where the bar has the room. */}
                  <PopoverTrigger asChild><Button variant="ghost" size="sm" className="ms-auto h-7 gap-1.5 px-1.5 text-xs text-muted-foreground max-lg:hidden" aria-label={t("shortcuts.title")}><span className="max-2xl:hidden">{t("shortcuts.title")}</span><Kbd>?</Kbd></Button></PopoverTrigger>
                </TooltipHint>
                <PopoverContent align="start" side="top" className="w-80 space-y-2 p-3">
                  <p className="text-sm font-semibold">{t("shortcuts.title")}</p>
                  {SHORTCUTS.filter(([, what, who]) => (!who || (who === "vote" ? mayDecide : answering)) && (criteria.length > 0 || (what !== "select" && what !== "answer"))).map(([keys, what]) => (
                    <p key={what} className="flex items-center gap-3 text-sm">
                      <span className="flex w-28 shrink-0 items-center gap-1 text-xs text-muted-foreground">{keys.map((key, i) => <span key={key} className="flex items-center gap-1">{i ? t("shortcuts.or") : null}<Kbd className={key === "I" ? "font-mono" : undefined}>{key}</Kbd></span>)}</span>
                      <span>{what === "undo" ? undoSays : t(`shortcuts.${what}`)}</span>
                    </p>
                  ))}
                </PopoverContent>
              </Popover>
              {mayDecide && queue !== "done" ? (
                <label className="flex basis-full items-center justify-between gap-2 text-xs text-muted-foreground max-lg:hidden">
                  {nextAfter}
                  <Switch checked={advance} onCheckedChange={setAdvance} aria-label={nextAfter} />
                </label>
              ) : null}
              {madeConflict && last ? <LinkChip href={screenHref(id, { queue: "conflicts", paper: last.paper.id })} tone="info" icon={GitCompare} aria-label={t("bar.nowInConflicts")} className="min-[87.5rem]:hidden">{/* On a phone the row has no room for the words: the sign alone keeps the bar one row high, so the vote never moves under the thumb. */}<span className="max-sm:hidden">{t("bar.nowInConflicts")}</span></LinkChip> : null}
              {/* The note's field takes a row of a small screen, so it opens from its own button there. The two stay together: a very narrow phone moves both to a second line. */}
              <span className="ms-auto flex items-center gap-1 lg:hidden">
                {/* Under a laptop's width the criteria sit below the paper, a long scroll away on a phone: the way to them is beside the votes. */}
                {criteria.length ? <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs lg:hidden" onClick={() => reach("data-criteria")}><ListChecks />{t("criteria.title")}</Button> : null}
                {mayDecide && !resolving ? <Button variant={noteOpen ? "secondary" : "ghost"} size="sm" aria-pressed={noteOpen} className="h-8 gap-1.5 px-2 text-xs" onClick={toggleNote}><PenLine />{t("note.label")}</Button> : null}
                {mayDecide && queue !== "done" ? (
                  <Popover>
                    <PopoverTrigger asChild><Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={t("bar.more")}><MoreHorizontal /></Button></PopoverTrigger>
                    <PopoverContent align="end" side="top" className="w-72 space-y-3 p-3">
                      <label className="flex items-center gap-3 text-sm">
                        <span className="min-w-0 flex-1">{nextAfter}</span>
                        <Switch checked={advance} onCheckedChange={setAdvance} aria-label={nextAfter} />
                      </label>
                      {/* What a drag of the paper does, on a paper that can be dragged: one still to vote on. */}
                      {swipeable ? (
                        <div className="flex flex-wrap gap-1.5 border-t border-border-subtle pt-3">
                          <StateChip tone="success" icon={ArrowRight}>{t("bar.dragRight")}</StateChip>
                          <StateChip tone="destructive" icon={ArrowLeft}>{t("bar.dragLeft")}</StateChip>
                        </div>
                      ) : null}
                    </PopoverContent>
                  </Popover>
                ) : null}
              </span>
            </div>

            {/* The vote */}
            <div className="@container/vote flex w-full min-w-0 flex-col justify-center gap-2 lg:max-w-[46rem] lg:px-8 lg:py-2 2xl:max-w-none">
              {!mayDecide ? (
                <ShutNote by={resolving ? "settler" : "reviewer"}>{finished && (resolving ? open.canResolve : open.isReviewer) ? t("shut.finished", { canChange: String(open.canChange) }) : resolving ? t("shut.settler", { you: String(settlesHere), name: settler }) : notReviewerSays(pieces, open.canChange, finished)}</ShutNote>
              ) : writing === paper.id ? (
                <form className="flex flex-col gap-2" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setWriting(null); } }} onSubmit={(event) => { event.preventDefault(); decideOn("exclude", OTHER_REASON); }}>
                  {/* Escape anywhere in the form goes back, as the Back button does, and Enter excludes, as the button beside it shows. */}
                  <ReasonNoteField value={notes[paper.id] ?? ""} onChange={(text) => setNotes((all) => ({ ...all, [paper.id]: text }))} />
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={() => setWriting(null)}>{t("exclude.back")}<Kbd className="max-lg:hidden">Esc</Kbd></Button>
                    <Button type="submit" variant="destructive" className="h-10 rounded-xl" disabled={!notes[paper.id]?.trim()}><X />{words.decision("exclude")}<Kbd className="max-lg:hidden border-current/30 bg-transparent text-current">↵</Kbd></Button>
                  </div>
                </form>
              ) : (
                <>
                  {/* With every paper in the queue voted on, the line above the buttons says so: the buttons stay, to change a vote. */}
                  {through ? (
                    <div className="flex min-h-8 items-center gap-2">
                      <CircleCheck className="size-4 shrink-0 text-muted-foreground" />
                      <p className="min-w-0 flex-1 text-sm font-medium leading-tight">{resolving ? t("through.conflicts") : t("through.papers")}</p>
                      {!resolving && conflicts ? <Button asChild size="sm" className="shrink-0" variant={open.canResolve ? "default" : "outline"}><NextLink href={screenHref(id, { queue: "conflicts" })}><GitCompare />{t("settleConflicts", { settle: String(open.canResolve), count: conflicts })}</NextLink></Button> : null}
                      {resolving && toDo ? <Button asChild size="sm" className="shrink-0"><NextLink href={screenHref(id)}><ListChecks />{t("screenPapers", { count: toDo })}</NextLink></Button> : null}
                    </div>
                  ) : null}
                  {/* The note, and for a conflict the reason it is settled with: a field over the buttons, open when asked for, when it holds a note, and always for a conflict. It slides open, so the bar grows without a jump. */}
                  <AutoHeight className="-mb-2">
                    {noteOpen ? (
                      <div className="flex items-center gap-3 pb-2">
                        {resolving ? (
                          <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
                            {state?.resolvedBy ? t("settle.changeTitle") : t("settle.title")}
                            <Help title={t("settle.helpTitle")} side="top" facts={<>{mine ? <HelpFact icon={RESULT_ICON[mine.decision]}><Named name={t("settle.yourVote")}>{words.decision(mine.decision)}</Named></HelpFact> : null}<HelpFact><Named name={t("settle.rule")}>{words.t(`settle.label.${screening.rule.settle}`)}</Named></HelpFact></>}>
                              {t("settle.help")}
                            </Help>
                          </span>
                        ) : null}
                        <Input maxLength={NOTE_LENGTH} data-note onKeyDown={leaveNote} value={notes[paper.id] ?? (resolving ? "" : (mine?.note ?? ""))} onChange={(event) => setNotes((all) => ({ ...all, [paper.id]: event.target.value }))} placeholder={resolving ? t("note.settling") : t("note.voting")} aria-label={t("note.label")} className="h-8 min-w-0 flex-1 text-sm max-lg:hidden" />
                        <Textarea maxLength={NOTE_LENGTH} data-note onKeyDown={leaveNote} rows={2} value={notes[paper.id] ?? (resolving ? "" : (mine?.note ?? ""))} onChange={(event) => setNotes((all) => ({ ...all, [paper.id]: event.target.value }))} placeholder={resolving ? t("note.settling") : t("note.voting")} aria-label={t("note.label")} className="max-h-24 min-h-0 min-w-0 flex-1 resize-none py-1.5 text-sm lg:hidden" />
                      </div>
                    ) : null}
                  </AutoHeight>
                  {/* On a narrow screen what your answers point to sits over the buttons it is about. */}
                  <AutoHeight className="-mb-2 lg:hidden">{hintLine ? <div className="pb-2">{hintLine}</div> : null}</AutoHeight>
                  <div className="flex items-center gap-2">
                    {/* On a wide screen the note's button is with the vote it goes with, always by name: a pen alone was taken for a way to enlarge the paper. Where the row is short of room the votes give up their key hints. */}
                    {!resolving ? <Button type="button" variant={noteOpen ? "secondary" : "outline"} aria-pressed={noteOpen} className="h-10 shrink-0 gap-1.5 rounded-xl px-3 text-sm max-lg:hidden" onClick={toggleNote}><PenLine />{t("note.label")}</Button> : null}
                    <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
                      {voteButton("include")}
                      {voteButton("maybe")}
                      {tablet ? (
                        voteButton("exclude")
                      ) : (
                        <DropdownMenu open={reasonFor === paper.id} onOpenChange={(next) => (next ? press("exclude") : setReasonFor(null))}>
                          <DropdownMenuTrigger asChild>{voteButton("exclude")}</DropdownMenuTrigger>
                          <DropdownMenuContent
                            side="top"
                            align="end"
                            sideOffset={8}
                            className="w-80 p-1.5"
                            // After a reason the next paper opens: the keyboard stays with the page, not on Exclude.
                            onCloseAutoFocus={(event) => event.preventDefault()}
                            onKeyDown={(event) => {
                              // Enter on a reason that has the focus picks that reason, as the menu does. Anywhere else it is no reason.
                              if (event.key === "Enter" && (event.target as HTMLElement).closest("[role=menuitem]")) return;
                              const reason = reasons.find((one) => one.hotkey && one.hotkey.toLowerCase() === event.key.toLowerCase());
                              if (!reason || event.metaKey || event.ctrlKey || event.altKey) return;
                              event.preventDefault();
                              decideOn("exclude", reason.key);
                            }}
                          >
                            {reasonGroups.map((group, i) => (
                              <div key={group.name} role="group" aria-label={group.name}>
                                {i ? <DropdownMenuSeparator /> : null}
                                <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{group.name}</DropdownMenuLabel>
                                {group.list.map((reason) => (
                                  <DropdownMenuItem key={reason.key} onSelect={() => decideOn("exclude", reason.key)} className="min-h-9">
                                    <span className="min-w-0 flex-1"><ReasonLabel reason={reason.key} criteria={criteria} asked /></span>
                                    {reason.hotkey ? <Kbd>{reason.hotkey === "Enter" ? "↵" : reason.hotkey}</Kbd> : null}
                                  </DropdownMenuItem>
                                ))}
                              </div>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* The last vote and its way back, then the paper it was on and what the vote led to. */}
            <div className={cn("flex min-w-0 flex-col justify-center gap-1 px-4 py-2 text-xs text-muted-foreground max-[87.5rem]:hidden", BESIDE)}>
              {last ? (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    {/* Named as the last one: it is about the paper before, not the one open. */}
                    <span className="flex shrink-0 items-center gap-1.5"><Named name={last.resolved ? t("bar.lastSettledAs") : t("bar.lastVote")}><span className="font-medium text-foreground">{last.resolved ? words.result(last.decision) : words.decision(last.decision)}</span></Named>{last.noted ? <Chip icon={PenLine} className="h-5 px-1.5">{t("note.label")}</Chip> : null}</span>
                    <Button variant="ghost" size="xs" className="ms-auto shrink-0" onClick={undo}><Undo2 />{t("bar.undo")}<Kbd>Z</Kbd></Button>
                  </div>
                  {lastReason || last.paper.id !== paper.id || madeConflict || differ ? (
                    <div className="flex min-w-0 items-center gap-2">
                      {/* Exclude takes its reason from your answers where they say it: the reason it took is named whole, at the head of the second line, and the paper's title after it gives up the room. Where the answers failed more must-haves than the one, they are counted. */}
                      {lastReason ? <span className="flex min-w-0 items-center gap-1.5"><ReasonChip reason={lastReason} criteria={reasonNames} className="min-w-0" />{alsoFailed ? <span className="shrink-0 tabular-nums" role="img" aria-label={t("bar.alsoFailed", { count: alsoFailed })}>+{words.num(alsoFailed)}</span> : null}</span> : null}
                      {last.paper.id !== paper.id ? (
                        <TooltipHint label={last.paper.title} onlyWhenClipped>
                          <button type="button" onClick={() => openIt(last.paper)} className="min-w-0 flex-1 truncate text-start text-foreground hover:underline"><bdi>{words.quoted(last.paper.title)}</bdi></button>
                        </TooltipHint>
                      ) : <span className="flex-1" />}
                      {madeConflict ? (
                        <LinkChip href={screenHref(id, { queue: "conflicts", paper: last.paper.id })} tone="info" icon={GitCompare} className="shrink-0">{t("bar.nowInConflicts")}</LinkChip>
                      ) : differ ? (
                        // Where the paper stands now says what a different vote led to: still waiting for votes, or settled by the rule.
                        <span className="flex shrink-0 items-center gap-1.5">{t("bar.votedDifferently", { count: differ })}{lastPaper ? <ResultChip result={lastPaper.result} /> : null}</span>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </ActionBar>
      ) : null}

      {/* On a phone the reasons open from the foot of the screen. */}
      {paper && tablet ? (
        <Sheet open={reasonFor === paper.id} onOpenChange={(next) => !next && setReasonFor(null)}>
          <SheetContent side="bottom" className="flex max-h-[85dvh] flex-col gap-0 p-0">
            <SheetHeader className="border-b border-border-subtle p-4">
              <SheetTitle>{t("exclude.why")}</SheetTitle>
              <SheetDescription className="sr-only">{t("exclude.pick")}</SheetDescription>
            </SheetHeader>
            <ScrollArea shades className="min-h-0 flex-1">
              <div className="space-y-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"><ReasonRows criteria={criteria} titled={false} onPick={(reason) => decideOn("exclude", reason)} /></div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}

/** What a queue says when it holds nothing, and where to go from there. */
function Empty({ open, queue }: { open: Open; queue: Queue }) {
  const t = useTranslations("screening.screen");
  const pieces = useTranslations("screening.pieces");
  const id = open.screening.id;
  const tally = open.screening.reviewers.find((one) => one.id === open.me)?.tally;
  const [yours, voted, closed] = [tally?.dealt ?? 0, tally?.cast ?? 0, tally?.closed ?? 0];
  const [Icon, title, line]: [AppIcon, string, ReactNode] = !open.isReviewer
    // Someone who doesn't vote reads the papers in conflict here: an empty page says there are none, then what they are to the screening.
    ? [Eye, splitsIn(open.screening, open.counts.conflict, open.invited) ? t("empty.noConflictPaper") : t("empty.noneCanSplit"), notReviewerSays(pieces, open.canChange, Boolean(open.screening.finishedAt))]
    : queue === "todo"
      ? open.gathering
        ? [Hourglass, t("empty.onTheirWay"), t("empty.arrived", { done: open.gathering.done, count: open.gathering.of })]
        // "Yet" only where more can come: a living screening gains papers, another has what it has.
        : !yours ? [ListChecks, open.screening.living ? t("empty.noneYet") : t("empty.noneYours"), null]
        // A finished screening takes no vote: the papers it left without theirs are said, not passed off as voted on.
        : open.screening.finishedAt && yours > voted + closed ? [CircleCheck, t("empty.finished"), t("empty.unvoted", { count: yours - voted - closed })]
        : !closed ? [CircleCheck, t("empty.allVoted"), null]
        : [CircleCheck, t("empty.noneWaits"), t("empty.settledWithout", { count: closed })]
      : queue === "again"
        ? [CircleCheck, t("empty.noneAgain"), null]
      : queue === "conflicts"
        ? [GitCompare, open.canResolve ? t("empty.noConflict") : t("empty.noConflictPaper"), null]
        : [ListChecks, t("empty.noVotes"), null];
  // The frame every list of the app has for nothing to show, and for loading: the page holds still when one follows the other.
  return (
    <ListEmpty
      icon={Icon}
      description={line ?? undefined}
      action={
      <div className="flex flex-wrap justify-center gap-2">
        {open.isReviewer && queue === "todo" && voted ? <Button asChild size="sm"><NextLink href={screenHref(id, { queue: "done" })}>{t("empty.seeVotes", { count: voted })}</NextLink></Button> : null}
        {open.isReviewer && queue !== "conflicts" && open.conflicts ? <Button asChild size="sm" variant={open.canResolve ? "default" : "outline"}><NextLink href={screenHref(id, { queue: "conflicts" })}><GitCompare />{t("settleConflicts", { settle: String(open.canResolve), count: open.conflicts })}</NextLink></Button> : null}
        {open.isReviewer && queue !== "todo" && open.toDo ? <Button asChild size="sm"><NextLink href={screenHref(id)}><ListChecks />{t("screenPapers", { count: open.toDo })}</NextLink></Button> : null}
        {!open.isReviewer && open.canChange && !open.screening.finishedAt ? <Button size="sm" onClick={() => void open.join()}><UserPlus />{t("empty.join")}</Button> : null}
        <Button asChild size="sm" variant="outline"><NextLink href={papersHref(id)}>{t("empty.allPapers")}</NextLink></Button>
      </div>
      }
    >
      {title}
    </ListEmpty>
  );
}

/** A sentence of the abstract, with the criteria's words marked, the picked criterion's standing out, and the whole of it marked where it is the sentence a model named. */
function Sentence({ at, text, quoted, terms, lit }: { at: number; text: string; quoted: boolean; terms: string[]; /** The words of the criterion being looked at. */ lit: string[] }) {
  const strong = lit.map((term) => term.toLowerCase());
  const pattern = termsPattern(terms);
  const parts = pattern ? text.split(pattern) : [text];
  return (
    <span data-sentence={at} className={cn("scroll-my-6 rounded box-decoration-clone transition-colors duration-300", quoted && "bg-warning/20")}>
      {parts.map((part, i) => (i % 2 ? <mark key={i} className={cn("rounded-sm text-foreground transition-colors duration-200", strong.some((term) => part.toLowerCase().startsWith(term)) ? "bg-warning/40" : "bg-primary/15")}>{part}</mark> : part))}{" "}
    </span>
  );
}

/** A reviewer's face at the head of their column, with their name under it where the table has the room: it opens their vote, its reason and their note. */
function Face({ reviewer, vote, failed, settled, you, kept, criteria, named }: { reviewer: Reviewer; vote: Vote | undefined; failed?: boolean; settled: boolean; you: boolean; /** They voted, and how is kept from the person looking. */ kept: boolean; criteria: Criterion[]; /** The classes that show the name, from the width where the columns are wide enough for it. */ named: string }) {
  const t = useTranslations("screening.screen");
  const words = useWords();
  return (
    <Popover>
      <TooltipHint label={you ? t("matrix.nameYou", { name: reviewer.name }) : reviewer.name}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={you ? t("yourVote") : t("matrix.theirVote", { name: reviewer.name })} className="mx-auto flex max-w-full flex-col items-center gap-1 self-start rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
            {/* Dimmed for someone taken off the screening, whose vote on this paper still counts. */}
            <span className={cn("flex", reviewer.left && "opacity-55")}><ReviewerMark reviewer={reviewer} you={you} /></span>
            {/* A person by their first name, a model by its own, on two lines at most. */}
            {/* The clamp sets its own display, so what hides the name is a box around it. */}
            <span aria-hidden className={cn("hidden max-w-full", named)}><span className={cn("text-center text-2xs leading-3 text-muted-foreground line-clamp-2", you && "font-medium text-foreground")}>{you ? words.t("you") : shortName(reviewer)}</span></span>
          </button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent side="top" align="center" className="w-72 space-y-2.5 p-3">
        <div className="flex items-center gap-2.5">
          <ReviewerMark reviewer={reviewer} className="size-8" />
          <ReviewerName reviewer={reviewer} you={you} className="text-sm font-medium" />
        </div>
        <VoteFacts vote={vote} failed={failed} kept={kept} settled={settled} criteria={criteria} />
      </PopoverContent>
    </Popover>
  );
}

/** Each reviewer's answer to each criterion, and their vote: who said what. */
export function Matrix({ criteria, cast, me, shown, onShow, hidden = false, settled = false, passage }: {
  criteria: Criterion[];
  cast: Array<{ reviewer: Reviewer; vote?: Vote; failed?: boolean; /** They voted, and how is kept from the person looking. */ hidden?: boolean }>;
  /** Whose face is ringed as yours. */
  me?: string;
  shown: { reviewer: string; criterion: string } | null;
  onShow: (cell: { reviewer: string; criterion: string } | null) => void;
  /** The others' votes are cast and kept from you until you vote: their squares show a lock. */
  hidden?: boolean;
  /** The paper is settled for good: a reviewer with no vote on it is not waited for. */
  settled?: boolean;
  /** What opens under the row of the answer that is shown, such as the passage a model read. */
  passage?: ReactNode;
}) {
  const t = useTranslations("screening.screen");
  const words = useWords();
  // The passage's place in what scrolls is the outside system: once it has opened it is brought into view, so it never opens out of sight under the vote bar.
  const opened = useRef<HTMLDivElement>(null);
  // Where the table's box is wide enough, each column widens and carries its reviewer's name under the face. How wide that is depends on how many columns there are. Written out whole, so Tailwind finds them.
  const wide = cast.length <= 5 ? { column: "@[30rem]/votes:[--mark:3.25rem]", name: "@[30rem]/votes:block", key: "@[30rem]/votes:invisible" } : cast.length <= 7 ? { column: "@[38rem]/votes:[--mark:3.25rem]", name: "@[38rem]/votes:block", key: "@[38rem]/votes:invisible" } : { column: "", name: "", key: "" };
  return (
    <div className="@container/votes">
    {/* The marks sit right after the longest criterion, so a row reads across. Where that is wider than the room there is, on a phone or in a narrow sidebar, the criteria take what is left and cut off, so every column fits before anything scrolls sideways. */}
    {/* The rows are set apart by their cells' own margins, not by a gap. A grid keeps a gap around a row for as long as the row is there, even at no height, so the passage that opens under a row would take 6px with it in the last frame of closing. */}
    <div className={cn("-my-[3px] grid grid-cols-[minmax(5.5rem,1fr)_var(--marks)] items-center gap-x-1 [--mark:1.75rem] *:my-[3px] sm:w-fit sm:grid-cols-[minmax(7rem,max-content)_var(--marks)] [&>.contents>*]:my-[3px]", wide.column)} style={{ "--marks": `repeat(${cast.length}, var(--mark))` } as React.CSSProperties}>
      {/* Where the faces stand without names, the ring around one of them is named in the corner beside them. */}
      {me && cast.some((one) => one.reviewer.id === me) ? <span className={cn("flex items-center gap-1.5 self-end pb-1 text-xs text-muted-foreground", wide.key)}><span aria-hidden className="ms-0.5 size-2.5 rounded-full ring-2 ring-primary/70 ring-offset-1 ring-offset-card" />{words.t("you")}</span> : <span />}
      {cast.map(({ reviewer, vote, failed, hidden: kept }) => <Face key={reviewer.id} reviewer={reviewer} vote={vote} failed={failed} settled={settled} you={reviewer.id === me} kept={Boolean(kept)} criteria={criteria} named={wide.name} />)}
      {/* While the others' votes are kept from you the criteria's rows would hold nothing but locks: the faces and the row of votes say who has voted, and that is all there is to see. */}
      {hidden ? null : criteria.map((criterion, n) => {
        const given = cast.map((one) => one.vote?.answers[criterion.key]);
        const split = new Set(given.filter(Boolean)).size > 1;
        // Answers given before the question was last reworded answered the earlier wording: the row says so.
        const earlier = Boolean(criterion.changedAt && cast.some((one) => one.vote?.answers[criterion.key] && one.vote.at < criterion.changedAt!));
        return (
          <div key={criterion.key} className="contents">
            <span className="flex min-w-0 items-center gap-1.5 pe-2 text-xs">
              <span className="w-3 shrink-0 tabular-nums text-muted-foreground">{n + 1}</span>
              <QuestionName question={questionOf(criterion.key, criteria)} label={criterion.short} className={cn("min-w-0 truncate max-sm:line-clamp-2 max-sm:whitespace-normal", split ? "font-medium text-foreground" : "text-muted-foreground")}><CriterionText text={criterion.short} must={criterion.must} /></QuestionName>
              {earlier ? <TooltipHint label={t("matrix.earlierWording")}><History role="img" aria-label={t("matrix.earlierWording")} className="size-3.5 shrink-0 text-muted-foreground" /></TooltipHint> : null}
              {split ? (
                <button type="button" aria-label={t("matrix.differFor", { criterion: criterion.short })} onClick={() => { const who = cast[apartAt(given)]; if (who) onShow(shown?.reviewer === who.reviewer.id && shown.criterion === criterion.key ? null : { reviewer: who.reviewer.id, criterion: criterion.key }); }} className={cn(DIFFER, "shrink-0")}>{t("answersDiffer")}<ChevronDown aria-hidden className="size-3" /></button>
              ) : null}
            </span>
            {cast.map(({ reviewer, hidden: kept }, i) => {
              if (kept) {
                return <VoteMark key={reviewer.id} hidden who={t("matrix.on", { name: reviewer.name, criterion: criterion.short })} className="mx-auto flex" />;
              }
              const answer = given[i];
              if (!answer) return <span key={reviewer.id} className="mx-auto size-6 rounded-md border border-dashed border-border" />;
              const on = shown?.reviewer === reviewer.id && shown.criterion === criterion.key;
              // Every answer opens what is behind it: a model's the passage it read, a person's their vote and their note.
              return (
                <button key={reviewer.id} type="button" aria-pressed={on} aria-label={t("matrix.show", { who: words.youOr(reviewer, me), criterion: criterion.short, kind: reviewer.kind === "model" ? "model" : reviewer.id === me ? "you" : "other" })} onClick={() => onShow(on ? null : { reviewer: reviewer.id, criterion: criterion.key })} className={cn("mx-auto flex cursor-pointer rounded-md transition-shadow hover:ring-2 hover:ring-border", on && "ring-2 ring-primary/60")}>
                  <AnswerMark answer={answer} label={t("matrix.on", { name: reviewer.name, criterion: criterion.short })} pressable={!on} />
                </button>
              );
            })}
            {/* The passage opens under its own row. It takes the grid's width and never widens it. It has no margin of its own, so closed it takes no room at all. */}
            <AnimatePresence initial={false}>
              {passage && shown?.criterion === criterion.key ? (
                <motion.div ref={opened} key="passage" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} onAnimationComplete={() => opened.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })} className="col-span-full my-0! overflow-hidden [contain:inline-size] max-lg:scroll-mb-48">
                  <div className="py-[7px]">{passage}</div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
      <span className={cn("text-xs font-medium", !hidden && "border-t border-border-subtle pt-2")}>{t("matrix.vote")}</span>
      {cast.map(({ reviewer, vote, failed, hidden: kept }) => (
        <span key={reviewer.id} className={cn("flex justify-center", !hidden && "border-t border-border-subtle pt-2")}><VoteMark vote={vote} hidden={kept} failed={failed} settled={settled} who={reviewer.name} /></span>
      ))}
    </div>
    </div>
  );
}

/** What is behind a person's answer: their vote, the reason they gave for it, and their note, or that they left none. */
export function Said({ reviewer, vote, criterion, criteria, you = false }: { reviewer: Reviewer; vote: Vote | undefined; criterion: Criterion; criteria: Criterion[]; you?: boolean }) {
  const t = useTranslations("screening.screen");
  const answer = vote?.answers[criterion.key];
  if (!vote || !answer) return null;
  return (
    <div className="space-y-2 rounded-2xl bg-inset p-3">
      <div className="flex items-center gap-2 text-xs">
        <ReviewerMark reviewer={reviewer} className="size-5" />
        <ReviewerName reviewer={reviewer} you={you} className="font-medium" />
      </div>
      <VoteFacts vote={vote} criteria={criteria}><AnswerMark answer={answer} label={criterion.short} /></VoteFacts>
      {vote.note ? null : <p className="text-sm text-muted-foreground">{you ? t("said.noNoteYou") : t("said.noNote")}</p>}
    </div>
  );
}

/** The sentence of the abstract a model named for one answer, and how sure it is of the answer. A model that only decides names none. */
export function Evidence({ paper, reviewer, vote, criterion }: { paper: Pick<Paper, "abstract">; reviewer: Reviewer; vote: Vote | undefined; criterion: Criterion }) {
  const t = useTranslations("screening.screen");
  const answer = vote?.answers[criterion.key];
  if (!vote || !answer) return null;
  const at = vote.passages?.[criterion.key];
  const quote = at === undefined || at === null ? undefined : sentencesOf(paper.abstract)[at];
  const confidence = vote.confidences?.[criterion.key];
  const sure = confidence === undefined ? null : Math.round(confidence * 100);
  return (
    <div className="space-y-2 rounded-2xl bg-inset p-3">
      {/* The model's name is never cut: the line takes a second row where the two don't fit. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
        <ReviewerMark reviewer={reviewer} className="size-5" />
        <ReviewerName reviewer={reviewer} className="font-medium" />
        {sure === null ? null : <Help title={t("evidence.helpTitle")} facts={<HelpFact icon={TriangleAlert}>{t("evidence.unsureBelow")}</HelpFact>}>{t("evidence.help")}</Help>}
        <span className="ms-auto flex shrink-0 items-center gap-2">
          {sure === null ? null : sure < 65 ? (
            <StateChip tone="warning" icon={TriangleAlert}>{t("evidence.unsure", { sure: sure / 100 })}</StateChip>
          ) : (
            <span className="flex items-center gap-1.5 tabular-nums text-muted-foreground"><Meter value={sure} max={100} className="w-12" fill="bg-foreground/45" />{t("evidence.sure", { sure: sure / 100 })}</span>
          )}
          <AnswerMark answer={answer} label={criterion.short} />
        </span>
      </div>
      {quote ? <p className="flex gap-2 text-sm leading-5"><Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span>{quote}</span></p> : null}
    </div>
  );
}

/** A paper while it is read, where it will be: its title, who wrote it, and the first lines of its abstract. */
function PaperSkeleton({ label, className }: { label?: string; className?: string }) {
  return (
    <div role={label ? "status" : undefined} aria-label={label} className={cn("max-w-[46rem] space-y-4 p-5 sm:p-8", className)}>
      <div className="space-y-2.5"><SkeletonBar className="h-5 w-4/5" /><SkeletonBar className="h-5 w-3/5" /></div>
      <SkeletonBar className="h-2.5 w-2/5" />
      <div className="space-y-2.5 pt-2">
        {["w-full", "w-full", "w-11/12", "w-full", "w-4/5", "w-full", "w-2/3"].map((width, at) => <SkeletonBar key={at} className={width} />)}
      </div>
    </div>
  );
}
