"use client";

// The open screening's Screen page: your queue on the left, the paper with everyone's votes in the
// middle, your answers to the criteria on the right, and the vote at the foot of the window. One paper
// at a time, answered and voted on with keys. Conflicts are settled in the same place, with what the
// reviewers said to each other about them. From a laptop's width the page fits the window and each of
// the three scrolls on its own. Under that the page scrolls.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useDragControls, useMotionValue, useTransform } from "motion/react";
import NextLink from "next/link";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { ArrowLeft, ArrowRight, Asterisk, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleHelp, Clock, ExternalLink, Eye, FileSearch, GitCompare, Hourglass, ListChecks, Lock, MessagesSquare, ModelsIcon, MoreHorizontal, PanelLeft, PanelLeftOpen, PenLine, Quote, RefreshCw, Search, TranslateIcon, TriangleAlert, Undo2, UserPlus, X, type AppIcon } from "@/components/icons";
import { Chip, Meter, RequiredMark } from "@/components/screening/parts";
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
import { TooltipHint } from "@/components/ui/tooltip";
import { useIsTablet } from "@/lib/hooks";
import { ANSWERS, type Answer } from "@/lib/screening/setup";
import { cn } from "@/lib/utils";
import { DECISIONS, DECISION_LABEL, OTHER_REASONS, RESULT_LABEL, ago, confidenceOf, decide, evidence, failedLabel, personOf, questionOf, waitingQuestions, type Criterion, type Decision, type Paper, type Reviewer, type Vote } from "./data";
import { Discussion, DiscussionShut, discussed } from "./discussion";
import { papersHref, screenHref, settingsHref } from "./links";
import { ANSWER_SIGN, ActionBar, AnswerMark, BELOW_HEADER, SHUT, ShutChip, ShutNote, VOTES_SHUT, youFirst, CriterionText, FilterMenu, Help, Kbd, LinkChip, Panel, QuestionName, RESULT_STYLE, ResultChip, ReviewerMark, ReviewerName, Section, StateChip, TONE, TabCount, Tally, VoteMark, Named, RESULT_ICON, Reason, kindIcon, type Tone } from "./parts";
import { useMock, type Open } from "./store";
import { useWorkspace } from "./workspace";

type Queue = "todo" | "done" | "conflicts";
const QUEUE_PAGE = 12;
const QUEUE_LABEL: Record<Queue, string> = { todo: "To do", done: "Done", conflicts: "Conflicts" };
/** Each queue's count in the colour of what it holds: what waits for you is primary, a conflict is blue, what is done is neither. The tabs carry no icons, which would not fit the three on one line of the queue's column. */
const QUEUE_TONE: Record<Queue, Tone> = { todo: "primary", done: "neutral", conflicts: "info" };
const KEYS: Record<Decision, string> = { include: "I", maybe: "M", exclude: "E" };
/** The keys, each with who it is for: a vote's are for whoever may vote here, an answer's for whoever answers the criteria. */
const SHORTCUTS: Array<[string[], string, ("vote" | "answer")?]> = [[["1…9"], "That criterion's passage"], [["Y", "N", "U"], "Answer it yes, no or unclear", "answer"], [["I"], "Include", "vote"], [["M"], "Maybe", "vote"], [["E"], "Exclude, and say which criterion it fails", "vote"], [["S", "J", "→"], "Next paper, without a vote"], [["K", "←"], "Previous paper"], [["Z"], "Undo the last vote", "vote"], [["Q"], "Show or hide the queue"], [["?"], "Show these shortcuts"]];
const ANSWER_KEY: Record<Answer, string> = { yes: "Y", no: "N", unclear: "U" };
const OTHER = "other";
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
const RULE_LABEL = { all: "All agree", most: "Most agree", one: "One vote" } as const;
const inQuotes = (text: string) => `"${text}"`;
const NO_PACE = { sum: 0, n: 0 };
/** Among the answers reviewers gave to one criterion, in their order, the place of the first that stands apart from the answer most of them gave. */
const apartAt = (given: Array<Answer | undefined>) => {
  const most = ANSWERS.map((answer) => given.filter((one) => one === answer).length);
  const top = ANSWERS[most.indexOf(Math.max(...most))];
  return given.findIndex((one) => one !== undefined && one !== top);
};
/** "Differ", as a chip that is pressed: it opens the answer that stands apart. A plain chip of that colour was pressed and did nothing. */
const DIFFER = "flex h-5 items-center gap-0.5 rounded-full bg-info/12 ps-1.5 pe-1 text-2xs font-medium text-info outline-none transition-colors hover:bg-info/20 focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * Where someone is, kept in the address: the queue, the paper open in it, what they searched for, which
 * of their own votes they asked for, the order of what is still to do (as added, the newest arrivals
 * first, or the ones the models would include first), and the page of the queue, left out for the page
 * the open paper is on.
 */
const PLACE = {
  queue: parseAsStringLiteral(["todo", "done", "conflicts"] as const).withDefault("todo"),
  paper: parseAsString,
  q: parseAsString.withDefault(""),
  voted: parseAsStringLiteral(["any", ...DECISIONS] as const).withDefault("any"),
  order: parseAsStringLiteral(["dealt", "fresh", "lean"] as const).withDefault("dealt"),
  page: parseAsInteger,
};

/** Screen as a page of the open screening. */
export function ScreenPage() {
  const { open } = useWorkspace();
  return <Screen open={open} />;
}

function Screen({ open }: { open: Open }) {
  const { screening, papers, votes, settled, yours, toDo, conflicts } = open;
  const id = screening.id;
  const criteria = screening.criteria;
  const tablet = useIsTablet();
  // Another queue, order, choice of votes or page of the queue is a step Back returns from. Going from paper to paper and typing in the search box change the address in place.
  const [place, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  const { paper: picked, q: find, voted, order } = place;
  // Someone who is not a reviewer has no paper to do: they read the conflicts.
  const queue: Queue = open.isReviewer ? place.queue : "conflicts";
  const setFind = (next: string) => void setPlace({ q: next, paper: null, page: null }, { history: "replace" });
  const listed = useCallback(
    (which: Queue) => {
      const done = yours.filter((paper) => open.myVote(paper)).sort((a, b) => open.myVote(b)!.at - open.myVote(a)!.at);
      // Found by its title, its authors or what its abstract says. In Done, also by your vote.
      const words = find.trim().toLowerCase();
      const list = (which === "todo" ? toDo : which === "conflicts" ? conflicts : done).filter((paper) => (!words || `${paper.title} ${paper.authors.join(" ")} ${paper.sentences.join(" ")}`.toLowerCase().includes(words)) && (which !== "done" || voted === "any" || open.myVote(paper)?.decision === voted));
      // The models' votes say which papers are likely to be kept: those can come first.
      const lean = (paper: Paper) => votes[paper.id]!.filter((one) => one.reviewer.kind === "model" && one.vote?.decision === "include").length;
      // Papers that came in after the start can come first too: the latest arrival at the top.
      return (which !== "todo" || order === "dealt" ? list : [...list].sort((a, b) => (order === "lean" ? lean(b) - lean(a) : (b.batch ?? 0) - (a.batch ?? 0)))).map((paper) => paper.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the queue is read when it is opened, not on every vote
    [toDo, conflicts, yours, order, votes, find, voted],
  );
  // The queue in the order it had when it was opened: voting never reshuffles what is left. A paper you have dealt with leaves the list. The open one is the exception: it keeps its place, with your vote on it, until you move on.
  // After a reload it is built again once the saved votes are read back, so a reload shows the same queue as Back.
  const { ready, folded = false, guides = [], paced: paces, set: setMock } = useMock();
  const paced = paces?.[open.me] ?? NO_PACE;
  const holding = `${ready}:${id}:${queue}:${order}:${open.me}:${find.trim().toLowerCase()}:${voted}`;
  const [held, setHeld] = useState<{ of: string; ids: string[] }>(() => ({ of: holding, ids: listed(queue) }));
  if (held.of !== holding) setHeld({ of: holding, ids: listed(queue) });
  else {
    // Papers that join while the queue is open, from a check for new papers, a conflict that just arose or a vote cast, are added at its end.
    const joined = listed(queue).filter((one) => !held.ids.includes(one));
    if (joined.length) setHeld({ of: holding, ids: [...held.ids, ...joined] });
  }
  // The paper the address names leads the list where the list no longer holds it and it belongs in this queue: one of your papers in To do (your vote took it out), one you voted on in Done, one that is or was in conflict in Conflicts, or that reviewers wrote to each other about (a question's link opens it there even after a change of rule settled it). So Back or a reload shows the paper its address says. It is worked out on every draw and never kept: while another queue opens, the address can still name a paper of the queue being left, and that paper must not stay in this one.
  const named = picked && !held.ids.includes(picked) ? (queue === "todo" ? yours : queue === "done" ? yours.filter((one) => open.myVote(one)) : papers.filter((one) => settled[one.id]!.result === "conflict" || settled[one.id]!.resolvedBy || open.thread(one).length > 0)).find((one) => one.id === picked) : undefined;
  const listedPapers = useMemo(() => [...(named ? [named] : []), ...held.ids.flatMap((one) => papers.find((paper) => paper.id === one) ?? [])], [held, papers, named]);
  // Dealt with: no longer among what the queue holds now. In To do that is a paper you voted on, or one the others settled without you. In Conflicts, one that is settled. Done keeps every paper, whatever its vote is changed to.
  const waitingNow = new Set((queue === "todo" ? toDo : conflicts).map((one) => one.id));
  const dealtWith = (one: Paper) => queue !== "done" && !waitingNow.has(one.id);
  const items = listedPapers.filter((one) => one.id === picked || !dealtWith(one));

  const paper = items.find((one) => one.id === picked) ?? items[0];
  const at = paper ? items.indexOf(paper) : -1;
  const pages = Math.max(1, Math.ceil(items.length / QUEUE_PAGE));
  const shownPage = Math.min(pages, place.page || (at >= 0 ? Math.floor(at / QUEUE_PAGE) + 1 : 1));
  const setPage = (next: number) => void setPlace({ page: next });
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  // "Another reason" is written before it is saved: the paper whose reason is being written.
  const [writing, setWriting] = useState<string | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const article = useRef<HTMLDivElement>(null);
  // A pane's scroll and the keyboard's focus are the outside systems. A paper that has just been drawn starts at its title, not where the last one was left. Where nothing else holds the keyboard, the paper takes it, so the arrows, Space and Page Down read on through a long paper as they would scroll a page.
  const startAtTop = useCallback((drawn: HTMLElement | null) => {
    if (!drawn) return;
    drawn.closest<HTMLElement>("[data-slot=scroll-area-viewport]")?.scrollTo({ top: 0 });
    if (document.activeElement === document.body) article.current?.focus({ preventScroll: true });
  }, []);
  // The queue's own scroll is the outside system: the open paper's row is brought into view when it is drawn and when it becomes the open one, so the list always shows the paper beside it.
  const openRow = useCallback((row: HTMLElement | null) => {
    if (row?.getClientRects().length) row.scrollIntoView({ block: "nearest" });
  }, []);
  const openIt = (next: Paper) => {
    void setPlace({ paper: next.id, page: null }, { history: "replace" });
    setReasonFor(null);
    setWriting(null);
    setTranslated(false);
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
  const go = (index: number) => {
    const next = items[Math.max(0, Math.min(items.length - 1, index))];
    if (next) openIt(next);
  };

  const [advance, setAdvance] = useState(true);
  // On a phone the note field opens when asked for, so the paper keeps the room.
  const [noting, setNoting] = useState(false);
  // On a phone the queue opens over the paper.
  const [listing, setListing] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Record<string, Answer>>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Array<{ paper: Paper; decision: Decision; reason?: string; noted: boolean; before: Vote | null; resolved: boolean; queue: Queue; at: number }>>([]);
  const last = history.findLast((one) => one.queue === queue) ?? null;
  const [shown, setShown] = useState<{ reviewer: string; criterion: string } | null>(null);
  const [translated, setTranslated] = useState(false);
  // The criterion being looked at on the open paper: its passage opens under its question and is marked in the abstract, and Y, N and U answer it. It belongs to its paper, so another paper starts with none.
  const [lit, setLit] = useState<{ paper: string; key: string } | null>(null);
  // On a phone the paper is dragged sideways to vote: how far it has been dragged shows which vote it would cast.
  const swipe = useDragControls();
  const dragged = useMotionValue(0);
  const includeShows = useTransform(dragged, [24, 110], [0, 1]);
  const excludeShows = useTransform(dragged, [-110, -24], [1, 0]);

  const resolving = queue === "conflicts";
  const mine = paper ? open.myVote(paper) : undefined;
  const visible = paper ? resolving || open.canSee(paper) : false;
  // Your own column first, then the other people, then the models, the same on every paper.
  const cast = paper ? youFirst(votes[paper.id]!, open.me) : [];
  const mayDecide = resolving ? open.canResolve : open.isReviewer;
  const answering = !resolving && open.isReviewer;
  const resolver = screening.rule.resolver === open.me ? "you" : (personOf(screening.rule.resolver)?.name ?? "the person who settles them");

  // What a paper can be excluded for, in two groups: the must-have it fails, or another reason. Each has its key: a must-have its own number, as far as the digits go, and another reason its first letter.
  const failures = criteria.flatMap((criterion, i) => (criterion.must ? [{ key: criterion.key, label: <Reason reason={criterion.key} criteria={criteria} /> as ReactNode, hotkey: i < 9 ? String(i + 1) : "" }] : []));
  const otherReasons = OTHER_REASONS.map((reason) => ({ ...reason, label: (reason.key === OTHER ? "Another reason…" : reason.label) as ReactNode, hotkey: reason.key[0]!.toUpperCase() }));
  const reasons = [...failures, ...otherReasons];
  const reasonGroups = [{ name: "Which must-have does it fail?", list: failures }, { name: failures.length ? "Or another reason" : "Why exclude it?", list: otherReasons }].filter((group) => group.list.length);

  const decideOn = (decision: Decision, reason?: string) => {
    if (!paper || !mayDecide) return;
    const note = notes[paper.id]?.trim() || (resolving ? undefined : mine?.note);
    // A reason no criterion covers is written down: the note field asks for it, and the vote is saved once there is one.
    if (decision === "exclude" && reason === OTHER && !notes[paper.id]?.trim()) {
      setReasonFor(null);
      return setWriting(paper.id);
    }
    setHistory((all) => [...all, { paper, decision, reason, noted: Boolean(note), before: resolving ? null : (mine ?? null), resolved: resolving, queue, at: Date.now() }]);
    // Each vote after the first of a sitting adds the time since the one before to the person's pace. Five minutes or more is a break, not a paper.
    const gap = history.length ? (Date.now() - history.at(-1)!.at) / 1000 : Infinity;
    if (gap < 300) setMock({ paced: { ...paces, [open.me]: { sum: paced.sum + gap, n: paced.n + 1 } } });
    if (resolving) open.resolve(paper, decision, note, reason);
    // The answers given before stay: a new vote adds to them, and a criterion named as the reason becomes a no.
    else open.vote(paper, { decision, answers: { ...mine?.answers, ...answers[paper.id], ...(reason && criteria.some((c) => c.key === reason) ? { [reason]: "no" as const } : {}) }, reason, note, at: Date.now() });
    setReasonFor(null);
    setWriting(null);
    const waits = (one: Paper) => one.id !== paper.id && (resolving ? settled[one.id]!.result === "conflict" : !open.myVote(one));
    // The next one down that still waits, or failing that the first that does: a paper skipped earlier comes round again once the end is reached.
    const next = advance && queue !== "done" ? (items.find((one, index) => index > at && waits(one)) ?? items.find(waits)) : undefined;
    if (next) openIt(next);
    // Staying on the paper: the address names it from now on, so it keeps its place in the list with the vote on it.
    else if (!picked) void setPlace({ paper: paper.id, page: null }, { history: "replace" });
  };
  const answerIt = (criterion: string, answer: Answer, keep = false) => {
    if (!paper) return;
    // A second press on the chosen answer takes it back. A key only ever sets it: pressed twice, the answer stays. What is shown is what was set here and, under it, what the vote holds, so both are counted.
    const given = { ...(resolving ? undefined : mine?.answers), ...answers[paper.id] };
    if (given[criterion] === answer && !keep) delete given[criterion];
    else given[criterion] = answer;
    setAnswers((all) => ({ ...all, [paper.id]: given }));
    // On a paper you have voted on, the answer joins the vote at once.
    if (mine && !resolving) open.vote(paper, { ...mine, answers: given });
  };
  const press = (decision: Decision) => {
    if (!paper || !mayDecide) return;
    // Excluding asks which criterion failed, unless your own answers already say.
    const failed = decision === "exclude" && !resolving ? decide({ ...Object.fromEntries(criteria.map((c) => [c.key, "yes" as Answer])), ...answers[paper.id] }, criteria).reason : undefined;
    // Settling a conflict with a reason already written: that is the reason, and nothing more is asked.
    if (decision === "exclude" && resolving && notes[paper.id]?.trim()) decideOn("exclude", OTHER);
    else if (decision === "exclude" && !failed) setReasonFor(paper.id);
    else decideOn(decision, failed);
  };
  const undo = () => {
    if (!last) return;
    if (last.resolved) open.resolve(last.paper, null);
    else open.vote(last.paper, last.before);
    openIt(last.paper);
    setHistory((all) => all.filter((one) => one !== last));
  };

  // The keyboard is the outside system: one listener for the keys the buttons show. The reasons' keys are the menu's own.
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=listbox]")) return;
      const key = event.key.toLowerCase();
      // Inside a group of choices the arrow keys move between the choices, as they do everywhere.
      if (key.startsWith("arrow") && target?.closest("[role=radiogroup]")) return;
      const numbered = /^[1-9]$/.test(key) ? criteria[Number(key) - 1] : undefined;
      if (numbered) {
        light(numbered);
        bring(numbered);
      } else if ((key === "y" || key === "n" || key === "u") && toAnswer) {
        answerIt(toAnswer.key, key === "y" ? "yes" : key === "n" ? "no" : "unclear", true);
        // On to the next one still unanswered, so a paper's criteria are a run of keys. With a passage open, the next one's opens in its place. With none open, none opens: the keys then answer the first criterion still unanswered.
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
        if (window.matchMedia("(min-width: 87.5rem)").matches) setMock({ folded: !folded });
        else setListing((now) => !now);
      }
      else if (key === "?") setKeysOpen(true);
      else if (key === "arrowright" || key === "j" || key === "s") go(at + 1);
      else if (key === "arrowleft" || key === "k") go(at - 1);
      else return;
      event.preventDefault();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers close over this render's state, and the listener is renewed with it
    [at, items, history, answers, notes, advance, votes, settled, queue, mayDecide, lit, translated, tablet, folded, paced],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const given: Record<string, Answer> = paper && !resolving ? { ...mine?.answers, ...answers[paper.id] } : {};
  const current = paper && lit?.paper === paper.id ? criteria.find((criterion) => criterion.key === lit.key) : undefined;
  // The criterion Y, N and U answer: the one being looked at, or the first still unanswered.
  const toAnswer = answering ? (current ?? criteria.find((criterion) => given[criterion.key] === undefined)) : undefined;
  // A criterion has a passage where the abstract is on the page in the language the criteria are written in: the sentence that speaks to it, as the models quote it.
  const readable = paper ? paper.sentences.length > 0 && !(paper.original && !translated) : false;
  const sentenceOf = (criterion: Criterion) => (paper && readable ? Math.min(criteria.indexOf(criterion), paper.sentences.length - 1) : -1);
  /** Looks at a criterion, or away from it when it is the one being looked at. Its passage opens under the question and is marked in the abstract. The paper is never scrolled to it: whoever is reading the votes further down keeps their place, and the passage under the question is the sentence itself. */
  const light = (criterion: Criterion) => {
    if (!paper) return;
    setLit(current === criterion ? null : { paper: paper.id, key: criterion.key });
    setShown(null);
  };
  /** The answers' pane is the outside system: a criterion the keys move to is brought into view in it, where it has a pane of its own. */
  const bring = (criterion: Criterion) => {
    if (!tablet) requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>(`[data-criterion="${CSS.escape(criterion.key)}"]`)].find((one) => one.getClientRects().length)?.scrollIntoView({ block: "nearest" }));
  };
  const pointsTo = Object.keys(given).length ? decide(given, criteria) : null;
  const failing = pointsTo?.reason ? criteria.find((criterion) => criterion.key === pointsTo.reason) : criteria.find((criterion) => criterion.must && given[criterion.key] === "unclear");
  // The vote your answers lead to, once they say why: a must-have answered No or Unclear, or every must-have met. Its button is outlined only then, with the line that explains it.
  const pointed = !mine && pointsTo && (failing || (pointsTo.decision === "include" && criteria.filter((criterion) => criterion.must).every((criterion) => given[criterion.key] === "yes"))) ? pointsTo.decision : null;
  const against = mine && pointsTo && pointsTo.decision !== mine.decision && (pointsTo.decision === "exclude" || mine.decision === "exclude");
  const quoting = paper && shown && visible ? cast.find((one) => one.reviewer.id === shown.reviewer) : undefined;
  const quotedCriterion = quoting ? criteria.find((c) => c.key === shown!.criterion) : undefined;
  // The sentence marked in the abstract: the passage of the criterion being looked at, or the one a model quoted for the answer that is open.
  const quotedSentence = current ? sentenceOf(current) : quotedCriterion && quoting?.reviewer.kind === "model" ? criteria.indexOf(quotedCriterion) : -1;
  const source = paper ? screening.sources.find((one) => one.id === paper.source) : undefined;
  const fromSource = source ? papers.filter((one) => one.source === source.id).length : 0;
  // What your last vote did: put the paper in conflict, or went against what others voted.
  const madeConflict = last && !last.resolved && settled[last.paper.id]?.result === "conflict";
  const differ = last && !last.resolved && open.canSee(last.paper) ? votes[last.paper.id]!.filter((one) => one.reviewer.id !== open.me && one.vote && one.vote.decision !== last.decision).length : 0;
  // The other must-haves the last Exclude's answers failed, beside the one it gave as its reason.
  const alsoFailed = last && !last.resolved && last.decision === "exclude" && last.reason ? criteria.filter((criterion) => criterion.must && criterion.key !== last.reason && open.myVote(last.paper)?.answers[criterion.key] === "no").length : 0;
  // Everything in this queue is voted on: say so, where the buttons are.
  const through = queue !== "done" && items.length > 0 && items.every((one) => (resolving ? settled[one.id]!.result !== "conflict" : Boolean(open.myVote(one))));
  const state = paper ? settled[paper.id]! : undefined;
  const waitsOn = paper && state?.result === "waiting" ? cast.filter((one) => !one.vote && !one.failed).map((one) => one.reviewer.name) : [];
  // What the counter says: how many are left to do, or where you are among the ones done.
  const left = resolving ? conflicts.length : toDo.length;
  const narrowed = Boolean(find.trim()) || (queue === "done" && voted !== "any");
  // How long what is left will take to screen, at the person's own pace: a usual 45 seconds a paper to start with, moved towards their own by each vote, so the figure never lurches after two quick ones.
  const pace = Math.max(8, (45 * 3 + paced.sum) / (3 + paced.n));
  const minutes = Math.round((left * pace) / 60);
  const timeLeft = mayDecide && queue !== "done" && left > 0 ? (minutes < 1 ? "under a minute" : minutes < 90 ? `about ${minutes} min` : `about ${Math.round(minutes / 60)} h`) : null;
  // Dragging the paper casts a vote only where a vote is still to cast, on a screen that is touched.
  const swipeable = tablet && answering && mayDecide && !mine && Boolean(paper) && writing !== paper?.id;
  const hasNote = Boolean(paper && (notes[paper.id] ?? (resolving ? "" : (mine?.note ?? ""))).trim());
  // The note's field is open when it was asked for, when it holds a note, and always for the reason a conflict is settled with.
  const noteOpen = resolving || noting || hasNote;

  const tabs = (
    <Segmented
      label="Queue"
      value={queue}
      fill="labels"
      options={(open.isReviewer ? (["todo", "done", "conflicts"] as const) : (["conflicts"] as const)).map((which) => ({
        id: which,
        label: QUEUE_LABEL[which],
        href: screenHref(id, which === "todo" ? undefined : { queue: which }),
        detail: <TabCount value={which === "todo" ? toDo.length : which === "done" ? yours.length - toDo.length : conflicts.length} tone={QUEUE_TONE[which]} />,
      }))}
    />
  );

  // One paper of the queue, in the column beside the paper and in the sheet a phone opens.
  const row = (one: Paper, pick: (paper: Paper) => void) => {
    const vote = open.myVote(one);
    const result = settled[one.id]!;
    // The open paper stays in its place once it is dealt with, until you move on. It is dimmed then: voted on in To do, settled in Conflicts. So is a paper that is no longer the vote Done is narrowed to.
    const dealt = queue === "todo" ? Boolean(vote) : queue === "conflicts" ? result.result !== "conflict" : voted !== "any" && vote?.decision !== voted;
    const said = open.thread(one);
    const asksMe = waitingQuestions(said).some((question) => question.to === open.me);
    return (
      <li key={one.id}>
        <button ref={one === paper ? openRow : undefined} type="button" data-queue-paper={one.id} aria-current={one === paper || undefined} onClick={() => pick(one)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-start transition-colors", one === paper ? "bg-primary/8" : "hover:bg-muted")}>
          <span className={cn("min-w-0 flex-1 transition-opacity", dealt && "opacity-55")}>
            <span className={cn("line-clamp-2 text-sm leading-5", one === paper ? "font-semibold" : "font-medium")}>{one.title}</span>
            <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">{one.authors[0]}, {one.year}</span>
              {one.batch !== undefined && queue === "todo" ? <StateChip tone="primary" className="h-5 px-1.5 text-2xs">New</StateChip> : null}
              {queue === "done" && vote ? <span className="ms-auto shrink-0">{ago(vote.at)}</span> : null}
            </span>
          </span>
          {/* What was said about it, where anything was: lit where the last line asks the person looking. */}
          {said.length ? <span role="img" aria-label={asksMe ? "A question for you" : `${said.length} ${said.length === 1 ? "message" : "messages"}`} className={cn("mt-0.5 flex shrink-0 items-center gap-0.5 text-xs tabular-nums", asksMe ? "font-medium text-primary" : "text-muted-foreground")}><MessagesSquare aria-hidden className="size-3.5" />{said.length}</span> : null}
          {resolving ? (
            result.result === "conflict" ? <Tally votes={votes[one.id]!.flatMap((one) => one.vote ?? [])} className="mt-0.5 shrink-0 gap-1.5" /> : result.final ? <VoteMark vote={{ decision: result.final }} who="Result" /> : null
          ) : vote ? <VoteMark vote={vote} who="Your vote" /> : null}
        </button>
      </li>
    );
  };
  // The papers you have voted on: what the Done queue holds, and what its filter counts.
  const votedByMe = yours.filter((one) => open.myVote(one));
  const pager = (className: string) => (pages > 1 ? <PageStepper className={className} page={shownPage} pageCount={pages} canPrevious={shownPage > 1} canNext={shownPage < pages} onPrevious={() => setPage(shownPage - 1)} onNext={() => setPage(shownPage + 1)} /> : null);
  const findField = (className: string) => (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={find} onChange={(event) => setFind(event.target.value)} placeholder="Find by title, author or abstract" aria-label="Find in this queue" className="h-8 rounded-full ps-8 text-sm" />
    </div>
  );

  // A reviewer asked the person looking about a paper: the chip opens that paper, where the question is.
  const askedChip = open.asked.length ? <LinkChip href={screenHref(id, { queue: "conflicts", paper: open.asked[0]!.id })} tone="primary" icon={MessagesSquare} className="w-fit shrink-0">{open.asked.length} {open.asked.length === 1 ? "question" : "questions"} for you</LinkChip> : null;
  // What narrows the queue and puts it in order: over its list in its own column, and in the drawer that holds the list where it has no column.
  const queueFilters = (className: string) => (
    <>
      {queue === "done" ? (
        <FilterMenu
          name="Your vote"
          value={voted}
          onChange={(next) => void setPlace({ voted: next, paper: null, page: null })}
          className={className}
          choices={[
            { value: "any" as typeof voted, label: "Any", icon: <ListChecks />, count: votedByMe.length },
            ...DECISIONS.map((decision) => { const { icon: Icon, tone } = RESULT_STYLE[decision]; return { value: decision as typeof voted, label: DECISION_LABEL[decision], icon: <Icon />, tone, count: votedByMe.filter((one) => open.myVote(one)?.decision === decision).length }; }),
          ]}
        />
      ) : null}
      {queue === "todo" && toDo.length > 1 ? (
        <FilterMenu
          name="Order"
          value={order}
          onChange={(next) => void setPlace({ order: next, paper: null, page: null })}
          narrows={false}
          className={className}
          choices={[
            { value: "dealt" as typeof order, label: "As added", icon: <Clock /> },
            // Offered while new papers wait, and kept while it is the order chosen: voting on the last new paper must not rename the order to another.
            ...(toDo.some((one) => one.batch !== undefined) || order === "fresh" ? [{ value: "fresh" as typeof order, label: "New papers first", icon: <RefreshCw /> }] : []),
            { value: "lean" as typeof order, label: "Included by the models first", icon: <ModelsIcon /> },
          ]}
        />
      ) : null}
    </>
  );
  // A queue with nothing in it, not because of a search: the whole width says so, under the queue's tabs.
  if (!paper && !narrowed) {
    return (
      <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        {open.isReviewer ? <div className={QUEUE_BAR}><div className={QUEUE_TABS}>{tabs}</div></div> : null}
        <div className="lg:flex lg:flex-1 lg:flex-col lg:justify-center"><Empty open={open} queue={queue} /></div>
      </div>
    );
  }

  const voteButton = (decision: Decision) => {
    const Icon = RESULT_STYLE[decision].icon;
    const on = resolving ? Boolean(state?.resolvedBy) && state?.final === decision : mine?.decision === decision;
    // Only a vote fills a button: under the pointer an unpressed one darkens its border and keeps the card behind it, so it never reads as chosen.
    const look = {
      include: on ? "bg-success text-success-foreground" : "border-success/35 ink-success hover:border-success/70",
      maybe: on ? "bg-warning text-warning-foreground" : "border-warning/40 ink-warning hover:border-warning/80",
      exclude: on ? "bg-destructive text-destructive-foreground" : "border-destructive/30 ink-destructive hover:border-destructive/60",
    }[decision];
    return (
      <button
        key={decision}
        type="button"
        data-decision
        aria-pressed={on}
        aria-haspopup={decision === "exclude" ? "menu" : undefined}
        onClick={decision === "exclude" && !tablet ? undefined : () => press(decision)}
        className={cn("flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors", on ? "border-transparent" : look, on && look, !on && pointed === decision && "border-dashed border-current")}
      >
        <Icon className="size-4" />
        {DECISION_LABEL[decision]}
        <Kbd className={cn("max-lg:hidden @max-[30rem]/vote:hidden", decision === "include" && "font-mono", on && "border-current/30 bg-transparent text-current")}>{KEYS[decision]}</Kbd>
      </button>
    );
  };

  // What the reviewers said to each other about it, where its votes show and there is something to talk over. Drawn with the votes, in whichever of their two places is on the page.
  const discussion = paper && visible && discussed(open, paper) ? <div data-discussion><Discussion open={open} paper={paper} /></div> : null;
  // Where a rule keeps it shut for someone who could write in it, the rule stands in its place: the others' votes are still hidden, or the paper has had no conflict.
  const noDiscussion = paper && !discussion && (open.isReviewer || open.canResolve) ? <DiscussionShut open={open} by={visible ? "conflict" : "vote"} /> : null;
  const said = paper ? open.thread(paper).length : 0;
  // What scrolls is the outside system: the discussion is brought to the top of its pane from a laptop's width, and of the page under that. The page is moved by hand, for the reason `openIt` gives.
  const reach = (mark: "data-discussion" | "data-votes") => {
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
  const everyonesVotes = paper ? (
                    <Section
                      title="Everyone's votes"
                      help={
                        <Help title="Reading the votes" facts={<><HelpFact icon={SHUT.vote.icon}>{SHUT.vote.says}</HelpFact><HelpFact icon={Hourglass}>No vote yet</HelpFact><HelpFact icon={TriangleAlert}>Couldn&apos;t read it</HelpFact><HelpFact><StateChip tone="info" className="-ms-1 h-4 px-1 text-2xs">Differ</StateChip>Reviewers answered it differently</HelpFact><HelpFact><span className="-ms-1 flex scale-75"><AnswerMark answer="yes" label="A model's answer" pressable /></span>Opens the passage a model read</HelpFact></>}>
                          Each column is a reviewer and each row a criterion, with their vote in the last row. Press a face for that reviewer&apos;s vote and note, and a model&apos;s answer for the passage it read. A model that couldn&apos;t read a paper has no say in it.
                        </Help>
                      }
                      aside={
                        !visible ? (
                          <ShutChip by="vote" />
                        ) : state ? (
                          <>
                            <span className="text-xs text-muted-foreground">Result</span>
                            <ResultChip result={state.result} />
                            {state.result === "conflict" ? <><Tally votes={cast.flatMap((one) => one.vote ?? [])} /><span className="text-xs text-muted-foreground">For {resolver} to settle</span></> : null}
                            {state.result === "waiting" && waitsOn.length ? <span className="text-xs text-muted-foreground">from {waitsOn.slice(0, 2).join(" and ")}{waitsOn.length > 2 ? ` and ${waitsOn.length - 2} more` : ""}</span> : null}
                            {state.resolvedBy ? <span className="min-w-0 truncate text-xs text-muted-foreground">Settled by {state.resolvedBy === open.me ? "you" : (personOf(state.resolvedBy)?.name ?? "a reviewer")}</span> : null}
                            {/* What the reviewers said about it is further down the pane: this goes there. */}
                            {discussion ? <Button variant="ghost" size="xs" className="h-6 gap-1 px-1.5 text-xs" onClick={toDiscussion}><MessagesSquare />{said ? `${said} ${said === 1 ? "message" : "messages"}` : "Discuss"}</Button> : null}
                            {!state.resolvedBy && state.result === "exclude" && cast.some((one) => one.vote?.reason) ? <ReasonChip reason={cast.find((one) => one.vote?.reason)!.vote!.reason!} criteria={criteria} /> : null}
                          </>
                        ) : null
                      }
                    >
                      {state?.resolvedBy && state.note ? <p className="text-sm text-muted-foreground">{inQuotes(state.note)}</p> : null}
                      <div data-votes className="scroll-mt-4 overflow-x-auto rounded-2xl border border-border-subtle p-3">
                        <Matrix
                          criteria={criteria}
                          cast={cast}
                          me={open.me}
                          hidden={!visible}
                          shown={shown}
                          onShow={setShown}
                          passage={quoting && quotedCriterion ? (quoting.reviewer.kind === "model" ? <Evidence paper={paper} reviewer={quoting.reviewer} criterion={quotedCriterion} criteria={criteria} answer={quoting.vote?.answers[quotedCriterion.key]} /> : <Said reviewer={quoting.reviewer} vote={quoting.vote} criterion={quotedCriterion} criteria={criteria} you={quoting.reviewer.id === open.me} />) : null}
                        />
                      </div>
                      {visible ? null : <ShutNote by="vote">{VOTES_SHUT}</ShutNote>}
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
  const failed = failing ? criteria.filter((criterion) => criterion.must && given[criterion.key] === given[failing.key]) : [];
  const numbers = failed.map((criterion) => criteria.indexOf(criterion) + 1);
  const why = failing ? `you answered ${given[failing.key] === "no" ? "No" : "Unclear"} to ${numbers.length > 1 ? `criteria ${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}, must-haves` : `criterion ${numbers[0]}, a must-have`}` : "";
  const hint = against && mine ? (
    <Panel tone="warning" className="px-3 py-2.5 text-xs ink-warning">You voted {DECISION_LABEL[mine.decision]}, and your answers point to {DECISION_LABEL[pointsTo!.decision]}{why ? `: ${why}` : ""}.</Panel>
  ) : pointed && failing ? (
    <Panel className="px-3 py-2.5 text-xs text-muted-foreground">Your answers point to <span className="font-medium text-foreground">{DECISION_LABEL[pointed]}</span>: {why}. Your vote is not cast yet.</Panel>
  ) : pointed ? (
    <Panel className="px-3 py-2.5 text-xs text-muted-foreground">Your answers point to <span className="font-medium text-foreground">Include</span>: every must-have is met. Your vote is not cast yet.</Panel>
  ) : null;
  // The same in one line, for the bar a phone holds at its foot: a paragraph there covers the answer just given.
  const hintLine = against && mine ? (
    <p className="truncate text-xs ink-warning">You voted {DECISION_LABEL[mine.decision]}. Your answers point to <span className="font-medium">{DECISION_LABEL[pointsTo!.decision]}</span>.</p>
  ) : pointed ? (
    <p className="truncate text-xs text-muted-foreground">Your answers point to <span className="font-medium text-foreground">{DECISION_LABEL[pointed]}</span>. Not cast yet.</p>
  ) : null;

  return (
    <>
      <div className={cn("grid grid-cols-1 max-lg:pb-64 lg:min-h-0 lg:flex-1 lg:divide-x lg:divide-border-subtle", COLUMNS, SLIDES, folded ? FOLDED : WIDE)}>
        {/* The queue's bar: its tabs and the way to its list, over the queue and the paper from a laptop's width. The button has one place and one look. From 1400px it hides the queue's pane and shows it again, and under that it opens the list over the page. */}
        {/* With no paper to show, the bar has the whole width, as there are no answers to sit beside. */}
        <div className={cn("flex flex-col gap-2 lg:col-start-1 lg:row-start-1 lg:flex-row lg:items-center lg:gap-3", QUEUE_BAR, paper ? "min-[87.5rem]:col-end-3" : "lg:-col-end-1 lg:border-e-0")}>
            {/* The button starts where the paper's text does, and stays there while the queue's column closes. */}
            <div className={QUEUE_TABS}>{tabs}</div>
            {/* Under 1400px the queue's list has no column of its own. It opens over the page, with its search and filters: from the foot on a phone, from the side on a wider screen. While a search or a filter narrows the queue the button stays, so the search can be changed. */}
            {items.length > 1 || narrowed ? <Button variant="outline" size="sm" className="w-full shrink-0 lg:w-auto min-[87.5rem]:hidden" onClick={() => setListing(true)}><ListChecks />See the queue</Button> : null}
            <Button variant="outline" size="sm" aria-expanded={!folded} className="ms-8 shrink-0 max-[87.5rem]:hidden" onClick={() => setMock({ folded: !folded })}>
              {folded ? <PanelLeftOpen /> : <PanelLeft />}
              {/* Both names take the same room, so the one that shows never moves what follows the button. */}
              <span className="grid *:col-start-1 *:row-start-1"><span className={cn(folded && "invisible")}>Hide the queue</span><span className={cn(!folded && "invisible")}>Show the queue</span></span>
            </Button>
            {askedChip}
            <Sheet open={listing} onOpenChange={setListing}>
              <SheetContent side={tablet ? "bottom" : "left"} className={cn("flex flex-col gap-0 p-0 min-[87.5rem]:hidden", tablet && "max-h-[85dvh]")}>
                <SheetHeader className="space-y-3 border-b border-border-subtle p-4">
                  <SheetTitle>{QUEUE_LABEL[queue]}</SheetTitle>
                  <SheetDescription className="sr-only">Every paper in this queue. Press one to open it.</SheetDescription>
                  {findField("")}
                  {queueFilters(QUEUE_FILTER)}
                </SheetHeader>
                <ul className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto">
                  {items.slice((shownPage - 1) * QUEUE_PAGE, shownPage * QUEUE_PAGE).map((one) => row(one, (picked) => { openIt(picked); setListing(false); }))}
                  {!items.length ? <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing in this queue matches</li> : null}
                </ul>
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
                {items.slice((shownPage - 1) * QUEUE_PAGE, shownPage * QUEUE_PAGE).map((one) => row(one, openIt))}
              </ul>
            </ScrollArea>
            {pages > 1 ? <div className="flex justify-center border-t border-border-subtle px-2 py-1.5">{pager("w-28")}</div> : null}
          </div>
        </div>

        {!paper ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center lg:col-start-1 lg:-col-end-1 lg:row-start-2 min-[87.5rem]:col-start-2">
            <p className="text-sm font-medium">Nothing in this queue matches</p>
            <Button size="sm" variant="outline" onClick={() => void setPlace({ paper: null, q: null, voted: null, page: null }, { history: "replace" })}>Show the whole queue</Button>
          </div>
        ) : (
          <>
            {/* The paper, and everyone's votes under it: the pane in the middle, which a long paper scrolls. */}
            <div className={cn("lg:col-start-1 lg:row-start-2 lg:flex lg:flex-col min-[87.5rem]:col-start-2", PANE)}>
            <ScrollArea shades className="lg:min-h-0 lg:flex-1">
              <div ref={article} tabIndex={-1} role="region" aria-label="Paper" className={cn("outline-none", BELOW_HEADER)}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={paper.id} ref={startAtTop} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: EASE }} className={cn("max-w-[46rem] space-y-8 p-5 sm:p-8 2xl:max-w-none", folded && "min-[87.5rem]:max-w-none")}>
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
                          <motion.span aria-hidden style={{ opacity: includeShows }} className="pointer-events-none absolute start-0 top-0 z-10 -rotate-6 rounded-lg border-2 border-success bg-card px-2 py-0.5 text-sm font-bold ink-success">Include</motion.span>
                          <motion.span aria-hidden style={{ opacity: excludeShows }} className="pointer-events-none absolute end-0 top-0 z-10 rotate-6 rounded-lg border-2 border-destructive bg-card px-2 py-0.5 text-sm font-bold ink-destructive">Exclude</motion.span>
                        </>
                      ) : null}
                      <h2 className="text-xl font-semibold leading-snug tracking-tight text-balance">{paper.title}</h2>
                      <p className="text-sm text-muted-foreground">{paper.authors.join(", ")}. <span className="italic">{paper.venue}</span>, {paper.year}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Where the paper came from, said as that: a search's name is its query, which was taken for a label on the paper. */}
                        {source ? <LinkChip href={papersHref(id, { source: source.id })} icon={kindIcon(source.kind)} aria-label={`See the ${fromSource} papers from ${source.name}`} className="max-w-80 [&>span]:shrink">From {source.name}</LinkChip> : null}
                        {paper.batch !== undefined ? <LinkChip href={papersHref(id, { added: String(paper.batch) })} tone="primary" icon={RefreshCw}>New, added {ago(paper.batch)}</LinkChip> : null}
                        <Chip icon={Quote}>Cited by {paper.cited.toLocaleString("en-GB")}</Chip>
                        {/* The made-up papers have no page of their own: a search for the title finds the paper, in a new tab so the place in the queue is kept. */}
                        <LinkChip href={`/results?q=${encodeURIComponent(paper.title)}`} target="_blank" rel="noreferrer" icon={ExternalLink}>Find the full text</LinkChip>
                        {/* That reviewers have written about the paper shows as it opens, with the way to what they wrote. */}
                        {discussion && said ? <button type="button" onClick={toDiscussion} className="flex h-6 items-center gap-1 rounded-full bg-primary/10 px-2 text-xs font-medium text-primary outline-none transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/50"><MessagesSquare aria-hidden className="size-3.5" />{said} {said === 1 ? "message" : "messages"}</button> : null}
                      </div>
                      {!paper.sentences.length ? (
                        <div className="flex items-center gap-1.5 rounded-2xl border border-dashed border-border px-5 py-5 text-sm text-muted-foreground">
                          No abstract
                          <Help title="Papers without an abstract" facts={<HelpFact>Models vote on the title alone</HelpFact>}>Vote on the title, or vote Maybe to keep the paper open.</Help>
                        </div>
                      ) : paper.original && !translated ? (
                        <div className="space-y-3">
                          <p lang="fr" className="text-[0.95rem] leading-7">{paper.original.text}</p>
                          <Button variant="outline" size="sm" onClick={() => setTranslated(true)}><TranslateIcon />Translate from {paper.original.language}</Button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-[0.95rem] leading-7">
                            {paper.sentences.map((sentence, i) => <Sentence key={i} at={i} text={sentence} quoted={quotedSentence === i} terms={criteria.flatMap((c) => c.terms)} />)}
                          </p>
                          {/* What the marked words are, under the text they are in: they were taken for evidence someone had picked. */}
                          {criteria.some((criterion) => criterion.terms.length) ? <p className="text-xs text-muted-foreground"><mark className="rounded-sm bg-primary/15 px-1 text-foreground">Marked</mark> words are ones the criteria look for.</p> : null}
                          {paper.original ? <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setTranslated(false)}><TranslateIcon />Translated from {paper.original.language}. Show the original</Button> : null}
                        </div>
                      )}
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
              <div className={cn("p-5", BESIDE)}>
                <Section
                  title={answering ? "Your answers" : "Criteria"}
                  help={
                    <Help title={answering ? "Your answers" : "Criteria"} side={tablet ? undefined : "left"} facts={<><HelpFact icon={Asterisk}>Must-have</HelpFact><HelpFact icon={CircleHelp}>Guidance: what counts and what doesn&apos;t</HelpFact><HelpFact icon={FileSearch}>Passage: the sentence of this paper that speaks to it</HelpFact><HelpFact><mark className="-ms-0.5 rounded-sm bg-primary/15 px-1 text-foreground">Marked</mark>Words the criteria look for</HelpFact></>}>
                      {answering ? "Answering is optional: one vote is enough. A paper that fails a must-have is excluded, and Exclude asks which one it failed unless your answers already say." : "The questions each reviewer answers for a paper, and under each how they answered it. A paper that fails a must-have is excluded."}
                    </Help>
                  }
                >
                  {/* What the star means, in sight: it was taken for "an answer is required". */}
                  {criteria.some((criterion) => criterion.must) ? <p className="text-xs leading-5 text-muted-foreground"><span className="-ms-1 me-1"><RequiredMark /></span>A must-have: a paper that fails one is excluded.{answering ? " Answers are optional and are not your vote." : ""}</p> : null}
                  {criteria.length ? (
                    <ol key={paper.id} className={LIST}>
                      {criteria.map((criterion, i) => {
                        const answered = answers[paper.id]?.[criterion.key] ?? (resolving ? undefined : mine?.answers[criterion.key]);
                        const split = cast.flatMap((one) => one.vote?.answers[criterion.key] ?? []);
                        const passage = sentenceOf(criterion);
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
                            {/* What helps with the answer, each named under the question and opened in place, so nothing covers the answers: the guidance its author wrote, which stays open from paper to paper, and the passage of this paper that speaks to it. */}
                            {criterion.note || passage >= 0 ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 ps-6.5">
                                {criterion.note ? (
                                  <button type="button" aria-expanded={guided} onClick={() => setMock({ guides: guided ? guides.filter((one) => one !== guideKey) : [...guides, guideKey] })} className={cn(AID, guided ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                    <CircleHelp aria-hidden className="size-3.5" />Guidance<ChevronDown aria-hidden className={cn("size-3 opacity-60 transition-transform duration-200", guided && "rotate-180")} />
                                  </button>
                                ) : null}
                                {passage >= 0 ? (
                                  <button type="button" aria-expanded={current === criterion} aria-label={`Passage for criterion ${i + 1}`} onClick={() => light(criterion)} className={cn(AID, current === criterion ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                                    <FileSearch aria-hidden className="size-3.5" />Passage<ChevronDown aria-hidden className={cn("size-3 opacity-60 transition-transform duration-200", current === criterion && "rotate-180")} />
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
                              {current === criterion && passage >= 0 ? (
                                <motion.div key="passage" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden">
                                  <p className="ms-6.5 mt-2 flex gap-2 rounded-xl bg-warning/12 p-2.5 text-sm leading-5"><Quote aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span>{paper.sentences[passage]}</span></p>
                                </motion.div>
                              ) : null}
                            </AnimatePresence>
                            {answering ? (
                              <div role="radiogroup" aria-label={`Your answer to criterion ${i + 1}`} className="mt-2.5 grid grid-cols-3 gap-1.5 ps-6.5">
                                {ANSWERS.map((answer) => {
                                  const { icon: Icon, label, tone } = ANSWER_SIGN[answer];
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
                                  const { icon: Icon, label, tone } = ANSWER_SIGN[answer];
                                  // The answer by name with how many gave it: a sign and a number alone had to be worked out.
                                  return count ? <span key={answer} className={cn("flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium tabular-nums", TONE[tone].chip)}><Icon aria-hidden className="size-3.5" />{label} {count}</span> : null;
                                })}
                                {new Set(split).size > 1 ? <button type="button" aria-label={`Criterion ${i + 1}: show the answer that differs`} onClick={() => showApart(criterion)} className={DIFFER}>Differ<ChevronRight aria-hidden className="size-3" /></button> : null}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <Panel className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="min-w-0 flex-1 text-muted-foreground">No criteria yet</span>
                      {open.canChange ? <Button asChild size="sm" variant="outline"><NextLink href={settingsHref(id, "criteria")}>Add criteria</NextLink></Button> : null}
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
        <ActionBar className="max-lg:fixed max-lg:inset-x-0 max-lg:z-30 lg:shrink-0">
          <div className={cn("flex flex-col gap-2 px-3 pt-3 pb-[max(1.75rem,env(safe-area-inset-bottom))] lg:grid lg:items-stretch lg:gap-0 lg:p-0", BAR_HEIGHT, BAR_COLUMNS, SLIDES, folded && BAR_FOLDED)}>
            {/* Where you are */}
            <div className="flex flex-wrap items-center gap-1 max-lg:order-last max-lg:min-h-10 max-lg:ps-9 max-lg:pe-[4.5rem] lg:content-center lg:gap-y-1.5 lg:px-4 lg:py-2">
              {/* How many are left, and from 1400px how long they take at the person's pace. On a phone the queue's tab already counts them, and the row keeps its room for the last vote and the note. */}
              <span className="me-1 flex items-baseline gap-1.5 text-xs tabular-nums max-sm:hidden">
                <span className="font-medium">{queue === "done" || !mayDecide ? `${at + 1} of ${items.length}` : `${left.toLocaleString("en-GB")} left`}</span>
                {timeLeft ? <span className="text-muted-foreground max-[87.5rem]:hidden">{timeLeft}</span> : null}
              </span>
              <TooltipHint label="Previous paper"><Button variant="ghost" size="icon" className="size-7" aria-label="Previous paper" disabled={at <= 0} onClick={() => go(at - 1)}><ChevronLeft /></Button></TooltipHint>
              <TooltipHint label="Next paper"><Button variant="ghost" size="icon" className="size-7" aria-label="Next paper" disabled={at >= items.length - 1} onClick={() => go(at + 1)}><ChevronRight /></Button></TooltipHint>
              {/* Under 1400px the last vote has no part of the bar to itself, so its way back sits here. */}
              {/* With it, the vote it takes back, and a pen on its corner where a note was saved with it: on these widths nothing else says what was just saved. */}
              {last ? <span className="flex items-center gap-1 min-[87.5rem]:hidden"><TooltipHint label="Undo the last vote"><Button variant="ghost" size="icon" className="size-8" aria-label="Undo the last vote" onClick={undo}><Undo2 /></Button></TooltipHint><span className="relative flex"><VoteMark vote={{ decision: last.decision }} who={last.resolved ? "Settled as" : "Your last vote"} />{last.noted ? <PenLine role="img" aria-label="Saved with a note" className="absolute -end-1.5 -top-1.5 size-3.5 rounded-full bg-card p-px text-muted-foreground" /> : null}</span></span> : null}
              <Popover open={keysOpen} onOpenChange={setKeysOpen}>
                <TooltipHint label="Shortcuts">
                  {/* The key that opens the list is the button. Its name shows beside it where the bar has the room. */}
                  <PopoverTrigger asChild><Button variant="ghost" size="sm" className="ms-auto h-7 gap-1.5 px-1.5 text-xs text-muted-foreground max-lg:hidden" aria-label="Shortcuts"><span className="max-2xl:hidden">Shortcuts</span><Kbd>?</Kbd></Button></PopoverTrigger>
                </TooltipHint>
                <PopoverContent align="start" side="top" className="w-80 space-y-2 p-3">
                  <p className="text-sm font-semibold">Shortcuts</p>
                  {SHORTCUTS.filter(([, , who]) => !who || (who === "vote" ? mayDecide : answering)).map(([keys, what]) => (
                    <p key={what} className="flex items-center gap-3 text-sm">
                      <span className="flex w-28 shrink-0 items-center gap-1 text-xs text-muted-foreground">{keys.map((key, i) => <span key={key} className="flex items-center gap-1">{i ? "or" : null}<Kbd className={key === "I" ? "font-mono" : undefined}>{key}</Kbd></span>)}</span>
                      <span>{what}</span>
                    </p>
                  ))}
                </PopoverContent>
              </Popover>
              {mayDecide && queue !== "done" ? (
                <label className="flex basis-full items-center justify-between gap-2 text-xs text-muted-foreground max-lg:hidden">
                  Next paper after each vote
                  <Switch checked={advance} onCheckedChange={setAdvance} aria-label="Go to the next paper after a vote" />
                </label>
              ) : null}
              {madeConflict && last ? <LinkChip href={screenHref(id, { queue: "conflicts", paper: last.paper.id })} tone="info" icon={GitCompare} className="min-[87.5rem]:hidden">Now in Conflicts</LinkChip> : null}
              {/* The note's field takes a row of a small screen, so it opens from its own button there. The two stay together: a very narrow phone moves both to a second line. */}
              <span className="ms-auto flex items-center gap-1 lg:hidden">
                {mayDecide && !resolving ? <Button variant={noteOpen ? "secondary" : "ghost"} size="sm" aria-pressed={noteOpen} className="h-8 gap-1.5 px-2 text-xs" onClick={toggleNote}><PenLine />Note</Button> : null}
                {mayDecide && queue !== "done" ? (
                  <Popover>
                    <PopoverTrigger asChild><Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="More for this paper"><MoreHorizontal /></Button></PopoverTrigger>
                    <PopoverContent align="end" side="top" className="w-72 space-y-3 p-3">
                      <label className="flex items-center gap-3 text-sm">
                        <span className="min-w-0 flex-1">Next paper after each vote</span>
                        <Switch checked={advance} onCheckedChange={setAdvance} aria-label="Go to the next paper after a vote" />
                      </label>
                      {/* What a drag of the paper does, on a paper that can be dragged: one still to vote on. */}
                      {swipeable ? (
                        <div className="flex flex-wrap gap-1.5 border-t border-border-subtle pt-3">
                          <StateChip tone="success" icon={ArrowRight}>Drag the paper right to include</StateChip>
                          <StateChip tone="destructive" icon={ArrowLeft}>Drag it left to exclude</StateChip>
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
                <p className="flex items-center gap-2 rounded-xl bg-inset px-3 py-3 text-sm text-muted-foreground">
                  <Eye className="size-4 shrink-0" />
                  {resolving ? `${resolver === "you" ? "You settle" : `${resolver} settles`} conflicts on this screening. You can read them here.` : "You aren't one of this screening's reviewers."}
                </p>
              ) : writing === paper.id ? (
                <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); decideOn("exclude", OTHER); }}>
                  <Input autoFocus value={notes[paper.id] ?? ""} onChange={(event) => setNotes((all) => ({ ...all, [paper.id]: event.target.value }))} placeholder="Why exclude it?" aria-label="Why exclude it" className="h-8 text-sm" />
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={() => setWriting(null)}>Back</Button>
                    <Button type="submit" variant="destructive" className="h-10 rounded-xl" disabled={!notes[paper.id]?.trim()}><X />Exclude</Button>
                  </div>
                </form>
              ) : (
                <>
                  {/* With every paper in the queue voted on, the line above the buttons says so: the buttons stay, to change a vote. */}
                  {through ? (
                    <div className="flex h-8 items-center gap-2">
                      <CircleCheck className="size-4 shrink-0 text-muted-foreground" />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{resolving ? "Every conflict here is settled" : "You voted on every paper here"}</p>
                      {!resolving && conflicts.length ? <Button asChild size="sm" className="shrink-0" variant={open.canResolve ? "default" : "outline"}><NextLink href={screenHref(id, { queue: "conflicts" })}><GitCompare />{open.canResolve ? "Settle" : "See"} {conflicts.length} {conflicts.length === 1 ? "conflict" : "conflicts"}</NextLink></Button> : null}
                      {resolving && toDo.length ? <Button asChild size="sm" className="shrink-0"><NextLink href={screenHref(id)}><ListChecks />Screen {toDo.length} {toDo.length === 1 ? "paper" : "papers"}</NextLink></Button> : null}
                    </div>
                  ) : null}
                  {/* The note, and for a conflict the reason it is settled with: a field over the buttons, open when asked for, when it holds a note, and always for a conflict. It slides open, so the bar grows without a jump. */}
                  <AutoHeight className="-mb-2">
                    {noteOpen ? (
                      <div className="flex items-center gap-3 pb-2">
                        {resolving ? (
                          <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
                            Settle this conflict
                            <Help title="Settling a conflict" side="top" facts={<>{mine ? <HelpFact icon={RESULT_ICON[mine.decision]}><Named name="Your own vote">{DECISION_LABEL[mine.decision]}</Named></HelpFact> : null}<HelpFact><Named name="Rule">{RULE_LABEL[screening.rule.settle]}</Named></HelpFact></>}>
                              The reviewers split on this paper. Your vote becomes its result, whatever they voted. Maybe keeps it open.
                            </Help>
                          </span>
                        ) : null}
                        <Input data-note value={notes[paper.id] ?? (resolving ? "" : (mine?.note ?? ""))} onChange={(event) => setNotes((all) => ({ ...all, [paper.id]: event.target.value }))} placeholder={resolving ? "Why, for the record (optional)" : "A note for the others, saved with your vote"} aria-label="Note" className="h-8 min-w-0 flex-1 text-sm max-lg:hidden" />
                        <Textarea data-note rows={2} value={notes[paper.id] ?? (resolving ? "" : (mine?.note ?? ""))} onChange={(event) => setNotes((all) => ({ ...all, [paper.id]: event.target.value }))} placeholder={resolving ? "Why, for the record (optional)" : "A note for the others, saved with your vote"} aria-label="Note" className="max-h-24 min-h-0 min-w-0 flex-1 resize-none py-1.5 text-sm lg:hidden" />
                      </div>
                    ) : null}
                  </AutoHeight>
                  {/* On a narrow screen what your answers point to sits over the buttons it is about. */}
                  <AutoHeight className="-mb-2 lg:hidden">{hintLine ? <div className="pb-2">{hintLine}</div> : null}</AutoHeight>
                  <div className="flex items-center gap-2">
                    {/* On a wide screen the note's button is with the vote it goes with, always by name: a pen alone was taken for a way to enlarge the paper. Where the row is short of room the votes give up their key hints. */}
                    {!resolving ? <Button type="button" variant={noteOpen ? "secondary" : "outline"} aria-pressed={noteOpen} className="h-10 shrink-0 gap-1.5 rounded-xl px-3 text-sm max-lg:hidden" onClick={toggleNote}><PenLine />Note</Button> : null}
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
                                    <span className="min-w-0 flex-1">{reason.label}</span>
                                    {reason.hotkey ? <Kbd>{reason.hotkey}</Kbd> : null}
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
                    <span className="shrink-0">{last.resolved ? "Last settled as" : "Your last vote:"} <span className="font-medium text-foreground">{last.resolved ? RESULT_LABEL[last.decision] : DECISION_LABEL[last.decision]}</span>{last.noted ? ", with a note" : ""}</span>
                    {/* Exclude takes its reason from your answers where they say it: the reason it took shows here, cut short before the vote's own words are. Where the answers failed more must-haves than the one, they are counted: each is kept with the vote's answers. */}
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      {last.decision === "exclude" && last.reason && criteria.some((criterion) => criterion.key === last.reason) ? <Reason reason={last.reason} criteria={criteria} className="min-w-0 shrink text-foreground" /> : null}
                      {alsoFailed ? <span className="shrink-0 tabular-nums" role="img" aria-label={`and ${alsoFailed} more`}>+{alsoFailed}</span> : null}
                    </span>
                    <Button variant="ghost" size="xs" className="shrink-0" onClick={undo}><Undo2 />Undo<Kbd>Z</Kbd></Button>
                  </div>
                  {last.paper.id !== paper.id || madeConflict || differ ? (
                    <div className="flex min-w-0 items-center gap-2">
                      {last.paper.id !== paper.id ? (
                        <TooltipHint label={last.paper.title} onlyWhenClipped>
                          <button type="button" onClick={() => openIt(last.paper)} className="min-w-0 flex-1 truncate text-start text-foreground hover:underline">{inQuotes(last.paper.title)}</button>
                        </TooltipHint>
                      ) : <span className="flex-1" />}
                      {madeConflict ? (
                        <LinkChip href={screenHref(id, { queue: "conflicts", paper: last.paper.id })} tone="info" icon={GitCompare} className="shrink-0">Now in Conflicts</LinkChip>
                      ) : differ ? (
                        // Where the paper stands now says what a different vote led to: still waiting for votes, or settled by the rule.
                        <span className="flex shrink-0 items-center gap-1.5">{differ} voted differently<ResultChip result={settled[last.paper.id]!.result} /></span>
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
              <SheetTitle>Why exclude it?</SheetTitle>
              <SheetDescription className="sr-only">Pick the reason this paper is excluded.</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {reasonGroups.map((group) => (
                <div key={group.name} role="group" aria-label={group.name} className="space-y-1.5">
                  <p className="px-1 text-xs font-medium text-muted-foreground">{group.name}</p>
                  {group.list.map((reason) => (
                    <button key={reason.key} type="button" onClick={() => decideOn("exclude", reason.key)} className="flex min-h-11 w-full items-center rounded-xl border border-border-subtle px-3 py-2 text-start text-sm transition-colors hover:bg-muted">{reason.label}</button>
                  ))}
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}

/** What a queue says when it holds nothing, and where to go from there. */
function Empty({ open, queue }: { open: Open; queue: Queue }) {
  const id = open.screening.id;
  const voted = open.yours.length - open.toDo.length;
  const [Icon, title, line]: [AppIcon, string, ReactNode] = !open.isReviewer
    ? [Eye, "You can't vote on this screening", null]
    : queue === "todo"
      ? open.gathering
        ? [Hourglass, "Its papers are on their way", `${open.gathering.done.toLocaleString("en-GB")} of ${open.gathering.of.toLocaleString("en-GB")} are in`]
        : open.yours.length ? [CircleCheck, "You have voted on all your papers", null] : [ListChecks, "No paper has been dealt to you", null]
      : queue === "conflicts"
        ? [GitCompare, "No conflict to settle", null]
        : [ListChecks, "You haven't voted on a paper yet", null];
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="size-5" /></span>
      <p className="text-sm font-medium">{title}</p>
      {line ? <p className="max-w-sm text-sm tabular-nums text-muted-foreground">{line}</p> : null}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {open.isReviewer && queue === "todo" && voted ? <Button asChild size="sm"><NextLink href={screenHref(id, { queue: "done" })}>See your {voted.toLocaleString("en-GB")} votes</NextLink></Button> : null}
        {open.isReviewer && queue !== "conflicts" && open.conflicts.length ? <Button asChild size="sm" variant={open.canResolve ? "default" : "outline"}><NextLink href={screenHref(id, { queue: "conflicts" })}><GitCompare />{open.canResolve ? "Settle" : "See"} {open.conflicts.length} {open.conflicts.length === 1 ? "conflict" : "conflicts"}</NextLink></Button> : null}
        {open.isReviewer && queue !== "todo" && open.toDo.length ? <Button asChild size="sm"><NextLink href={screenHref(id)}><ListChecks />Screen {open.toDo.length} {open.toDo.length === 1 ? "paper" : "papers"}</NextLink></Button> : null}
        {!open.isReviewer && open.canChange && !open.screening.finishedAt ? <Button size="sm" onClick={open.join}><UserPlus />Join as a reviewer</Button> : null}
        <Button asChild size="sm" variant="outline"><NextLink href={papersHref(id)}>See all the papers</NextLink></Button>
      </div>
    </div>
  );
}

/** Why a paper was excluded, as a chip that shows the criterion's question when pointed at. */
function ReasonChip({ reason, criteria }: { reason: string; criteria: Criterion[] }) {
  return <QuestionName question={questionOf(reason, criteria)} label={failedLabel(reason, criteria)} className="inline-flex"><Chip><Reason reason={reason} criteria={criteria} /></Chip></QuestionName>;
}

/** A sentence of the abstract, with the criteria's words marked, and the whole of it marked where it is the passage being looked at. */
function Sentence({ at, text, quoted, terms }: { at: number; text: string; quoted: boolean; terms: string[] }) {
  const words = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const parts = words.length ? text.split(new RegExp(`\\b(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi")) : [text];
  return (
    <span data-sentence={at} className={cn("scroll-my-6 rounded box-decoration-clone transition-colors duration-300", quoted && "bg-warning/20")}>
      {parts.map((part, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-primary/15 text-foreground">{part}</mark> : part))}{" "}
    </span>
  );
}

/** A reviewer's face at the head of their column, with their name under it where the table has the room: it opens their vote, its reason and their note. */
function Face({ reviewer, vote, failed, you, kept, criteria, named }: { reviewer: Reviewer; vote: Vote | undefined; failed?: boolean; you: boolean; kept: boolean; criteria: Criterion[]; /** The classes that show the name, from the width where the columns are wide enough for it. */ named: string }) {
  const style = vote ? RESULT_STYLE[vote.decision] : null;
  return (
    <Popover>
      <TooltipHint label={you ? `${reviewer.name}, you` : reviewer.name}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`${reviewer.name}${you ? ", you" : ""}: their vote`} className="mx-auto flex max-w-full flex-col items-center gap-1 self-start rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
            {/* Dimmed for someone taken off the screening, whose vote on this paper still counts. */}
            <span className={cn("flex", reviewer.left && "opacity-55")}><ReviewerMark reviewer={reviewer} you={you} /></span>
            {/* A person by their first name, a model by its own, on two lines at most. */}
            {/* The clamp sets its own display, so what hides the name is a box around it. */}
            <span aria-hidden className={cn("hidden max-w-full", named)}><span className={cn("text-center text-2xs leading-3 text-muted-foreground line-clamp-2", you && "font-medium text-foreground")}>{you ? "You" : reviewer.kind === "person" && !reviewer.email ? reviewer.name.split(" ")[0] : reviewer.name}</span></span>
          </button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent side="top" align="center" className="w-72 space-y-2.5 p-3">
        <div className="flex items-center gap-2.5">
          <ReviewerMark reviewer={reviewer} className="size-8" />
          <ReviewerName reviewer={reviewer} you={you} className="text-sm font-medium" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {failed ? (
            <StateChip tone="destructive" icon={TriangleAlert}>Couldn&apos;t read this paper</StateChip>
          ) : kept && vote ? (
            <ShutChip by="vote">Voted, {SHUT.vote.says.toLowerCase()}</ShutChip>
          ) : vote && style ? (
            <StateChip tone={style.tone} icon={style.icon}>{DECISION_LABEL[vote.decision]}</StateChip>
          ) : (
            <Chip icon={Hourglass}>{reviewer.kind === "model" ? "Hasn't read it yet" : "Hasn't voted yet"}</Chip>
          )}
          {!kept && vote?.reason ? <ReasonChip reason={vote.reason} criteria={criteria} /> : null}
          {!kept && vote ? <Chip>{ago(vote.at)}</Chip> : null}
        </div>
        {!kept && vote?.note ? <p className="text-sm text-muted-foreground">{inQuotes(vote.note)}</p> : null}
      </PopoverContent>
    </Popover>
  );
}

/** Each reviewer's answer to each criterion, and their vote: who said what. */
export function Matrix({ criteria, cast, me, shown, onShow, hidden = false, passage }: {
  criteria: Criterion[];
  cast: Array<{ reviewer: Reviewer; vote: Vote | undefined; failed?: boolean }>;
  /** Whose face is ringed as yours. */
  me?: string;
  shown: { reviewer: string; criterion: string } | null;
  onShow: (cell: { reviewer: string; criterion: string } | null) => void;
  /** The others' votes are cast and kept from you until you vote: their squares show a lock. */
  hidden?: boolean;
  /** What opens under the row of the answer that is shown, such as the passage a model read. */
  passage?: ReactNode;
}) {
  const kept = (reviewer: Reviewer) => hidden && reviewer.id !== me;
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
      {me && cast.some((one) => one.reviewer.id === me) ? <span className={cn("flex items-center gap-1.5 self-end pb-1 text-xs text-muted-foreground", wide.key)}><span aria-hidden className="ms-0.5 size-2.5 rounded-full ring-2 ring-primary/70 ring-offset-1 ring-offset-card" />You</span> : <span />}
      {cast.map(({ reviewer, vote, failed }) => <Face key={reviewer.id} reviewer={reviewer} vote={vote} failed={failed} you={reviewer.id === me} kept={kept(reviewer)} criteria={criteria} named={wide.name} />)}
      {/* While the others' votes are kept from you the criteria's rows would hold nothing but locks: the faces and the row of votes say who has voted, and that is all there is to see. */}
      {hidden ? null : criteria.map((criterion, n) => {
        const given = cast.map((one) => (kept(one.reviewer) ? undefined : one.vote?.answers[criterion.key]));
        const split = new Set(given.filter(Boolean)).size > 1;
        return (
          <div key={criterion.key} className="contents">
            <span className="flex min-w-0 items-center gap-1.5 pe-2 text-xs">
              <span className="w-3 shrink-0 tabular-nums text-muted-foreground">{n + 1}</span>
              <QuestionName question={questionOf(criterion.key, criteria)} label={criterion.short} className={cn("min-w-0 truncate max-sm:line-clamp-2 max-sm:whitespace-normal", split ? "font-medium text-foreground" : "text-muted-foreground")}><CriterionText text={criterion.short} must={criterion.must} /></QuestionName>
              {split ? (
                <button type="button" aria-label={`${criterion.short}: show the answer that differs`} onClick={() => { const who = cast[apartAt(given)]; if (who) onShow(shown?.reviewer === who.reviewer.id && shown.criterion === criterion.key ? null : { reviewer: who.reviewer.id, criterion: criterion.key }); }} className={cn(DIFFER, "shrink-0")}>Differ<ChevronDown aria-hidden className="size-3" /></button>
              ) : null}
            </span>
            {cast.map(({ reviewer, vote }, i) => {
              if (kept(reviewer) && vote) {
                return <span key={reviewer.id} role="img" aria-label={`${reviewer.name}, ${criterion.short}: ${SHUT.vote.says.toLowerCase()}`} className="mx-auto flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground"><Lock aria-hidden className="size-3" /></span>;
              }
              const answer = given[i];
              if (!answer) return <span key={reviewer.id} className="mx-auto size-6 rounded-md border border-dashed border-border" />;
              const on = shown?.reviewer === reviewer.id && shown.criterion === criterion.key;
              // Every answer opens what is behind it: a model's the passage it read, a person's their vote and their note.
              return (
                <button key={reviewer.id} type="button" aria-pressed={on} aria-label={`${reviewer.name}, ${criterion.short}: ${reviewer.kind === "model" ? "show the passage" : "show their vote and note"}`} onClick={() => onShow(on ? null : { reviewer: reviewer.id, criterion: criterion.key })} className={cn("mx-auto flex cursor-pointer rounded-md transition-shadow hover:ring-2 hover:ring-border", on && "ring-2 ring-primary/60")}>
                  <AnswerMark answer={answer} label={`${reviewer.name}, ${criterion.short}`} pressable={reviewer.kind === "model" && !on} />
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
      <span className={cn("text-xs font-medium", !hidden && "border-t border-border-subtle pt-2")}>Vote</span>
      {cast.map(({ reviewer, vote, failed }) => (
        <span key={reviewer.id} className={cn("flex justify-center", !hidden && "border-t border-border-subtle pt-2")}><VoteMark vote={vote} hidden={kept(reviewer)} failed={failed} who={reviewer.name} /></span>
      ))}
    </div>
    </div>
  );
}

/** What is behind a person's answer: their vote, the reason they gave for it, and their note, or that they left none. */
export function Said({ reviewer, vote, criterion, criteria, you = false }: { reviewer: Reviewer; vote: Vote | undefined; criterion: Criterion; criteria: Criterion[]; you?: boolean }) {
  const answer = vote?.answers[criterion.key];
  if (!vote || !answer) return null;
  const style = RESULT_STYLE[vote.decision];
  return (
    <div className="space-y-2 rounded-2xl bg-inset p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
        <ReviewerMark reviewer={reviewer} className="size-5" />
        <ReviewerName reviewer={reviewer} you={you} className="font-medium" />
        <span className="text-muted-foreground">voted {ago(vote.at)}</span>
        <span className="ms-auto flex shrink-0 items-center gap-1.5">
          <StateChip tone={style.tone} icon={style.icon}>{DECISION_LABEL[vote.decision]}</StateChip>
          {vote.reason ? <ReasonChip reason={vote.reason} criteria={criteria} /> : null}
          <AnswerMark answer={answer} label={criterion.short} />
        </span>
      </div>
      {vote.note ? <p className="flex gap-2 text-sm leading-5"><Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span>{vote.note}</span></p> : <p className="text-sm text-muted-foreground">{you ? "You left no note with this vote." : "No note with this vote."}</p>}
    </div>
  );
}

/** The passage a model read for one answer, and how sure it is of it. */
export function Evidence({ paper, reviewer, criterion, criteria, answer }: { paper: Paper; reviewer: Reviewer; criterion: Criterion; criteria: Criterion[]; answer?: Answer }) {
  if (!answer) return null;
  const { quote, why } = evidence(paper, criterion, criteria, answer);
  const sure = Math.round(confidenceOf(paper, reviewer, criterion, answer) * 100);
  return (
    <div className="space-y-2 rounded-2xl bg-inset p-3">
      {/* The model's name is never cut: the line takes a second row where the two don't fit. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
        <ReviewerMark reviewer={reviewer} className="size-5" />
        <ReviewerName reviewer={reviewer} className="font-medium" />
        <Help title="How sure the model is" facts={<HelpFact icon={TriangleAlert}>Unsure below 65%</HelpFact>}>The model rates each of its answers from 0 to 100%. Below 65%, read the passage before you rely on that answer.</Help>
        <span className="ms-auto flex shrink-0 items-center gap-2">
          {sure < 65 ? (
            <StateChip tone="warning" icon={TriangleAlert}>Unsure, {sure}%</StateChip>
          ) : (
            <span className="flex items-center gap-1.5 tabular-nums text-muted-foreground"><Meter value={sure} max={100} className="w-12" fill="bg-foreground/45" />{sure}% sure</span>
          )}
          <AnswerMark answer={answer} label={criterion.short} />
        </span>
      </div>
      <p className="flex gap-2 text-sm leading-5"><Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span>{quote}</span></p>
      <p className="text-xs text-muted-foreground">{why}</p>
    </div>
  );
}
