"use client";

// The open screening's Screen page: your queue, the paper, and the criteria with everyone's votes.
// One paper at a time, decided with a key. Splits are settled in the same place. The page is as long
// as the paper and its queue are, and the decision stays at the foot of the window.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import NextLink from "next/link";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { Check, ChevronLeft, ChevronRight, CircleHelp, Eye, GitCompare, ListChecks, MoreHorizontal, Quote, RefreshCw, Search, TranslateIcon, Undo2 } from "@/components/icons";
import { ANSWER, AnswerMark, Chip, ClippedChip, Meter, RequiredMark, SOURCE_ICON } from "@/components/screening/parts";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { PageStepper } from "@/components/shared/page-stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { YouTag } from "@/components/ui/identity";
import { TooltipHint } from "@/components/ui/tooltip";
import { ANSWERS, type Answer } from "@/lib/screening/setup";
import { cn } from "@/lib/utils";
import { DECISIONS, DECISION_LABEL, NOW, OTHER_REASONS, ago, day, confidenceOf, decide, evidence, failedLabel, personOf, type Criterion, type Decision, type Paper, type Reviewer, type Vote } from "./data";
import { overviewHref, papersHref } from "./links";
import { ActionBar, CriterionText, Kbd, RESULT_STYLE, ResultChip, ReviewerMark, VoteMark } from "./parts";
import type { Open } from "./store";
import { useWorkspace } from "./workspace";

type Queue = "todo" | "done" | "conflicts";
const QUEUE_PAGE = 9;
const KEYS: Record<Decision, string> = { include: "I", maybe: "M", exclude: "E" };
const SHORTCUTS: Array<[string, string]> = [["I", "Include"], ["M", "Maybe"], ["E", "Exclude, then a number for the reason"], ["S", "Leave it for later"], ["Z", "Undo, one decision at a time"], ["← →", "Previous and next paper"], ["Esc", "Back from the reason"]];
const OTHER = "other";
const HELP: Array<[string, string]> = [["Asterisk", "A must-have criterion: a paper that fails it is excluded"], ["Marked words", "Words from your criteria, found in the text"], ["Faces and model marks", "The reviewers of this paper, each with their answer. Press them to see who is who"], ["A lock", "A vote that is cast, and hidden until you have cast yours"], ["A dashed square", "No vote yet"], ["Your answers", "Optional. One decision is enough, and Exclude asks for the reason"]];
const kindIcon = (kind: string) => SOURCE_ICON[kind === "search" || kind === "collection" || kind === "saved" || kind === "screening" || kind === "evidenceLibrary" || kind === "zotero" ? kind : "collection"];

/**
 * Where someone is, kept in the address: the queue, the paper open in it, what they searched for, which
 * of their own votes they asked for, and the order of what is still to do (as added, the newest
 * arrivals first, or the ones the models would include first).
 */
const PLACE = {
  queue: parseAsStringLiteral(["todo", "done", "conflicts"] as const).withDefault("todo"),
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
  const { screening, papers, votes, settled, yours, toDo, conflicts } = open;
  const criteria = screening.criteria;
  // Another queue, order or choice of votes is a step Back returns from. Going from paper to paper and typing in the search box change the address in place, so Back leaves the queue in one step.
  const [{ queue, paper: picked, q: find, voted, order }, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  // The page of the queue's list. 0 stands for "the page the open paper is on": a paper opened from elsewhere brings its page with it.
  const [page, setPage] = useState(0);
  const setFind = (next: string) => { setPage(1); void setPlace({ q: next, paper: null }, { history: "replace" }); };
  const setPicked = (next: string | null) => void setPlace({ paper: next }, { history: "replace" });
  /** Opens another queue from its start. */
  const onQueue = (next: Queue) => { setPage(1); void setPlace({ queue: next, paper: null, q: null, voted: null, order: null }); };
  const listed = useCallback(
    (which: Queue) => {
      const done = yours.filter((paper) => open.myVote(paper)).sort((a, b) => open.myVote(b)!.at - open.myVote(a)!.at);
      // Found by its title, its authors or what its abstract says. Among the ones you have decided, also by what you decided.
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
  // The queue as it was when it was opened: a paper you decide stays in its place, with your vote on it, until you change lists.
  const holding = `${screening.id}:${queue}:${order}:${open.me}:${find.trim().toLowerCase()}:${voted}`;
  const [held, setHeld] = useState<{ of: string; ids: string[] }>(() => ({ of: holding, ids: listed(queue) }));
  if (held.of !== holding) setHeld({ of: holding, ids: listed(queue) });
  else if (queue !== "done") {
    // Papers that join while the list is open, from a look for new papers or a conflict that just arose, are added at its end.
    const joined = listed(queue).filter((id) => !held.ids.includes(id));
    if (joined.length) setHeld({ of: holding, ids: [...held.ids, ...joined] });
  }
  const items = useMemo(() => held.ids.flatMap((id) => papers.find((paper) => paper.id === id) ?? []), [held, papers]);

  const paper = items.find((one) => one.id === picked) ?? items[0];
  const at = paper ? items.indexOf(paper) : -1;
  const pages = Math.max(1, Math.ceil(items.length / QUEUE_PAGE));
  const shownPage = Math.min(pages, page || (at >= 0 ? Math.floor(at / QUEUE_PAGE) + 1 : 1));
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  // "Another reason" is written before it is saved: the paper whose reason is being written.
  const [writing, setWriting] = useState<string | null>(null);
  const article = useRef<HTMLDivElement>(null);
  const go = (index: number) => {
    const next = items[Math.max(0, Math.min(items.length - 1, index))];
    if (!next) return;
    setPicked(next.id);
    setPage(Math.floor(items.indexOf(next) / QUEUE_PAGE) + 1);
    setReasonFor(null);
    setWriting(null);
    setTranslated(false);
    // The button just pressed keeps neither the keyboard nor a pressed look on the next paper.
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest("[data-decision]")) document.activeElement.blur();
    // The page is the scroller: where the next paper's title is out of sight, above or below, the page moves to it.
    requestAnimationFrame(() => {
      const top = article.current?.getBoundingClientRect().top;
      if (top !== undefined && (top < 0 || top > window.innerHeight / 2)) article.current?.scrollIntoView({ block: "start" });
    });
  };

  const [advance, setAdvance] = useState(true);
  // On a phone the note field opens when asked for, so the paper keeps the room.
  const [noting, setNoting] = useState(false);
  // On a phone the queue's list opens over the paper.
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
  const cast = paper ? votes[paper.id]! : [];
  const mayDecide = resolving ? open.canResolve : open.isReviewer;

  const decideOn = (decision: Decision, reason?: string) => {
    if (!paper || !mayDecide) return;
    const note = notes[paper.id]?.trim() || (resolving ? undefined : mine?.note);
    // A reason no criterion covers is written down: it opens the note, and saves once there is one.
    if (decision === "exclude" && reason === OTHER && !notes[paper.id]?.trim()) return setWriting(paper.id);
    setHistory((all) => [...all, { paper, decision, reason, before: resolving ? null : (mine ?? null), resolved: resolving, queue }]);
    if (resolving) open.resolve(paper, decision, note, reason);
    // The answers given before stay: a new decision adds to them, and a criterion named as the reason becomes a no.
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
    setAnswers((all) => ({ ...all, [paper.id]: { ...all[paper.id], [criterion]: answer } }));
    // On a paper you have voted on, the answer joins the vote at once.
    if (mine && !resolving) open.vote(paper, { ...mine, answers: { ...mine.answers, ...answers[paper.id], [criterion]: answer } });
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

  // The keyboard is the outside system: one listener for the keys the buttons show.
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=listbox]")) return;
      const key = event.key.toLowerCase();
      // Inside a group of choices the arrow keys move between the choices, as they do everywhere.
      if (key.startsWith("arrow") && target?.closest("[role=radiogroup]")) return;
      if (reasonFor) {
        const reason = reasons[Number(key) - 1];
        if (reason) decideOn("exclude", reason.key);
        else if (key === "escape") setReasonFor(null);
        else return;
      } else if (key === "i") press("include");
      else if (key === "m") press("maybe");
      else if (key === "e") press("exclude");
      else if (key === "z") undo();
      else if (key === "arrowright" || key === "j" || key === "s") go(at + 1);
      else if (key === "arrowleft" || key === "k") go(at - 1);
      else return;
      event.preventDefault();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers close over this render's state, and the listener is renewed with it
    [reasonFor, at, items, history, answers, notes, advance, votes, settled, queue, mayDecide],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const given = paper && !resolving ? { ...mine?.answers, ...answers[paper.id] } : {};
  const pointsTo = Object.keys(given).length ? decide(given, criteria) : null;
  const failing = pointsTo?.reason ? criteria.find((criterion) => criterion.key === pointsTo.reason) : criteria.find((criterion) => criterion.must && given[criterion.key] === "unclear");
  const against = mine && pointsTo && pointsTo.decision !== mine.decision && (pointsTo.decision === "exclude" || mine.decision === "exclude");
  const evidenceOf = paper && shown && visible ? { reviewer: cast.find((one) => one.reviewer.id === shown.reviewer)?.reviewer, criterion: criteria.find((c) => c.key === shown.criterion) } : null;
  const quoted = evidenceOf?.criterion && evidenceOf.reviewer ? criteria.indexOf(evidenceOf.criterion) : -1;
  const source = paper ? screening.sources.find((one) => one.id === paper.source) : undefined;
  const differ = last && !last.resolved && open.canSee(last.paper) ? votes[last.paper.id]!.filter((one) => one.reviewer.id !== open.me && one.vote && one.vote.decision !== last.decision).length : 0;
  // What a paper can be excluded for: the criteria first, then what no criterion covers.
  const reasons = [...criteria.filter((criterion) => criterion.must).map((criterion) => ({ key: criterion.key, label: `Not met: ${criterion.short.endsWith("…") ? criterion.text.replace(/\?$/, "") : criterion.short}` })), ...OTHER_REASONS];
  // Everything in this queue is decided: say so, where the buttons are.
  const through = queue !== "done" && items.length > 0 && items.every((one) => (resolving ? settled[one.id]!.result !== "conflict" : Boolean(open.myVote(one))));
  const state = paper ? settled[paper.id]! : undefined;
  const waitsOn = paper && state?.result === "waiting" ? cast.filter((one) => !one.vote && !one.failed).map((one) => one.reviewer.name) : [];
  // What the counter says: how many are left to do, or where you are among the ones done.
  const left = resolving ? conflicts.length : toDo.length;

  // One paper of the queue, in the column beside the paper and in the sheet a phone opens.
  const row = (one: Paper, pick: (paper: Paper) => void) => {
    const vote = open.myVote(one);
    return (
      <li key={one.id}>
        <button type="button" aria-current={one === paper} onClick={() => pick(one)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-muted", one === paper && "bg-muted")}>
          <span className="min-w-0 flex-1">
            <span className={cn("line-clamp-2 text-sm leading-5", one === paper ? "font-semibold" : "font-medium")}>{one.title}</span>
            {one.batch !== undefined && queue === "todo" ? <span className="mt-1 inline-flex rounded-full bg-success/12 px-1.5 text-2xs font-medium leading-5 ink-success">New, added {one.batch > NOW ? "just now" : day(one.batch)}</span> : null}
            <span className="mt-0.5 flex gap-2 text-xs text-muted-foreground"><span className="min-w-0 truncate">{one.authors[0]}, {one.year}</span>{queue === "done" && vote ? <span className="ms-auto shrink-0">{ago(vote.at)}</span> : null}</span>
          </span>
          {resolving ? (settled[one.id]!.result === "conflict" ? <GitCompare className="mt-0.5 size-4 shrink-0 text-info" /> : <VoteMark vote={{ decision: settled[one.id]!.final! }} who="Final decision" />) : vote ? <VoteMark vote={vote} who="You" /> : null}
        </button>
      </li>
    );
  };

  return (
    <>
    <div className="grid min-h-[34rem] grid-cols-1 max-lg:pb-40 lg:grid-cols-[19rem_minmax(0,1fr)_25rem] lg:divide-x lg:divide-border-subtle">
      {/* The queue */}
      <div className="border-b border-border-subtle lg:border-b-0">
        <div className="space-y-2 p-3">
          <Segmented
            label="Queue"
            value={queue}
            onChange={(next) => { setReasonFor(null); onQueue(next); }}
            fill="labels"
            options={[
              { id: "todo", label: "To do", detail: <span className="tabular-nums text-muted-foreground">{toDo.length}</span> },
              { id: "done", label: "Done", detail: <span className="tabular-nums text-muted-foreground">{yours.length - toDo.length}</span> },
              { id: "conflicts", label: "Conflicts", detail: <span className="tabular-nums text-muted-foreground">{conflicts.length}</span> },
            ]}
          />
          {/* A phone shows one paper at a time: the whole list, to find a paper in, opens over it. */}
          {items.length > 1 ? <Button variant="outline" size="sm" className="w-full lg:hidden" onClick={() => setListing(true)}><ListChecks />See all {items.length.toLocaleString("en-GB")} in this list</Button> : null}
          <Sheet open={listing} onOpenChange={setListing}>
            <SheetContent side="bottom" className="flex max-h-[85dvh] flex-col gap-0 p-0 lg:hidden">
              <SheetHeader className="space-y-3 border-b border-border-subtle p-4">
                <SheetTitle>{queue === "todo" ? "To do" : queue === "done" ? "Done" : "Conflicts"}</SheetTitle>
                <SheetDescription className="sr-only">Every paper in this list. Press one to open it.</SheetDescription>
                <div className="relative">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={find} onChange={(event) => setFind(event.target.value)} placeholder="Find in this list" aria-label="Find in this list" className="h-9 rounded-full ps-8 text-sm" />
                </div>
              </SheetHeader>
              <ul className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto">
                {items.slice((shownPage - 1) * QUEUE_PAGE, shownPage * QUEUE_PAGE).map((one) => row(one, (paper) => { go(items.indexOf(paper)); setListing(false); }))}
                {!items.length ? <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing by that name in this list.</li> : null}
              </ul>
              {pages > 1 ? <PageStepper className="border-t border-border-subtle px-3 py-2" page={shownPage} pageCount={pages} canPrevious={shownPage > 1} canNext={shownPage < pages} onPrevious={() => setPage(shownPage - 1)} onNext={() => setPage(shownPage + 1)} /> : null}
            </SheetContent>
          </Sheet>
          <div className="relative max-lg:hidden">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={find} onChange={(event) => setFind(event.target.value)} placeholder="Find in this queue" aria-label="Find in this queue" className="h-8 rounded-full ps-8 text-sm" />
          </div>
          {queue === "done" ? (
            <Select value={voted} onValueChange={(next) => { setPage(1); void setPlace({ voted: next as typeof voted, paper: null }); }}>
              <SelectTrigger aria-label="Which of your decisions" className="h-8 w-full text-xs max-lg:hidden"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Every decision, latest first</SelectItem>
                <SelectItem value="include">The ones you included</SelectItem>
                <SelectItem value="maybe">The ones you left as maybe</SelectItem>
                <SelectItem value="exclude">The ones you excluded</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          {queue === "todo" && toDo.length > 1 ? (
            <Select value={order} onValueChange={(next) => { setPage(1); void setPlace({ order: next as typeof order, paper: null }); }}>
              <SelectTrigger aria-label="Order of the queue" className="h-8 w-full text-xs max-lg:hidden"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dealt">As they were added</SelectItem>
                {toDo.some((one) => one.batch !== undefined) ? <SelectItem value="fresh">New papers first</SelectItem> : null}
                <SelectItem value="lean">Papers the models would include first</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <ul className="hidden divide-y divide-border-subtle border-t border-border-subtle lg:block">
          {items.slice((shownPage - 1) * QUEUE_PAGE, shownPage * QUEUE_PAGE).map((one) => row(one, (paper) => go(items.indexOf(paper))))}
        </ul>
        {pages > 1 ? (
          <PageStepper className="hidden border-t border-border-subtle px-3 py-2 lg:flex" page={shownPage} pageCount={pages} canPrevious={shownPage > 1} canNext={shownPage < pages} onPrevious={() => setPage(shownPage - 1)} onNext={() => setPage(shownPage + 1)} />
        ) : null}
      </div>

      {!paper ? (
        <Empty open={open} queue={queue} onQueue={onQueue} narrowed={Boolean(find.trim()) || (queue === "done" && voted !== "any")} onClear={() => { setPage(1); void setPlace({ paper: null, q: null, voted: null, order: null }, { history: "replace" }); }} />
      ) : (
        <>
          {/* The paper */}
          <div ref={article} className="min-w-0 scroll-mt-[calc(var(--app-navbar-height)+var(--page-header-height,4rem))]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.article key={paper.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: EASE }} className="mx-auto max-w-3xl space-y-4 p-5 sm:p-8">
                <h2 className="text-xl font-semibold leading-snug tracking-tight">{paper.title}</h2>
                <p className="text-sm text-muted-foreground">{paper.authors.join(", ")}. <span className="italic">{paper.venue}</span>, {paper.year}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {source ? (
                    <Popover>
                      <PopoverTrigger asChild><button type="button" aria-label="Where this paper came from" className="flex min-w-0 rounded-md outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring/50"><ClippedChip icon={kindIcon(source.kind)} className="max-w-72">{source.name}</ClippedChip></button></PopoverTrigger>
                      <PopoverContent align="start" className="w-80 space-y-1.5 p-3 text-sm">
                        <p className="font-medium">{source.name}</p>
                        <p className="text-xs text-muted-foreground">{source.detail}</p>
                        <div className="flex flex-wrap gap-1.5 pt-1">{source.filters?.map((filter) => <Chip key={filter}>{filter}</Chip>)}{paper.batch !== undefined ? <Chip icon={RefreshCw}>Found by the look on {day(paper.batch)}</Chip> : <Chip>In it from the start</Chip>}</div>
                      </PopoverContent>
                    </Popover>
                  ) : null}
                  <Chip icon={Quote}>{paper.cited} cited</Chip>
                  {paper.batch !== undefined ? <Chip icon={RefreshCw} className="bg-success/12 ink-success">Added {paper.batch > NOW ? "just now" : day(paper.batch)}</Chip> : null}
                </div>
                {!paper.sentences.length ? (
                  <div className="rounded-2xl border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">This paper came without an abstract. Decide on its title, or vote Maybe to leave it open.</div>
                ) : paper.original && !translated ? (
                  <div className="space-y-3">
                    <p lang="fr" className="text-[0.95rem] leading-7">{paper.original.text}</p>
                    <Button variant="outline" size="sm" onClick={() => setTranslated(true)}><TranslateIcon />Translate from {paper.original.language}</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[0.95rem] leading-7">
                      {paper.sentences.map((sentence, i) => <Sentence key={i} text={sentence} quoted={quoted === i} terms={criteria.flatMap((c) => c.terms)} />)}
                    </p>
                    {paper.original ? <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setTranslated(false)}><TranslateIcon />Translated from {paper.original.language}. Show the original</Button> : null}
                  </div>
                )}
              </motion.article>
            </AnimatePresence>
          </div>

          {/* The criteria and the votes */}
          <div className="min-w-0 border-t border-border-subtle lg:border-t-0">
            <div className="space-y-2 p-4">
              <div className="flex h-6 items-center justify-between">
                <h3 className="text-xs font-medium text-muted-foreground">Criteria</h3>
                {criteria.some((criterion) => criterion.must) ? <span className="me-auto ms-3 flex items-center text-xs text-muted-foreground"><RequiredMark />must-have</span> : null}
                <Popover>
                  <TooltipHint label="How to read this">
                    <PopoverTrigger asChild><Button variant="ghost" size="icon" className="-me-1 size-6 text-muted-foreground" aria-label="How to read this"><CircleHelp /></Button></PopoverTrigger>
                  </TooltipHint>
                  <PopoverContent align="end" className="w-80 space-y-2.5 p-3">
                    {HELP.map(([what, means]) => <p key={what} className="text-sm"><span className="font-medium">{what}.</span> <span className="text-muted-foreground">{means}</span></p>)}
                  </PopoverContent>
                </Popover>
              </div>
              {/* Each criterion with your answer, and under it, once you may see them, what every other reviewer answered. */}
              <ul key={paper.id} className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
                <li className="space-y-2 bg-inset px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="shrink-0 text-sm font-medium">Everyone&apos;s decisions</span>
                    {visible ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" aria-label="Who voted what" className="ms-auto flex flex-wrap items-center justify-end gap-1.5 rounded-lg outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring/50">
                            <span className="me-1 self-end text-xs text-muted-foreground underline decoration-dotted underline-offset-2">Who voted what</span>
                            {cast.map(({ reviewer, vote, failed }) => (
                              <span key={reviewer.id} className="flex flex-col items-center gap-1"><ReviewerMark reviewer={reviewer} you={reviewer.id === open.me} className="size-6" /><VoteMark vote={vote} failed={failed} who={reviewer.name} /></span>
                            ))}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-80 space-y-2.5 p-3">
                          {cast.map(({ reviewer, vote, failed }) => (
                            <div key={reviewer.id} className="flex items-start gap-2.5 text-sm">
                              <ReviewerMark reviewer={reviewer} className="size-6" />
                              <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 font-medium"><span className="truncate">{reviewer.name}</span>{reviewer.id === open.me ? <YouTag /> : reviewer.kind === "model" ? <span className="shrink-0 text-xs font-normal text-muted-foreground">AI model</span> : null}</p>
                                <p className="text-xs text-muted-foreground">{failed ? "Couldn't read this paper" : vote ? `${DECISION_LABEL[vote.decision]}${vote.reason ? `, ${failedLabel(vote.reason, criteria)}` : ""}` : reviewer.kind === "model" ? "Hasn't read it yet" : "Hasn't voted yet"}</p>
                                {vote?.note ? <p className="text-xs text-muted-foreground">“{vote.note}”</p> : null}
                              </div>
                            </div>
                          ))}
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <span className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
                        <Eye className="size-3.5 shrink-0" />Shown after you vote
                        <span className="flex gap-1">{cast.filter((one) => one.reviewer.id !== open.me).map(({ reviewer, vote }) => <VoteMark key={reviewer.id} vote={vote} hidden who={reviewer.name} />)}</span>
                      </span>
                    )}
                  </div>
                  {/* Where that leaves the paper. */}
                  {visible && state ? (
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <ResultChip result={state.result} />
                      {state.result === "waiting" ? `from ${waitsOn.slice(0, 2).join(" and ")}${waitsOn.length > 2 ? ` and ${waitsOn.length - 2} more` : ""}` : state.result === "conflict" ? `goes to ${personOf(screening.rule.resolver)?.name ?? "the person who settles them"}` : state.resolvedBy ? `settled by ${personOf(state.resolvedBy)?.name ?? "a reviewer"}${state.note ? `: “${state.note}”` : ""}` : state.result === "exclude" && cast.some((one) => one.vote?.reason) ? failedLabel(cast.find((one) => one.vote?.reason)!.vote!.reason!, criteria) : null}
                    </p>
                  ) : null}
                </li>
                {criteria.map((criterion, i) => {
                  const answered = answers[paper.id]?.[criterion.key] ?? (resolving ? undefined : mine?.answers[criterion.key]);
                  const others = cast.filter((one) => resolving || one.reviewer.id !== open.me);
                  const said = new Set(others.flatMap((one) => one.vote?.answers[criterion.key] ?? []));
                  const quoting = evidenceOf?.criterion === criterion && evidenceOf.reviewer ? evidenceOf.reviewer : null;
                  return (
                    <li key={criterion.key} className="space-y-2 px-3 py-2.5">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                        <p className="min-w-0 flex-1 text-sm leading-5"><CriterionText text={criterion.text} must={criterion.must} /></p>
                        {/* Settling a split is one decision: the answers shown are the reviewers'. */}
                        <div role="radiogroup" aria-label={`Your answer to criterion ${i + 1}`} className={cn("flex shrink-0 gap-1", (resolving || !open.isReviewer) && "hidden")}>
                          {ANSWERS.map((answer) => {
                            const Icon = ANSWER[answer].icon;
                            const on = answered === answer;
                            return (
                              <button key={answer} type="button" role="radio" aria-checked={on} aria-label={answer} onClick={() => answerIt(criterion.key, answer)} className={cn("flex size-7 items-center justify-center rounded-md border transition-colors", on ? cn(ANSWER[answer].className, "border-transparent ring-2 ring-current/50", answer === "no" && "bg-foreground/15 text-foreground") : "border-border-subtle text-muted-foreground hover:text-foreground")}>
                                <Icon className="size-3.5" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {visible && others.length ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, ease: EASE }} className="flex flex-wrap items-center justify-end gap-1.5 ps-7">
                          {others.map(({ reviewer, vote }) => {
                            const answer = vote?.answers[criterion.key];
                            const on = shown?.reviewer === reviewer.id && shown.criterion === criterion.key;
                            const mark = answer ? <AnswerMark answer={answer} label={`${reviewer.name}, ${criterion.short}`} /> : <span className="block size-6 rounded-md border border-dashed border-border" />;
                            // A model's answer opens the passage it read; a person's is theirs alone.
                            return reviewer.kind === "model" && answer ? (
                              <TooltipHint key={reviewer.id} label={`${reviewer.name}: show the passage it read`}>
                                <button type="button" aria-pressed={on} onClick={() => setShown(on ? null : { reviewer: reviewer.id, criterion: criterion.key })} className={cn("flex rounded-md transition-shadow hover:ring-2 hover:ring-border", on && "ring-2 ring-primary/60")}>{mark}</button>
                              </TooltipHint>
                            ) : (
                              <TooltipHint key={reviewer.id} label={answer ? reviewer.name : reviewer.kind === "model" ? `${reviewer.name} hasn't read it yet` : `${reviewer.name} gave no answer here`}>
                                <span tabIndex={0} className="flex rounded-md">{mark}</span>
                              </TooltipHint>
                            );
                          })}
                          {said.size > 1 ? <span className="ms-1 text-xs font-medium text-info">They differ</span> : null}
                        </motion.div>
                      ) : null}
                      <AnimatePresence initial={false}>
                        {quoting ? (
                          <motion.div key="evidence" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden ps-7">
                            <Evidence paper={paper} reviewer={quoting} criterion={criterion} criteria={criteria} answer={cast.find((one) => one.reviewer === quoting)?.vote?.answers[criterion.key]} />
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </li>
                  );
                })}
                {!criteria.length ? <li className="px-3 py-4 text-sm text-muted-foreground">This screening has no criteria. Decide on what you read, or add criteria in its settings.</li> : null}
              </ul>
            </div>

          </div>
        </>
      )}
    </div>
    {paper ? (
      /* The decision stays at the foot of the window however long the paper and the queue are, under the column each part belongs to: where you are in the queue, the decision, the last one with its way back. On a phone its buttons sit clear of the assistant's button in the corner. */
      <ActionBar className="max-lg:fixed max-lg:inset-x-0 max-lg:z-30 max-lg:shadow-[0_-10px_30px_-18px_rgb(0_0_0/0.35)]">
        <div className="flex flex-col gap-2 px-3 pt-3 pb-[max(1.75rem,env(safe-area-inset-bottom))] lg:grid lg:grid-cols-[19rem_minmax(0,1fr)_25rem] lg:items-end lg:gap-0 lg:p-0">
            <div className="flex items-center gap-1 max-lg:order-last max-lg:h-11 max-lg:pe-[4.25rem] lg:h-[4.75rem] lg:px-4">
                <span className="me-1 text-xs tabular-nums text-muted-foreground">{queue === "done" ? `${at + 1} of ${items.length}` : `${left.toLocaleString("en-GB")} left`}</span>
                <TooltipHint label="Previous paper"><Button variant="ghost" size="icon" className="size-7" aria-label="Previous paper" disabled={at <= 0} onClick={() => go(at - 1)}><ChevronLeft /></Button></TooltipHint>
                <TooltipHint label="Next paper"><Button variant="ghost" size="icon" className="size-7" aria-label="Next paper" disabled={at >= items.length - 1} onClick={() => go(at + 1)}><ChevronRight /></Button></TooltipHint>
                <Popover>
                  <TooltipHint label="Keyboard shortcuts">
                    <PopoverTrigger asChild><Button variant="ghost" size="icon" className="size-7 text-muted-foreground max-lg:hidden" aria-label="Keyboard shortcuts"><CircleHelp /></Button></PopoverTrigger>
                  </TooltipHint>
                  <PopoverContent align="start" side="top" className="w-72 space-y-1.5 p-3">
                    {SHORTCUTS.map(([key, what]) => <p key={key} className="flex items-center gap-3 text-sm"><Kbd className="min-w-9">{key}</Kbd><span>{what}</span></p>)}
                  </PopoverContent>
                </Popover>
                {/* On a phone the last decision's way back sits here, and the rest folds into one menu. */}
                {last ? <Button variant="ghost" size="icon" className="size-8 lg:hidden" aria-label="Undo the last decision" onClick={undo}><Undo2 /></Button> : null}
                {last && differ ? <button type="button" onClick={() => go(items.findIndex((one) => one.id === last.paper.id))} className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-info/12 px-2 text-xs font-medium text-info lg:hidden"><GitCompare className="size-3.5" />{differ} disagreed</button> : null}
                <Popover>
                  <PopoverTrigger asChild><Button variant="ghost" size="icon" className="ms-auto size-8 text-muted-foreground lg:hidden" aria-label="More for this paper"><MoreHorizontal /></Button></PopoverTrigger>
                  <PopoverContent align="end" side="top" className="w-72 space-y-3 p-3">
                    <label className="flex items-center gap-3 text-sm">
                      <span className="min-w-0 flex-1">Go to the next paper after a decision</span>
                      <Switch checked={advance} onCheckedChange={setAdvance} aria-label="Go to the next paper after a decision" />
                    </label>
                    <label className="flex items-center gap-3 text-sm">
                      <span className="min-w-0 flex-1">Write a note with your decision</span>
                      <Switch checked={noting} onCheckedChange={setNoting} aria-label="Write a note with your decision" />
                    </label>
                  </PopoverContent>
                </Popover>
              </div>
            <div className="min-w-0 lg:px-5 lg:py-3 xl:px-8">
              {!mayDecide ? (
                <p className="rounded-xl bg-inset px-3 py-3 text-sm text-muted-foreground">
                  {resolving ? `${personOf(screening.rule.resolver)?.name ?? "The person named in the settings"} settles conflicts on this screening.` : "You are not one of this screening's reviewers, so you don't vote on its papers."}
                </p>
              ) : through && !reasonFor ? (
                <div className="space-y-2 rounded-xl bg-success/10 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium"><Check className="size-4 ink-success" />{resolving ? "Every conflict here is settled" : `That was the last of your ${items.length} ${items.length === 1 ? "paper" : "papers"}`}</p>
                  <div className="flex flex-wrap gap-2">
                    {!resolving && conflicts.length ? <Button size="sm" variant={open.canResolve ? "default" : "outline"} onClick={() => onQueue("conflicts")}><GitCompare />{open.canResolve ? "Settle" : "See"} {conflicts.length} {conflicts.length === 1 ? "conflict" : "conflicts"}</Button> : null}
                    {resolving && toDo.length ? <Button size="sm" onClick={() => onQueue("todo")}>Screen {toDo.length} {toDo.length === 1 ? "paper" : "papers"}</Button> : null}
                    <Button asChild size="sm" variant="outline"><NextLink href={overviewHref(open.screening.id)}>Back to the overview</NextLink></Button>
                  </div>
                </div>
              ) : writing === paper.id ? (
                <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); decideOn("exclude", OTHER); }}>
                  <label htmlFor="other-reason" className="text-xs font-medium text-muted-foreground">Why is it excluded? Write the reason</label>
                  <Input id="other-reason" autoFocus value={notes[paper.id] ?? ""} onChange={(event) => setNotes((all) => ({ ...all, [paper.id]: event.target.value }))} placeholder="Such as: a conference abstract with no data" className="h-9 text-sm" />
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={() => setWriting(null)}>Back</Button>
                    <Button type="submit" size="sm" className="flex-1" disabled={!notes[paper.id]?.trim()}>Exclude</Button>
                  </div>
                </form>
              ) : reasonFor === paper.id ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Why is it excluded?</p>
                  {notes[paper.id]?.trim() ? <p className="truncate rounded-lg bg-inset px-2.5 py-1.5 text-xs text-muted-foreground">Your note goes with it: “{notes[paper.id]}”</p> : null}
                  <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5 max-lg:max-h-56 max-lg:overflow-y-auto">
                    {reasons.map((reason, i) => (
                      <button key={reason.key} type="button" onClick={() => decideOn("exclude", reason.key)} className="flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-border-subtle px-2.5 py-1.5 text-start text-sm transition-colors hover:border-foreground/30">
                        {i < 9 ? <Kbd className="max-lg:hidden">{i + 1}</Kbd> : null}
                        <span className="line-clamp-2">{reason.label}</span>
                      </button>
                    ))}
                  </div>
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => setReasonFor(null)}>Back<Kbd className="ms-1 max-lg:hidden">Esc</Kbd></Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {resolving ? <p className="text-xs text-muted-foreground">Your decision is the paper&apos;s result. Maybe leaves it open.{mine ? ` Your own vote here was ${DECISION_LABEL[mine.decision]}.` : ""}</p> : null}
                  {against && mine ? (
                    <p className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs ink-warning">Your decision is {DECISION_LABEL[mine.decision]}, and your answers point to {DECISION_LABEL[pointsTo!.decision]}{failing ? `: you answered ${given[failing.key] === "no" ? "no" : "unclear"} to criterion ${criteria.indexOf(failing) + 1}, a must-have` : ""}.</p>
                  ) : !mine && pointsTo && failing ? (
                    <p className="rounded-lg bg-inset px-2.5 py-1.5 text-xs text-muted-foreground">Your answers point to <span className="font-medium text-foreground">{DECISION_LABEL[pointsTo.decision]}</span>: you answered {given[failing.key] === "no" ? "no" : "unclear"} to criterion {criteria.indexOf(failing) + 1}, a must-have.</p>
                  ) : !mine && pointsTo?.decision === "include" && criteria.filter((criterion) => criterion.must).every((criterion) => given[criterion.key] === "yes") ? (
                    <p className="rounded-lg bg-inset px-2.5 py-1.5 text-xs text-muted-foreground">Your answers point to <span className="font-medium text-foreground">Include</span>: every must-have is met.</p>
                  ) : null}
                  <Textarea rows={1} value={notes[paper.id] ?? (resolving ? "" : (mine?.note ?? ""))} onChange={(event) => setNotes((all) => ({ ...all, [paper.id]: event.target.value }))} placeholder={resolving ? "Why, for the record (optional)" : "A note for the others (optional)"} aria-label="Note" className={cn("max-h-28 min-h-8 resize-none py-1.5 text-sm field-sizing-content", !noting && "max-lg:hidden")} />
                  <div className="grid grid-cols-3 gap-2">
                    {[...DECISIONS].reverse().map((decision) => {
                      const Icon = RESULT_STYLE[decision].icon;
                      const on = resolving ? Boolean(settled[paper.id]!.resolvedBy) && settled[paper.id]!.final === decision : mine?.decision === decision;
                      return (
                        <button key={decision} type="button" data-decision aria-pressed={on} onClick={() => press(decision)} className={cn("flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors", on ? cn(RESULT_STYLE[decision].chip, "border-transparent ring-1 ring-current") : "border-border-subtle hover:bg-foreground/[0.03]", !on && !mine && pointsTo?.decision === decision && decision !== "include" && "border-dashed border-foreground/50")}>
                          <Icon className={cn("size-4", !on && (decision === "include" ? "ink-success" : decision === "maybe" ? "ink-warning" : "text-muted-foreground"))} />
                          {DECISION_LABEL[decision]}
                          <Kbd className="max-lg:hidden">{KEYS[decision]}</Kbd>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {/* The last decision, with the way back, and whether a decision moves on to the next paper. It keeps clear of the assistant's button in the corner. */}
            <div className="flex h-[4.75rem] items-center gap-2 px-4 pe-[4.5rem] text-xs text-muted-foreground max-lg:hidden">
                {last ? (
                  <>
                    {/* What was just decided, in as few words as say it; the paper itself is one press away. */}
                    <button type="button" onClick={() => go(items.findIndex((one) => one.id === last.paper.id))} className="min-w-0 flex-1 truncate text-start hover:underline">
                      Last paper: <span className="font-medium text-foreground">{DECISION_LABEL[last.decision]}</span>
                    </button>
                    {differ ? <button type="button" aria-label={`${differ} of the others voted differently on the last paper: see it`} onClick={() => go(items.findIndex((one) => one.id === last.paper.id))} className="shrink-0 rounded-md bg-info/12 px-2 py-1 font-medium text-info transition-opacity hover:opacity-75">{differ} disagreed</button> : null}
                    {/* The last of the papers a look brought: said once, where the decision is. */}
                    {!differ && last.paper.batch !== undefined && !toDo.some((one) => one.batch !== undefined) ? <span className="shrink-0 rounded-md bg-success/12 px-2 py-1 font-medium ink-success">New papers done</span> : null}
                    <Button variant="ghost" size="xs" onClick={undo}><Undo2 />Undo<Kbd className="max-lg:hidden">Z</Kbd></Button>
                  </>
                ) : null}
              <label className="ms-auto flex shrink-0 items-center gap-2">
                Go to the next one
                <Switch checked={advance} onCheckedChange={setAdvance} aria-label="Go to the next paper after a decision" />
              </label>
            </div>
        </div>
      </ActionBar>
    ) : null}
    </>
  );
}

/** What a queue says when it holds nothing, and where to go from there. */
function Empty({ open, queue, onQueue, narrowed, onClear }: { open: Open; queue: Queue; onQueue: (queue: Queue) => void; /** The list is empty because of what was searched or asked for, not because it holds nothing. */ narrowed: boolean; onClear: () => void }) {
  if (narrowed) {
    return (
      <div className="col-span-2 flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-sm font-medium">Nothing in this list matches</p>
        <p className="max-w-sm text-sm text-muted-foreground">The search reads each paper&apos;s title, authors and abstract.</p>
        <Button size="sm" variant="outline" className="mt-1" onClick={onClear}>Show the whole list</Button>
      </div>
    );
  }
  const text = !open.isReviewer && queue !== "conflicts"
    ? ["No paper waits for you", "You are not one of this screening's reviewers. You can read every paper and how it was voted on in Papers."]
    : queue === "todo"
      ? open.gathering ? ["Its papers are on their way", `${open.gathering.done.toLocaleString("en-GB")} of ${open.gathering.of.toLocaleString("en-GB")} are in. Yours show here as they arrive.`] : open.yours.length ? ["You have voted on all your papers", `That was ${open.yours.length} of them. A paper comes back here only if someone changes the screening.`] : ["No paper has been dealt to you", "Papers are dealt as they arrive."]
      : queue === "conflicts"
        ? ["No conflict to settle", "A paper comes here when its reviewers vote differently."]
        : ["You haven't voted on a paper yet", "The papers you decide show here, where you can change your mind."];
  return (
    <div className="col-span-2 flex flex-col items-center justify-center gap-2 p-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-success/12 ink-success"><Check className="size-5" /></span>
      <p className="text-sm font-medium">{text[0]}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{text[1]}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {queue !== "conflicts" && open.conflicts.length ? <Button size="sm" variant={open.canResolve ? "default" : "outline"} onClick={() => onQueue("conflicts")}><GitCompare />{open.canResolve ? "Settle" : "See"} {open.conflicts.length} {open.conflicts.length === 1 ? "conflict" : "conflicts"}</Button> : null}
        {queue !== "todo" && open.toDo.length ? <Button size="sm" onClick={() => onQueue("todo")}>Screen {open.toDo.length} {open.toDo.length === 1 ? "paper" : "papers"}</Button> : null}
        <Button asChild size="sm" variant="outline"><NextLink href={papersHref(open.screening.id)}>See all the papers</NextLink></Button>
        <Button asChild size="sm" variant="outline"><NextLink href={overviewHref(open.screening.id)}>Back to the overview</NextLink></Button>
      </div>
    </div>
  );
}

/** A sentence of the abstract, with the criteria's words marked, and the whole of it when a model quoted it. */
function Sentence({ text, quoted, terms }: { text: string; quoted: boolean; terms: string[] }) {
  const words = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const parts = words.length ? text.split(new RegExp(`\\b(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi")) : [text];
  return (
    <span className={cn("rounded box-decoration-clone transition-colors duration-300", quoted && "bg-warning/20")}>
      {parts.map((part, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-primary/15 text-foreground">{part}</mark> : part))}{" "}
    </span>
  );
}

/** Each reviewer's answer to each criterion, and their decision: who said what. */
export function Matrix({ criteria, cast, me, shown, onShow }: { criteria: Criterion[]; cast: Array<{ reviewer: Reviewer; vote: Vote | undefined; failed?: boolean }>; /** Whose face is ringed as yours. */ me?: string; shown: { reviewer: string; criterion: string } | null; onShow: (cell: { reviewer: string; criterion: string } | null) => void }) {
  return (
    <div className="grid w-max min-w-full items-center gap-x-1 gap-y-1.5" style={{ gridTemplateColumns: `minmax(7rem, 1fr) repeat(${cast.length}, 1.75rem)` }}>
      <span />
      {cast.map(({ reviewer }) => (
        <TooltipHint key={reviewer.id} label={reviewer.id === me ? `${reviewer.name}, you` : reviewer.name}>
          <span tabIndex={0} className="flex justify-center"><ReviewerMark reviewer={reviewer} you={reviewer.id === me} /></span>
        </TooltipHint>
      ))}
      {criteria.map((criterion) => {
        const given = cast.map((one) => one.vote?.answers[criterion.key]);
        const split = new Set(given.filter(Boolean)).size > 1;
        return (
          <div key={criterion.key} className="contents">
            <span className={cn("truncate pe-2 text-xs", split ? "font-medium text-foreground" : "text-muted-foreground")}><CriterionText text={criterion.short} must={criterion.must} /></span>
            {cast.map(({ reviewer }, i) => {
              const answer = given[i];
              if (!answer) return <span key={reviewer.id} className="mx-auto size-6 rounded-md border border-dashed border-border" />;
              const on = shown?.reviewer === reviewer.id && shown.criterion === criterion.key;
              return reviewer.kind === "model" ? (
                <button key={reviewer.id} type="button" aria-pressed={on} aria-label={`${reviewer.name}, ${criterion.short}: show the passage`} onClick={() => onShow(on ? null : { reviewer: reviewer.id, criterion: criterion.key })} className={cn("mx-auto flex rounded-md transition-shadow", on && "ring-2 ring-primary/60")}>
                  <AnswerMark answer={answer} label={`${reviewer.name}, ${criterion.short}`} />
                </button>
              ) : (
                <span key={reviewer.id} className="mx-auto flex"><AnswerMark answer={answer} label={`${reviewer.name}, ${criterion.short}`} /></span>
              );
            })}
          </div>
        );
      })}
      <span className="border-t border-border-subtle pt-2 text-xs font-medium">Decision</span>
      {cast.map(({ reviewer, vote, failed }) => (
        <span key={reviewer.id} className="flex justify-center border-t border-border-subtle pt-2"><VoteMark vote={vote} failed={failed} who={reviewer.name} /></span>
      ))}
    </div>
  );
}

/** The passage a model read for one answer, and what it made of it. */
export function Evidence({ paper, reviewer, criterion, criteria, answer }: { paper: Paper; reviewer: Reviewer; criterion: Criterion; criteria: Criterion[]; answer?: Answer }) {
  if (!answer) return null;
  const { quote, why } = evidence(paper, criterion, criteria, answer);
  const sure = Math.round(confidenceOf(paper, reviewer, criterion, answer) * 100);
  return (
    <div className="space-y-2 rounded-2xl bg-inset p-3">
      <div className="flex items-center gap-2 text-xs">
        <ReviewerMark reviewer={reviewer} className="size-5" />
        <span className="min-w-0 flex-1 truncate font-medium">{reviewer.name}</span>
        {/* How sure the model says it is, so a split can be weighed. */}
        <TooltipHint label={sure < 65 ? "The model wasn't sure of this answer. Read the passage before you rely on it." : "How sure the model says it is of this answer"}>
          <span tabIndex={0} className="flex items-center gap-1.5 rounded-md tabular-nums text-muted-foreground">
            <Meter value={sure} max={100} className="w-12" fill={sure < 65 ? "bg-warning" : "bg-foreground/45"} />
            {sure}% sure
          </span>
        </TooltipHint>
        <AnswerMark answer={answer} label={criterion.short} />
      </div>
      <p className="flex gap-2 text-sm leading-5"><Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span>{quote}</span></p>
      <p className="text-xs text-muted-foreground">{why}</p>
    </div>
  );
}
