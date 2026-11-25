"use client";

// The open screening's Screen page: your queue on the left, the paper with everyone's votes in the
// middle, your answers to the criteria on the right, and the vote at the foot of the window. One paper
// at a time, voted on with a key. Conflicts are settled in the same place. The page is the only thing
// that scrolls: the paper and the answers stay in view while the queue goes by.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import NextLink from "next/link";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { Asterisk, ChevronLeft, ChevronRight, CircleCheck, Clock, Eye, GitCompare, Hourglass, ListChecks, Lock, ModelsIcon, MoreHorizontal, Quote, RefreshCw, Search, TranslateIcon, TriangleAlert, Undo2, UserPlus, X, type AppIcon } from "@/components/icons";
import { Chip, Meter } from "@/components/screening/parts";
import { EASE } from "@/components/settings/model-map";
import { LIST, Segmented } from "@/components/settings/parts";
import { PageStepper } from "@/components/shared/page-stepper";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpFact } from "@/components/ui/help";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { useIsTablet } from "@/lib/hooks";
import { ANSWERS, type Answer } from "@/lib/screening/setup";
import { cn } from "@/lib/utils";
import { DECISIONS, DECISION_LABEL, OTHER_REASONS, RESULT_LABEL, ago, confidenceOf, decide, evidence, failedLabel, personOf, questionOf, type Criterion, type Decision, type Paper, type Reviewer, type Vote } from "./data";
import { papersHref, screenHref, settingsHref } from "./links";
import { ANSWER_SIGN, ActionBar, AnswerMark, BELOW_HEADER, CriterionText, FilterMenu, Help, Kbd, LinkChip, Panel, QuestionName, RESULT_STYLE, ResultChip, ReviewerMark, ReviewerName, Section, StateChip, StickyColumn, TONE, TabCount, Tally, VoteMark, Named, RESULT_ICON, Reason, kindIcon, type Tone } from "./parts";
import { useMock, type Open } from "./store";
import { useWorkspace } from "./workspace";

type Queue = "todo" | "done" | "conflicts";
const QUEUE_PAGE = 12;
const QUEUE_LABEL: Record<Queue, string> = { todo: "To do", done: "Done", conflicts: "Conflicts" };
/** Each queue's count in the colour of what it holds: what waits for you is primary, a conflict is blue, what is done is neither. The tabs carry no icons, which would not fit the three on one line of the queue's column. */
const QUEUE_TONE: Record<Queue, Tone> = { todo: "primary", done: "neutral", conflicts: "info" };
const KEYS: Record<Decision, string> = { include: "I", maybe: "M", exclude: "E" };
const SHORTCUTS: Array<[string[], string, "vote"?]> = [[["I"], "Include", "vote"], [["M"], "Maybe", "vote"], [["E"], "Exclude, then the reason's key", "vote"], [["S"], "Skip to the next paper"], [["J", "→"], "Next paper"], [["K", "←"], "Previous paper"], [["Z"], "Undo the last vote", "vote"], [["?"], "Show these shortcuts"]];
const OTHER = "other";
/** The bar's height on a wide screen, and the room the columns that stick keep clear above it. */
const BAR_HEIGHT = "lg:h-[6.25rem]";
const CLEAR = "7.25rem";
/** From xl the page has three columns, the same for the bar under them: the queue, the paper, your answers. */
const WIDE = "xl:grid-cols-[19rem_minmax(0,1fr)_24rem] 2xl:grid-cols-[22rem_minmax(0,56rem)_minmax(28rem,1fr)]";
/** Between lg and xl three columns leave the paper no room. There are two: the paper, with your answers beside it. The queue's tabs sit over the paper, and its list opens from the window's side. */
const COLUMNS = `lg:max-xl:grid-cols-[minmax(0,1fr)_22rem] lg:max-xl:grid-rows-[auto_1fr] ${WIDE}`;
/** The bar under them: between lg and xl, where you are and the vote. */
const BAR_COLUMNS = `lg:grid-cols-[19rem_minmax(0,1fr)] ${WIDE}`;
/** A filter over the queue's list: a pill as wide as the queue's column. */
const QUEUE_FILTER = "h-8 w-full rounded-full px-3.5 text-xs";
/** Your answers, each with its own sign. Unclear is a dash: a "?" is help. */
const RULE_LABEL = { all: "All agree", most: "Most agree", one: "One vote" } as const;
const inQuotes = (text: string) => `"${text}"`;
const rank = (reviewer: Reviewer, me: string) => (reviewer.id === me ? 0 : reviewer.kind === "person" ? 1 : 2);

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
  // The queue as it was when it was opened: a paper you vote on stays in its place, with your vote on it, until you change queues.
  // After a reload it is built again once the saved votes are read back, so a reload shows the same queue as Back.
  const { ready } = useMock();
  const holding = `${ready}:${id}:${queue}:${order}:${open.me}:${find.trim().toLowerCase()}:${voted}`;
  // The paper the address names is in the list it was opened in, even once your vote has taken it out of To do: after Back or a reload the page shows the paper its address says.
  const opened = (ids: string[]) => (picked && !ids.includes(picked) && (queue === "todo" ? yours : papers).some((one) => one.id === picked) ? [picked, ...ids] : ids);
  const [held, setHeld] = useState<{ of: string; ids: string[] }>(() => ({ of: holding, ids: opened(listed(queue)) }));
  if (held.of !== holding) setHeld({ of: holding, ids: opened(listed(queue)) });
  else {
    // Papers that join while the queue is open, from a check for new papers, a conflict that just arose or a vote cast, are added at its end.
    const joined = listed(queue).filter((one) => !held.ids.includes(one));
    if (joined.length) setHeld({ of: holding, ids: [...held.ids, ...joined] });
  }
  const items = useMemo(() => held.ids.flatMap((one) => papers.find((paper) => paper.id === one) ?? []), [held, papers]);

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
  const go = (index: number) => {
    const next = items[Math.max(0, Math.min(items.length - 1, index))];
    if (!next) return;
    void setPlace({ paper: next.id, page: null }, { history: "replace" });
    setReasonFor(null);
    setWriting(null);
    setTranslated(false);
    setShown(null);
    // The button just pressed keeps neither the keyboard nor a pressed look on the next paper.
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest("[data-decision]")) document.activeElement.blur();
    // The paper is the page's main content: where the next one's title is out of sight, the page moves to it. The queue scrolls on its own, and brings the next paper's row into view the same way.
    requestAnimationFrame(() => {
      const top = article.current?.getBoundingClientRect().top;
      // Under what is held at the window's top, the page's bar and the screening's strip: the paper's scroll margin is that line and 1rem.
      const line = article.current ? parseFloat(getComputedStyle(article.current).scrollMarginTop) - parseFloat(getComputedStyle(document.documentElement).fontSize) : 0;
      if (top !== undefined && (top < line || top > window.innerHeight / 2)) article.current?.scrollIntoView({ block: "start" });
      // Its row, in the queue's own scroll: under the tabs and search held at the queue's top, and over its foot.
      const row = document.querySelector<HTMLElement>(`[data-queue-paper="${CSS.escape(next.id)}"]`);
      let side = row?.parentElement ?? null;
      while (side && getComputedStyle(side).overflowY !== "auto") side = side.parentElement;
      if (!row || !side?.firstElementChild) return;
      const [box, held, foot] = [row.getBoundingClientRect(), side.firstElementChild.getBoundingClientRect().bottom, side.getBoundingClientRect().bottom];
      if (box.top < held) side.scrollTop -= held - box.top;
      else if (box.bottom > foot) side.scrollTop += box.bottom - foot;
    });
  };

  const [advance, setAdvance] = useState(true);
  // On a phone the note field opens when asked for, so the paper keeps the room.
  const [noting, setNoting] = useState(false);
  // On a phone the queue opens over the paper.
  const [listing, setListing] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Record<string, Answer>>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Array<{ paper: Paper; decision: Decision; reason?: string; before: Vote | null; resolved: boolean; queue: Queue }>>([]);
  const last = history.findLast((one) => one.queue === queue) ?? null;
  const [shown, setShown] = useState<{ reviewer: string; criterion: string } | null>(null);
  const [translated, setTranslated] = useState(false);

  const resolving = queue === "conflicts";
  const mine = paper ? open.myVote(paper) : undefined;
  const visible = paper ? resolving || open.canSee(paper) : false;
  // Your own column first, then the other people, then the models, the same on every paper.
  const cast = paper ? [...votes[paper.id]!].sort((a, b) => rank(a.reviewer, open.me) - rank(b.reviewer, open.me)) : [];
  const mayDecide = resolving ? open.canResolve : open.isReviewer;
  const answering = !resolving && open.isReviewer;
  const resolver = screening.rule.resolver === open.me ? "you" : (personOf(screening.rule.resolver)?.name ?? "the person who settles them");

  // What a paper can be excluded for, each with its key: a must-have by its own number, the others by their first letter.
  const reasons = [
    ...criteria.flatMap((criterion, i) => (criterion.must && i < 9 ? [{ key: criterion.key, label: <Reason reason={criterion.key} criteria={criteria} /> as ReactNode, hotkey: String(i + 1) }] : [])),
    ...OTHER_REASONS.map((reason) => ({ ...reason, label: reason.key === OTHER ? "Another reason…" : reason.label, hotkey: reason.key[0]!.toUpperCase() })),
  ];

  const decideOn = (decision: Decision, reason?: string) => {
    if (!paper || !mayDecide) return;
    const note = notes[paper.id]?.trim() || (resolving ? undefined : mine?.note);
    // A reason no criterion covers is written down: the note field asks for it, and the vote is saved once there is one.
    if (decision === "exclude" && reason === OTHER && !notes[paper.id]?.trim()) {
      setReasonFor(null);
      return setWriting(paper.id);
    }
    setHistory((all) => [...all, { paper, decision, reason, before: resolving ? null : (mine ?? null), resolved: resolving, queue }]);
    if (resolving) open.resolve(paper, decision, note, reason);
    // The answers given before stay: a new vote adds to them, and a criterion named as the reason becomes a no.
    else open.vote(paper, { decision, answers: { ...mine?.answers, ...answers[paper.id], ...(reason && criteria.some((c) => c.key === reason) ? { [reason]: "no" as const } : {}) }, reason, note, at: Date.now() });
    setReasonFor(null);
    setWriting(null);
    if (advance && queue !== "done") {
      const next = items.findIndex((one, index) => index > at && (resolving ? settled[one.id]!.result === "conflict" : !open.myVote(one)));
      if (next >= 0) go(next);
    }
  };
  const answerIt = (criterion: string, answer: Answer) => {
    if (!paper) return;
    // A second press on the chosen answer takes it back. What is shown is what was set here and, under it, what the vote holds, so both are counted.
    const given = { ...(resolving ? undefined : mine?.answers), ...answers[paper.id] };
    if (given[criterion] === answer) delete given[criterion];
    else given[criterion] = answer;
    setAnswers((all) => ({ ...all, [paper.id]: given }));
    // On a paper you have voted on, the answer joins the vote at once.
    if (mine && !resolving) open.vote(paper, { ...mine, answers: given });
  };
  const press = (decision: Decision) => {
    if (!paper || !mayDecide) return;
    // Excluding asks which criterion failed, unless your own answers already say.
    const failed = decision === "exclude" && !resolving ? decide({ ...Object.fromEntries(criteria.map((c) => [c.key, "yes" as Answer])), ...answers[paper.id] }, criteria).reason : undefined;
    if (decision === "exclude" && !failed) setReasonFor(paper.id);
    else decideOn(decision, failed);
  };
  const undo = () => {
    if (!last) return;
    if (last.resolved) open.resolve(last.paper, null);
    else open.vote(last.paper, last.before);
    go(items.findIndex((one) => one.id === last.paper.id));
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
      if (key === "i") press("include");
      else if (key === "m") press("maybe");
      else if (key === "e") press("exclude");
      else if (key === "z") undo();
      else if (key === "?") setKeysOpen(true);
      else if (key === "arrowright" || key === "j" || key === "s") go(at + 1);
      else if (key === "arrowleft" || key === "k") go(at - 1);
      else return;
      event.preventDefault();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers close over this render's state, and the listener is renewed with it
    [at, items, history, answers, notes, advance, votes, settled, queue, mayDecide],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const given = paper && !resolving ? { ...mine?.answers, ...answers[paper.id] } : {};
  const pointsTo = Object.keys(given).length ? decide(given, criteria) : null;
  const failing = pointsTo?.reason ? criteria.find((criterion) => criterion.key === pointsTo.reason) : criteria.find((criterion) => criterion.must && given[criterion.key] === "unclear");
  const against = mine && pointsTo && pointsTo.decision !== mine.decision && (pointsTo.decision === "exclude" || mine.decision === "exclude");
  const quoting = paper && shown && visible ? cast.find((one) => one.reviewer.id === shown.reviewer) : undefined;
  const quotedCriterion = quoting ? criteria.find((c) => c.key === shown!.criterion) : undefined;
  const quotedSentence = quotedCriterion ? criteria.indexOf(quotedCriterion) : -1;
  const source = paper ? screening.sources.find((one) => one.id === paper.source) : undefined;
  const fromSource = source ? papers.filter((one) => one.source === source.id).length : 0;
  // What your last vote did: put the paper in conflict, or went against what others voted.
  const madeConflict = last && !last.resolved && settled[last.paper.id]?.result === "conflict";
  const differ = last && !last.resolved && open.canSee(last.paper) ? votes[last.paper.id]!.filter((one) => one.reviewer.id !== open.me && one.vote && one.vote.decision !== last.decision).length : 0;
  // Everything in this queue is voted on: say so, where the buttons are.
  const through = queue !== "done" && items.length > 0 && items.every((one) => (resolving ? settled[one.id]!.result !== "conflict" : Boolean(open.myVote(one))));
  const state = paper ? settled[paper.id]! : undefined;
  const waitsOn = paper && state?.result === "waiting" ? cast.filter((one) => !one.vote && !one.failed).map((one) => one.reviewer.name) : [];
  // What the counter says: how many are left to do, or where you are among the ones done.
  const left = resolving ? conflicts.length : toDo.length;
  const narrowed = Boolean(find.trim()) || (queue === "done" && voted !== "any");
  const openPaper = (one: Paper) => go(items.indexOf(one));

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
    return (
      <li key={one.id}>
        <button type="button" data-queue-paper={one.id} aria-current={one === paper || undefined} onClick={() => pick(one)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-start transition-colors", one === paper ? "bg-primary/8" : "hover:bg-muted")}>
          <span className="min-w-0 flex-1">
            <span className={cn("line-clamp-2 text-sm leading-5", one === paper ? "font-semibold" : "font-medium")}>{one.title}</span>
            <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">{one.authors[0]}, {one.year}</span>
              {one.batch !== undefined && queue === "todo" ? <StateChip tone="primary" className="h-5 px-1.5 text-2xs">New</StateChip> : null}
              {queue === "done" && vote ? <span className="ms-auto shrink-0">{ago(vote.at)}</span> : null}
            </span>
          </span>
          {resolving ? (
            result.result === "conflict" ? <Tally votes={votes[one.id]!.flatMap((one) => one.vote ?? [])} className="mt-0.5 shrink-0 gap-1.5" /> : <VoteMark vote={{ decision: result.final! }} who="Result" />
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

  // What narrows the queue and puts it in order: over its list in its own column, and in the drawer that holds the list under xl.
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
            ...(toDo.some((one) => one.batch !== undefined) ? [{ value: "fresh" as typeof order, label: "New papers first", icon: <RefreshCw /> }] : []),
            { value: "lean" as typeof order, label: "Models' includes first", icon: <ModelsIcon /> },
          ]}
        />
      ) : null}
    </>
  );
  // A queue with nothing in it, not because of a search: the whole width says so, under the queue's tabs.
  if (!paper && !narrowed) {
    return (
      <div>
        {open.isReviewer ? <div className="border-b border-border-subtle p-3"><div className="lg:max-w-[18rem] 2xl:max-w-[21rem]">{tabs}</div></div> : null}
        <Empty open={open} queue={queue} />
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
        className={cn("flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors", on ? "border-transparent" : look, on && look, !on && !mine && pointsTo?.decision === decision && "border-dashed border-current")}
      >
        <Icon className="size-4" />
        {DECISION_LABEL[decision]}
        <Kbd className={cn("max-lg:hidden", decision === "include" && "font-mono", on && "border-current/30 bg-transparent text-current")}>{KEYS[decision]}</Kbd>
      </button>
    );
  };

  return (
    <>
      <div className={cn("grid grid-cols-1 max-lg:pb-44 lg:divide-x lg:divide-border-subtle", COLUMNS)}>
        {/* The queue: from xl a sidebar that scrolls on its own, with its tabs and search held at its top. */}
        {/* With no paper to show, the tabs have the whole width between lg and xl: there are no answers to sit beside. */}
        <div className={cn("border-b border-border-subtle lg:max-xl:col-start-1 lg:max-xl:row-start-1 xl:border-b-0", !paper && "lg:max-xl:col-span-2 lg:max-xl:border-e-0")}>
          <StickyColumn from="xl" clear={CLEAR}>
          <div className="space-y-2 bg-card p-3 lg:max-xl:flex lg:max-xl:items-center lg:max-xl:justify-between lg:max-xl:gap-3 lg:max-xl:space-y-0 lg:max-xl:px-8 xl:sticky xl:top-0 xl:z-10">
            <div className="lg:max-xl:w-[18rem]">{tabs}</div>
            {/* Below xl the queue's list has no column of its own. It opens over the page, with its search and filters: from the foot on a phone, from the side on a wider screen. While a search or a filter narrows the queue the button stays, so the search can be changed. */}
            {items.length > 1 || narrowed ? <Button variant="outline" size="sm" className="w-full lg:max-xl:w-auto xl:hidden" onClick={() => setListing(true)}><ListChecks />See the queue</Button> : null}
            <Sheet open={listing} onOpenChange={setListing}>
              <SheetContent side={tablet ? "bottom" : "left"} className={cn("flex flex-col gap-0 p-0 xl:hidden", tablet && "max-h-[85dvh]")}>
                <SheetHeader className="space-y-3 border-b border-border-subtle p-4">
                  <SheetTitle>{QUEUE_LABEL[queue]}</SheetTitle>
                  <SheetDescription className="sr-only">Every paper in this queue. Press one to open it.</SheetDescription>
                  {findField("")}
                  {queueFilters(QUEUE_FILTER)}
                </SheetHeader>
                <ul className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto">
                  {items.slice((shownPage - 1) * QUEUE_PAGE, shownPage * QUEUE_PAGE).map((one) => row(one, (picked) => { openPaper(picked); setListing(false); }))}
                  {!items.length ? <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing in this queue matches</li> : null}
                </ul>
                {pager("border-t border-border-subtle px-3 py-2")}
              </SheetContent>
            </Sheet>
            {findField("max-xl:hidden")}
            {queueFilters(cn(QUEUE_FILTER, "max-xl:hidden"))}
          </div>
          <ul className="hidden divide-y divide-border-subtle border-t border-border-subtle xl:block">
            {items.slice((shownPage - 1) * QUEUE_PAGE, shownPage * QUEUE_PAGE).map((one) => row(one, openPaper))}
          </ul>
          {pager("hidden border-t border-border-subtle px-3 py-2 xl:flex")}
          </StickyColumn>
        </div>

        {!paper ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center lg:col-span-2">
            <p className="text-sm font-medium">Nothing in this queue matches</p>
            <Button size="sm" variant="outline" onClick={() => void setPlace({ paper: null, q: null, voted: null, page: null }, { history: "replace" })}>Show the whole queue</Button>
          </div>
        ) : (
          <>
            {/* The paper, and everyone's votes under it: the page's main content, as long as it is. */}
            <div ref={article} className={cn("min-w-0 lg:max-xl:col-start-1 lg:max-xl:row-start-2", BELOW_HEADER)}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={paper.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: EASE }} className="max-w-[46rem] space-y-8 p-5 sm:p-8 2xl:max-w-none">
                    <article className="space-y-4">
                      <h2 className="text-xl font-semibold leading-snug tracking-tight text-balance">{paper.title}</h2>
                      <p className="text-sm text-muted-foreground">{paper.authors.join(", ")}. <span className="italic">{paper.venue}</span>, {paper.year}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {source ? <LinkChip href={papersHref(id, { source: source.id })} icon={kindIcon(source.kind)} aria-label={`See the ${fromSource} papers from ${source.name}`} className="max-w-80 [&>span]:shrink">{source.name}</LinkChip> : null}
                        {paper.batch !== undefined ? <LinkChip href={papersHref(id, { added: String(paper.batch) })} tone="primary" icon={RefreshCw}>New, added {ago(paper.batch)}</LinkChip> : null}
                        <Chip icon={Quote}>Cited by {paper.cited.toLocaleString("en-GB")}</Chip>
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
                            {paper.sentences.map((sentence, i) => <Sentence key={i} text={sentence} quoted={quotedSentence === i} terms={criteria.flatMap((c) => c.terms)} />)}
                          </p>
                          {paper.original ? <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setTranslated(false)}><TranslateIcon />Translated from {paper.original.language}. Show the original</Button> : null}
                        </div>
                      )}
                    </article>

                    <Section
                      title="Everyone's votes"
                      help={
                        <Help title="Reading the votes" facts={<><HelpFact icon={Lock}>Hidden until you vote</HelpFact><HelpFact icon={Hourglass}>No vote yet</HelpFact><HelpFact icon={TriangleAlert}>Couldn&apos;t read it</HelpFact><HelpFact><StateChip tone="info" className="-ms-1 h-4 px-1 text-2xs">Differ</StateChip>Reviewers answered it differently</HelpFact><HelpFact><span className="-ms-1 flex scale-75"><AnswerMark answer="yes" label="A model's answer" pressable /></span>Opens the passage a model read</HelpFact></>}>
                          Each column is a reviewer and each row a criterion, with their vote in the last row. Press a face for that reviewer&apos;s vote and note, and a model&apos;s answer for the passage it read. A model that couldn&apos;t read a paper has no say in it.
                        </Help>
                      }
                      aside={
                        !visible ? (
                          <Chip icon={Lock}>Shown after you vote</Chip>
                        ) : state ? (
                          <>
                            <ResultChip result={state.result} />
                            {state.result === "conflict" ? <><Tally votes={cast.flatMap((one) => one.vote ?? [])} /><span className="text-xs text-muted-foreground">Goes to {resolver}</span></> : null}
                            {state.result === "waiting" && waitsOn.length ? <span className="text-xs text-muted-foreground">from {waitsOn.slice(0, 2).join(" and ")}{waitsOn.length > 2 ? ` and ${waitsOn.length - 2} more` : ""}</span> : null}
                            {state.resolvedBy ? <span className="min-w-0 truncate text-xs text-muted-foreground">Settled by {state.resolvedBy === open.me ? "you" : (personOf(state.resolvedBy)?.name ?? "a reviewer")}</span> : null}
                            {!state.resolvedBy && state.result === "exclude" && cast.some((one) => one.vote?.reason) ? <ReasonChip reason={cast.find((one) => one.vote?.reason)!.vote!.reason!} criteria={criteria} /> : null}
                          </>
                        ) : null
                      }
                    >
                      {state?.resolvedBy && state.note ? <p className="text-sm text-muted-foreground">{inQuotes(state.note)}</p> : null}
                      <div className="overflow-x-auto rounded-2xl border border-border-subtle p-3">
                        <Matrix
                          criteria={criteria}
                          cast={cast}
                          me={open.me}
                          hidden={!visible}
                          shown={shown}
                          onShow={setShown}
                          passage={quoting && quotedCriterion ? <Evidence paper={paper} reviewer={quoting.reviewer} criterion={quotedCriterion} criteria={criteria} answer={quoting.vote?.answers[quotedCriterion.key]} /> : null}
                        />
                      </div>
                    </Section>
                  </motion.div>
                </AnimatePresence>
            </div>

            {/* Your answers to the criteria. */}
            <div className="min-w-0 border-t border-border-subtle lg:border-t-0 lg:max-xl:col-start-2 lg:max-xl:row-span-2 lg:max-xl:row-start-1">
              <StickyColumn from="lg" clear={CLEAR} anchor={paper.id} className="p-5">
                <Section
                  title={answering ? "Your answers" : "Criteria"}
                  help={
                    <Help title={answering ? "Your answers" : "Criteria"} side={tablet ? undefined : "left"} facts={<><HelpFact icon={Asterisk}>Must-have</HelpFact><HelpFact><mark className="-ms-0.5 rounded-sm bg-primary/15 px-1 text-foreground">Highlighted</mark>Words from the criteria</HelpFact></>}>
                      {answering ? "Answering is optional: one vote is enough. A paper that fails a must-have is excluded, and Exclude asks which one it failed unless your answers already say." : "The questions each reviewer answers for a paper. A paper that fails a must-have is excluded."}
                    </Help>
                  }
                >
                  {criteria.length ? (
                    <ol key={paper.id} className={LIST}>
                      {criteria.map((criterion, i) => {
                        const answered = answers[paper.id]?.[criterion.key] ?? (resolving ? undefined : mine?.answers[criterion.key]);
                        return (
                          <li key={criterion.key} className="space-y-2.5 px-3 py-3">
                            <p className="flex gap-2.5 text-sm leading-5">
                              <span className="w-4 shrink-0 tabular-nums text-muted-foreground">{i + 1}</span>
                              <span className="min-w-0"><CriterionText text={criterion.text} must={criterion.must} /></span>
                            </p>
                            {answering ? (
                              <div role="radiogroup" aria-label={`Your answer to criterion ${i + 1}`} className="flex flex-wrap gap-1.5 ps-6.5">
                                {ANSWERS.map((answer) => {
                                  const { icon: Icon, label, tone } = ANSWER_SIGN[answer];
                                  const on = answered === answer;
                                  return (
                                    <button key={answer} type="button" role="radio" aria-checked={on} onClick={() => answerIt(criterion.key, answer)} className={cn("flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors", on ? cn("border-transparent ring-1 ring-current/40", TONE[tone].chip) : "border-border-subtle text-muted-foreground hover:bg-muted hover:text-foreground")}>
                                      <Icon className={cn("size-3.5", !on && TONE[tone].ink)} />
                                      {label}
                                    </button>
                                  );
                                })}
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
                  {/* What your answers say before, or against, your vote. */}
                  {against && mine ? (
                    <Panel tone="warning" className="px-3 py-2.5 text-xs ink-warning">You voted {DECISION_LABEL[mine.decision]}, and your answers point to {DECISION_LABEL[pointsTo!.decision]}{failing ? `: you answered ${given[failing.key] === "no" ? "No" : "Unclear"} to criterion ${criteria.indexOf(failing) + 1}, a must-have` : ""}.</Panel>
                  ) : !mine && pointsTo && failing ? (
                    <Panel className="px-3 py-2.5 text-xs text-muted-foreground">Your answers point to <span className="font-medium text-foreground">{DECISION_LABEL[pointsTo.decision]}</span>: you answered {given[failing.key] === "no" ? "No" : "Unclear"} to criterion {criteria.indexOf(failing) + 1}, a must-have.</Panel>
                  ) : !mine && pointsTo?.decision === "include" && criteria.filter((criterion) => criterion.must).every((criterion) => given[criterion.key] === "yes") ? (
                    <Panel className="px-3 py-2.5 text-xs text-muted-foreground">Your answers point to <span className="font-medium text-foreground">Include</span>: every must-have is met.</Panel>
                  ) : null}
                </Section>
              </StickyColumn>
            </div>
          </>
        )}
      </div>

      {paper ? (
        /* The vote stays at the foot of the window. From xl it has three parts under the three columns: where you are in the queue, the vote, and the last vote with its way back. Under xl the last vote's way back sits with where you are. On a phone the bar is fixed to the foot, its last row clear of the assistant's button. */
        <ActionBar className="max-lg:fixed max-lg:inset-x-0 max-lg:z-30">
          <div className={cn("flex flex-col gap-2 px-3 pt-3 pb-[max(1.75rem,env(safe-area-inset-bottom))] lg:grid lg:items-stretch lg:gap-0 lg:p-0", BAR_HEIGHT, BAR_COLUMNS)}>
            {/* Where you are */}
            <div className="flex items-center gap-1 max-lg:order-last max-lg:h-10 max-lg:ps-9 max-lg:pe-[4.5rem] lg:flex-wrap lg:content-center lg:gap-y-2 lg:px-4">
              <span className="me-1 text-xs tabular-nums text-muted-foreground">{queue === "done" || !mayDecide ? `${at + 1} of ${items.length}` : `${left.toLocaleString("en-GB")} left`}</span>
              <TooltipHint label="Previous paper"><Button variant="ghost" size="icon" className="size-7" aria-label="Previous paper" disabled={at <= 0} onClick={() => go(at - 1)}><ChevronLeft /></Button></TooltipHint>
              <TooltipHint label="Next paper"><Button variant="ghost" size="icon" className="size-7" aria-label="Next paper" disabled={at >= items.length - 1} onClick={() => go(at + 1)}><ChevronRight /></Button></TooltipHint>
              <Popover open={keysOpen} onOpenChange={setKeysOpen}>
                <PopoverTrigger asChild><Button variant="ghost" size="sm" className="ms-1 h-7 gap-1.5 px-2 text-xs text-muted-foreground max-lg:hidden">Shortcuts<Kbd>?</Kbd></Button></PopoverTrigger>
                <PopoverContent align="start" side="top" className="w-80 space-y-2 p-3">
                  <p className="text-sm font-semibold">Shortcuts</p>
                  {SHORTCUTS.filter(([, , vote]) => mayDecide || !vote).map(([keys, what]) => (
                    <p key={what} className="flex items-center gap-3 text-sm">
                      <span className="flex w-20 shrink-0 items-center gap-1 text-xs text-muted-foreground">{keys.map((key, i) => <span key={key} className="flex items-center gap-1">{i ? "or" : null}<Kbd className={key === "I" ? "font-mono" : undefined}>{key}</Kbd></span>)}</span>
                      <span>{what}</span>
                    </p>
                  ))}
                </PopoverContent>
              </Popover>
              {/* Under xl the last vote has no part of the bar to itself: its way back sits here. */}
              {last ? <TooltipHint label="Undo the last vote"><Button variant="ghost" size="icon" className="size-8 xl:hidden" aria-label="Undo the last vote" onClick={undo}><Undo2 /></Button></TooltipHint> : null}
              {mayDecide && queue !== "done" ? (
                <label className="flex basis-full items-center justify-between gap-2 ps-1 text-xs text-muted-foreground max-lg:hidden">
                  Next paper after each vote
                  <Switch checked={advance} onCheckedChange={setAdvance} aria-label="Go to the next paper after a vote" />
                </label>
              ) : null}
              {/* On a phone the rest folds into one menu. */}
              {madeConflict && last ? <LinkChip href={screenHref(id, { queue: "conflicts", paper: last.paper.id })} tone="info" icon={GitCompare} className="xl:hidden">Now in Conflicts</LinkChip> : null}
              <Popover>
                <PopoverTrigger asChild><Button variant="ghost" size="icon" className="ms-auto size-8 text-muted-foreground lg:hidden" aria-label="More for this paper"><MoreHorizontal /></Button></PopoverTrigger>
                <PopoverContent align="end" side="top" className="w-72 space-y-3 p-3">
                  {mayDecide && queue !== "done" ? (
                    <label className="flex items-center gap-3 text-sm">
                      <span className="min-w-0 flex-1">Next paper after each vote</span>
                      <Switch checked={advance} onCheckedChange={setAdvance} aria-label="Go to the next paper after a vote" />
                    </label>
                  ) : null}
                  <label className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1">Write a note with your vote</span>
                    <Switch checked={noting} onCheckedChange={setNoting} aria-label="Write a note with your vote" />
                  </label>
                </PopoverContent>
              </Popover>
            </div>

            {/* The vote */}
            <div className="flex w-full min-w-0 flex-col justify-center gap-2 lg:max-w-[46rem] lg:px-8 2xl:max-w-none">
              {!mayDecide ? (
                <p className="flex items-center gap-2 rounded-xl bg-inset px-3 py-3 text-sm text-muted-foreground">
                  <Eye className="size-4 shrink-0" />
                  {resolving ? `${resolver === "you" ? "You settle" : `${resolver} settles`} conflicts on this screening. You can read them here.` : "You aren't one of this screening's reviewers."}
                </p>
              ) : writing === paper.id ? (
                <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); decideOn("exclude", OTHER); }}>
                  <Input autoFocus value={notes[paper.id] ?? ""} onChange={(event) => setNotes((all) => ({ ...all, [paper.id]: event.target.value }))} placeholder="Why exclude it? Such as: a conference abstract with no data" aria-label="Why exclude it" className="h-8 text-sm" />
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
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{resolving ? "Every conflict here is settled" : `You voted on all ${items.length} ${items.length === 1 ? "paper" : "papers"}`}</p>
                      {!resolving && conflicts.length ? <Button asChild size="sm" className="shrink-0" variant={open.canResolve ? "default" : "outline"}><NextLink href={screenHref(id, { queue: "conflicts" })}><GitCompare />{open.canResolve ? "Settle" : "See"} {conflicts.length} {conflicts.length === 1 ? "conflict" : "conflicts"}</NextLink></Button> : null}
                      {resolving && toDo.length ? <Button asChild size="sm" className="shrink-0"><NextLink href={screenHref(id)}><ListChecks />Screen {toDo.length} {toDo.length === 1 ? "paper" : "papers"}</NextLink></Button> : null}
                    </div>
                  ) : (
                    <div className={cn("flex items-center gap-3", !noting && !resolving && "max-lg:hidden")}>
                      {resolving ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
                          Settle this conflict
                          <Help title="Settling a conflict" side="top" facts={<>{mine ? <HelpFact icon={RESULT_ICON[mine.decision]}><Named name="Your own vote">{DECISION_LABEL[mine.decision]}</Named></HelpFact> : null}<HelpFact><Named name="Rule">{RULE_LABEL[screening.rule.settle]}</Named></HelpFact></>}>
                            The reviewers split on this paper. Your vote becomes its result, whatever they voted. Maybe keeps it open.
                          </Help>
                        </span>
                      ) : null}
                      <Input value={notes[paper.id] ?? (resolving ? "" : (mine?.note ?? ""))} onChange={(event) => setNotes((all) => ({ ...all, [paper.id]: event.target.value }))} placeholder={resolving ? "Why, for the record (optional)" : "A note for the others (optional)"} aria-label="Note" className={cn("h-8 min-w-0 flex-1 text-sm", !noting && "max-lg:hidden")} />
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
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
                            const reason = reasons.find((one) => one.hotkey.toLowerCase() === event.key.toLowerCase());
                            if (!reason || event.metaKey || event.ctrlKey || event.altKey) return;
                            event.preventDefault();
                            decideOn("exclude", reason.key);
                          }}
                        >
                          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Why exclude it?</DropdownMenuLabel>
                          {reasons.map((reason) => (
                            <DropdownMenuItem key={reason.key} onSelect={() => decideOn("exclude", reason.key)} className="min-h-9">
                              <span className="min-w-0 flex-1">{reason.label}</span>
                              <Kbd>{reason.hotkey}</Kbd>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* The last vote, the paper it was on, and its way back. */}
            <div className="flex min-w-0 flex-col justify-center gap-1 px-4 py-3 text-xs text-muted-foreground max-xl:hidden">
              {last ? (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">You {last.resolved ? "settled it as" : "voted"} <span className="font-medium text-foreground">{last.resolved ? RESULT_LABEL[last.decision] : DECISION_LABEL[last.decision]}</span></span>
                    <Button variant="ghost" size="xs" className="shrink-0" onClick={undo}><Undo2 />Undo<Kbd>Z</Kbd></Button>
                  </div>
                  {last.paper.id !== paper.id ? (
                    <TooltipHint label={last.paper.title} onlyWhenClipped>
                      <button type="button" onClick={() => openPaper(last.paper)} className="min-w-0 truncate text-start text-foreground hover:underline">{inQuotes(last.paper.title)}</button>
                    </TooltipHint>
                  ) : null}
                </>
              ) : null}
              {madeConflict && last ? (
                <LinkChip href={screenHref(id, { queue: "conflicts", paper: last.paper.id })} tone="info" icon={GitCompare} className="self-start">Now in Conflicts</LinkChip>
              ) : differ ? (
                <span>{differ} voted differently</span>
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
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {reasons.map((reason) => (
                <button key={reason.key} type="button" onClick={() => decideOn("exclude", reason.key)} className="flex min-h-11 w-full items-center rounded-xl border border-border-subtle px-3 py-2 text-start text-sm transition-colors hover:bg-muted">{reason.label}</button>
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

/** A sentence of the abstract, with the criteria's words marked, and the whole of it when a model quoted it. */
/** Why a paper was excluded, as a chip that shows the criterion's question when pointed at. */
function ReasonChip({ reason, criteria }: { reason: string; criteria: Criterion[] }) {
  return <QuestionName question={questionOf(reason, criteria)} label={failedLabel(reason, criteria)} className="inline-flex"><Chip><Reason reason={reason} criteria={criteria} /></Chip></QuestionName>;
}

function Sentence({ text, quoted, terms }: { text: string; quoted: boolean; terms: string[] }) {
  const words = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const parts = words.length ? text.split(new RegExp(`\\b(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi")) : [text];
  return (
    <span className={cn("rounded box-decoration-clone transition-colors duration-300", quoted && "bg-warning/20")}>
      {parts.map((part, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-primary/15 text-foreground">{part}</mark> : part))}{" "}
    </span>
  );
}

/** A reviewer's face at the head of their column: it opens their vote, its reason and their note. */
function Face({ reviewer, vote, failed, you, kept, criteria }: { reviewer: Reviewer; vote: Vote | undefined; failed?: boolean; you: boolean; kept: boolean; criteria: Criterion[] }) {
  const style = vote ? RESULT_STYLE[vote.decision] : null;
  return (
    <Popover>
      <TooltipHint label={you ? `${reviewer.name}, you` : reviewer.name}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`${reviewer.name}${you ? ", you" : ""}: their vote`} className="mx-auto flex rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
            <ReviewerMark reviewer={reviewer} you={you} />
          </button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent align="center" className="w-72 space-y-2.5 p-3">
        <div className="flex items-center gap-2.5">
          <ReviewerMark reviewer={reviewer} className="size-8" />
          <ReviewerName reviewer={reviewer} you={you} className="text-sm font-medium" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {failed ? (
            <StateChip tone="destructive" icon={TriangleAlert}>Couldn&apos;t read this paper</StateChip>
          ) : kept && vote ? (
            <Chip icon={Lock}>Voted, shown after you vote</Chip>
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
  return (
    // The marks sit right after the longest criterion, so a row reads across. Where that is wider than the room there is, on a phone or in a narrow sidebar, the criteria take what is left and cut off, so every column fits before anything scrolls sideways.
    // The rows are set apart by their cells' own margins, not by a gap. A grid keeps a gap around a row for as long as the row is there, even at no height, so the passage that opens under a row would take 6px with it in the last frame of closing.
    <div className="-my-[3px] grid grid-cols-[minmax(5.5rem,1fr)_var(--marks)] items-center gap-x-1 *:my-[3px] sm:w-fit sm:grid-cols-[minmax(7rem,max-content)_var(--marks)] [&>.contents>*]:my-[3px]" style={{ "--marks": `repeat(${cast.length}, 1.75rem)` } as React.CSSProperties}>
      <span />
      {cast.map(({ reviewer, vote, failed }) => <Face key={reviewer.id} reviewer={reviewer} vote={vote} failed={failed} you={reviewer.id === me} kept={kept(reviewer)} criteria={criteria} />)}
      {criteria.map((criterion, n) => {
        const given = cast.map((one) => (kept(one.reviewer) ? undefined : one.vote?.answers[criterion.key]));
        const split = new Set(given.filter(Boolean)).size > 1;
        return (
          <div key={criterion.key} className="contents">
            <span className="flex min-w-0 items-center gap-1.5 pe-2 text-xs">
              <span className="w-3 shrink-0 tabular-nums text-muted-foreground">{n + 1}</span>
              <QuestionName question={questionOf(criterion.key, criteria)} label={criterion.short} className={cn("min-w-0 truncate", split ? "font-medium text-foreground" : "text-muted-foreground")}><CriterionText text={criterion.short} must={criterion.must} /></QuestionName>
              {split ? <StateChip tone="info" className="h-5 px-1.5 text-2xs">Differ</StateChip> : null}
            </span>
            {cast.map(({ reviewer, vote }, i) => {
              if (kept(reviewer) && vote) {
                return <span key={reviewer.id} role="img" aria-label={`${reviewer.name}, ${criterion.short}: hidden until you vote`} className="mx-auto flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground"><Lock aria-hidden className="size-3" /></span>;
              }
              const answer = given[i];
              if (!answer) return <span key={reviewer.id} className="mx-auto size-6 rounded-md border border-dashed border-border" />;
              const on = shown?.reviewer === reviewer.id && shown.criterion === criterion.key;
              return reviewer.kind === "model" ? (
                <button key={reviewer.id} type="button" aria-pressed={on} aria-label={`${reviewer.name}, ${criterion.short}: show the passage`} onClick={() => onShow(on ? null : { reviewer: reviewer.id, criterion: criterion.key })} className={cn("mx-auto flex cursor-pointer rounded-md transition-shadow hover:ring-2 hover:ring-border", on && "ring-2 ring-primary/60")}>
                  <AnswerMark answer={answer} label={`${reviewer.name}, ${criterion.short}`} pressable={!on} />
                </button>
              ) : (
                <span key={reviewer.id} className="mx-auto flex"><AnswerMark answer={answer} label={`${reviewer.name}, ${criterion.short}`} /></span>
              );
            })}
            {/* The passage opens under its own row. It takes the grid's width and never widens it. It has no margin of its own, so closed it takes no room at all. */}
            <AnimatePresence initial={false}>
              {passage && shown?.criterion === criterion.key ? (
                <motion.div key="passage" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="col-span-full my-0! overflow-hidden [contain:inline-size]">
                  <div className="py-[7px]">{passage}</div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
      <span className="border-t border-border-subtle pt-2 text-xs font-medium">Vote</span>
      {cast.map(({ reviewer, vote, failed }) => (
        <span key={reviewer.id} className="flex justify-center border-t border-border-subtle pt-2"><VoteMark vote={vote} hidden={kept(reviewer)} failed={failed} who={reviewer.name} /></span>
      ))}
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
      <div className="flex items-center gap-2 text-xs">
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
