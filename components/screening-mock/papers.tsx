"use client";

// The open screening's Papers page: every paper as a row, a column of votes per reviewer, and where
// the paper stands. A row opens the paper in a drawer at the window's side, with who voted what and when.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import NextLink from "next/link";
import { createSerializer, parseAsArrayOf, parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown, Award, CalendarDays, Check, ChevronDown, ChevronRight, ChevronUp, Clock, Download, GitCompare, Hourglass, Layers, ListChecks, Play, RefreshCw, Search, SlidersHorizontal, TriangleAlert, Undo2, Users, X, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { AnimatedNumber, Chip, Stars } from "@/components/screening/parts";
import { EASE } from "@/components/settings/model-map";
import { Segmented, pagerOf } from "@/components/settings/parts";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { passageAt, plural, num, inQuotes, inOrder, type Criterion, listed, nameOn, resolves, unclearLabel, DECISIONS, DECISION_LABEL, RESULTS, RESULT_LABEL, ago, failedLabel, keptOf, personOf, questionOf, reasonOf, scoreOf, taken, votingReviewers, type Decision, type Paper, type Reviewer, whoIs, NO_VOTE, shortName, NO_VOTE_SAYS, VOTES_HIDDEN_SAYS, emptyResult, firstName } from "./data";
import { papersHref, screenHref } from "./links";
import { AnswerMark, FILTER_ON, FilterMenu, Help, Kbd, LinkChip, Note, PaperStepper, ReasonChip, PaperFacts, ReasonRows, VoteButton, RetryRead, VotesHelp, ShutChip, ShutNote, VOTES_SHUT, youFirst, Named, Panel, QuestionHint, QuestionName, RESULT_ICON, RESULT_STYLE, Reason, ResultChip, ReviewerMark, ReviewerName, Section, StateChip, TONE, Tally, VoteMark, BELOW_HEADER, UNDER_FRAME, kindIcon, LeftOutNote } from "./parts";
import { Evidence, Matrix, Said } from "./screen";
import { credits, type Open } from "./store";
import type { ExportTab } from "./dialogs";
import { risOf, save, votesCsv } from "./export";
import { Discussion, DiscussionShut } from "./discussion";
import { useWorkspace } from "./workspace";
import { ScrollArea } from "@/components/ui/scroll-area";

const PAGE = 20;
const ROW = 57;

const SORTS = ["added", "title", "title-desc", "result", "newest", "split", "points"] as const;
type Sort = (typeof SORTS)[number];
const SORT_LABEL: Record<Sort, string> = { added: "As added", title: "Title, A to Z", "title-desc": "Title, Z to A", result: "Result", newest: "Published, newest first", split: "Most disagreement", points: "Most points" };
/** Each order's sign: an arrow for the way a title runs, and what the others go by. */
const SORT_ICON: Record<Sort, AppIcon> = { added: Clock, title: ArrowDown, "title-desc": ArrowUp, result: ListChecks, newest: CalendarDays, split: GitCompare, points: Award };
const VOTED = ["any", ...DECISIONS, "none", "settled", "failed"] as const;
type Voted = (typeof VOTED)[number];

/**
 * What the table shows, kept in the address (papersHref in links.ts says what each means). `reviewer`
 * with `voted` narrows to one reviewer's votes, and `voted` alone to your own. `voted=settled` is the
 * conflicts that reviewer settled, and `voted=failed` the papers a model couldn't read. `reason` is why
 * a paper was excluded, or the criterion a Maybe was unclear on. `page` is left out by a link that
 * opens a `paper`: the table then shows the page that holds it.
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
  page: parseAsInteger,
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
    return { on, href: on ? addressOf(papersHref(id), { ...place, ...Object.fromEntries(undo.map((key) => [key, null])), page: null }) : addressOf(papersHref(id), { ...place, ...(to as Partial<typeof place>), page: null }), "aria-current": on ? ("true" as const) : undefined };
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
  const { screening, papers, votes, settled } = open;
  const id = screening.id;
  // Its reviewers, and whoever was taken off with votes that still count: a result can rest on one of those votes, so its column and its filter stay.
  const reviewers = inOrder(votingReviewers(screening), open.me);
  const criteria = screening.criteria;
  // A tab, a filter, an order or a page is a step Back returns from. Typing in the search box and going from paper to paper change the address in place.
  const [place, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  const narrow = useNarrow(id, open.me);
  const { result: filter, by: columns, source: from, reviewer, voted, with: also, reason, added, sort, q: query, page, paper: opened } = place;
  /** Narrows or reorders the table, which starts again from its first page. */
  const go = (next: Parameters<typeof setPlace>[0]) => void setPlace({ page: null, ...next });
  const clearFilters = () => go({ source: null, reviewer: null, voted: null, with: null, reason: null, added: null, q: null });
  // Opening a paper and closing it are steps Back returns from. Going from one open paper to another changes the address in place.
  const show = (paperId: string) => void setPlace({ paper: paperId }, opened ? { history: "replace" } : undefined);
  // Closing it leaves the table on the page it was showing, which the address then has to name.
  const close = () => void setPlace({ paper: null, page: pager.page > 1 ? pager.page : null });
  // A selection belongs to the list it was made in: another tab, filter, search or order starts with none selected.
  // The other reviewers as one word: the list itself is a new one on every draw.
  const alsoKey = also.join(",");
  const scope = [filter, from, reviewer, voted, alsoKey, reason, added, sort, query].join("|");
  const [selection, setSelection] = useState({ scope, ids: [] as string[] });
  const picked = selection.scope === scope ? selection.ids : [];
  const setPicked = (ids: string[]) => setSelection({ scope, ids });
  const [filtering, setFiltering] = useState(false);
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
  const reasonKey = useCallback(
    (paper: Paper) => {
      const state = settled[paper.id]!;
      const entries = votes[paper.id]!;
      if (state.result === "exclude") return reasonOf(entries, state);
      if (state.result === "maybe") return criteria.find((criterion) => criterion.must && entries.some((one) => one.vote?.answers[criterion.key] === "unclear"))?.key;
      return undefined;
    },
    [settled, votes, criteria],
  );
  const entryOf = (paper: Paper, reviewerId: string) => votes[paper.id]!.find((one) => one.reviewer.id === reviewerId);
  /** Whether a reviewer's vote on a paper is of a kind: what the Vote filter keeps, and what it counts beside each choice. */
  const votedAs = (paper: Paper, reviewerId: string, kind: Voted) => {
    if (kind === "settled") return settled[paper.id]!.resolvedBy === reviewerId;
    const theirs = entryOf(paper, reviewerId);
    if (!theirs) return false;
    if (kind === "failed") return Boolean(theirs.failed);
    if (kind === "none") return !theirs.vote && !theirs.failed && !settled[paper.id]!.final;
    // Which way someone else voted on a paper whose votes are hidden from the person looking is hidden here too: a filter that kept it would say what the locked mark doesn't.
    if (kind !== "any" && reviewerId !== open.me && !open.canSee(paper)) return false;
    return kind === "any" ? Boolean(theirs.vote) : theirs.vote?.decision === kind;
  };
  // The votes a filter by someone else's decision can't look at: theirs on the papers whose votes are hidden from the person looking.
  const words = query.trim().toLowerCase();
  /** Everything that narrows the table but whose vote it is: the source, when it was added, who else voted, the reason, the search. */
  const passes = (paper: Paper) =>
    (from === "all" || paper.source === from) &&
    (added === "all" || (added === "start" ? paper.batch === undefined : String(paper.batch) === added)) &&
    also.every((one) => Boolean(entryOf(paper, one)?.vote)) &&
    (!reason || reasonKey(paper) === reason) &&
    (!words || `${paper.title} ${paper.authors.join(" ")} ${paper.sentences.join(" ")}`.toLowerCase().includes(words));
  // Only the ones the rest of the narrowing and the open tab would have kept: a paper another filter drops is not left out by this one.
  const keptBack = who && who !== open.me && (DECISIONS as readonly string[]).includes(voted) ? papers.filter((paper) => passes(paper) && (filter === "all" || settled[paper.id]!.result === filter) && entryOf(paper, who)?.vote && !open.canSee(paper)).length : 0;
  // Every paper the filters and the search leave, whatever its result: the tabs count these.
  const narrowed = useMemo(() => {
    return papers.filter((paper) => passes(paper) && (!who || votedAs(paper, who, voted)));
  }, [papers, votes, settled, from, added, who, voted, alsoKey, reason, reasonKey, query, open.me]); // eslint-disable-line react-hooks/exhaustive-deps -- the others by their ids, since the list is a new one on every draw
  const tabCounts = useMemo(() => Object.fromEntries(RESULTS.map((result) => [result, narrowed.filter((paper) => settled[paper.id]!.result === result).length])) as Record<(typeof RESULTS)[number], number>, [narrowed, settled]);
  const rows = useMemo(() => {
    const list = filter === "all" ? narrowed : narrowed.filter((paper) => settled[paper.id]!.result === filter);
    // How far a paper's votes are apart: among the reviewers the table is narrowed to where it is narrowed to several, so two people's papers come with the ones they split on first. Votes hidden from the person looking don't place a paper.
    const split = (paper: Paper) => (open.canSee(paper) ? new Set(votes[paper.id]!.flatMap((one) => (everyone.length < 2 || everyone.includes(one.reviewer.id) ? (one.vote?.decision ?? []) : []))).size : 0);
    const points = (paper: Paper) => (open.canSee(paper) ? scoreOf(screening, votes[paper.id]!).points : -1);
    if (sort === "title") return [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "title-desc") return [...list].sort((a, b) => b.title.localeCompare(a.title));
    if (sort === "result") return [...list].sort((a, b) => RESULTS.indexOf(settled[a.id]!.result) - RESULTS.indexOf(settled[b.id]!.result));
    if (sort === "newest") return [...list].sort((a, b) => b.year - a.year);
    if (sort === "split") return [...list].sort((a, b) => split(b) - split(a));
    if (sort === "points") return [...list].sort((a, b) => points(b) - points(a));
    return list;
  }, [narrowed, filter, settled, votes, sort, screening, open.me, everyone.join()]); // eslint-disable-line react-hooks/exhaustive-deps -- the reviewers by their ids, and what the person looking may see by who they are
  // When papers joined after the start: each check that brought some, and each source added later.
  const arrivals = [...new Set(papers.flatMap((paper) => paper.batch ?? []))].sort((a, b) => b - a);
  const newest = arrivals[0];
  const paper = papers.find((one) => one.id === opened);
  // Where the open paper is in the whole list. A link that opens a paper names it and no page: the table shows the page that holds it, so the paper is there in the list and not only beside it.
  const at = paper ? rows.indexOf(paper) : -1;
  const pager = pagerOf(rows.length, PAGE, page ?? (at >= 0 ? Math.floor(at / PAGE) + 1 : 1), (next) => void setPlace({ page: next }));
  const shown = rows.slice((pager.page - 1) * PAGE, pager.page * PAGE);
  const inView = at >= 0 && Math.floor(at / PAGE) + 1 === pager.page;
  const chosen = picked.filter((one) => papers.some((p) => p.id === one));
  const allShown = shown.length > 0 && shown.every((one) => chosen.includes(one.id));
  const everyRow = rows.length > shown.length && rows.every((one) => chosen.includes(one.id));

  // The step to the paper before or after the open one, onto its page.
  const step = (by: 1 | -1) => {
    const next = rows[at + by];
    if (next) void setPlace({ paper: next.id, page: Math.floor((at + by) / PAGE) + 1 }, { history: "replace" });
  };

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
  }, [opened, inView, pager.page, filter, from, reviewer, voted, alsoKey, reason, added, sort]);

  // The keyboard is the outside system: J and K or the arrows step through the list.
  useEffect(() => {
    if (!opened) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Inside the paper's own drawer the keys still step; the drawer closes itself on Escape. Any other dialog or menu keeps its keys.
      if (target?.closest("[role=menu], [role=listbox], [role=dialog]:not([data-paper-drawer])") || event.key === "Escape") return;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "j" || event.key === "ArrowRight") step(1);
      else if (event.key === "k" || event.key === "ArrowLeft") step(-1);
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
  }, [tableWidth, papers.length > 0]);

  const conflictsPicked = chosen.filter((one) => settled[one]!.result === "conflict");
  const settleAll = (decision: Decision, why?: { reason: string; note?: string }) => {
    const settling = conflictsPicked.flatMap((one) => papers.find((p) => p.id === one) ?? []);
    for (const one of settling) open.resolve(one, decision, why?.note, why?.reason);
    setPicked([]);
    toast(`Settled ${settling.length} as ${RESULT_LABEL[decision]}`, { action: { label: "Undo", onClick: () => settling.forEach((one) => open.resolve(one, null)) } });
  };
  // The selection as a file: built by the builders the Export dialog uses, so the rows are the same and a vote hidden on this page is hidden in the file.
  const exportPicked = (as: "csv" | "ris") => {
    const picks = chosen.flatMap((one) => papers.find((p) => p.id === one) ?? []);
    if (as === "csv") save("selected-papers-votes.csv", "text/csv", votesCsv({ screening, state: open, me: open.me }, picks));
    else save("selected-papers.ris", "application/x-research-info-systems", risOf(picks));
  };

  // What narrows the table, each as a chip that takes it away.
  const whoName = who && who !== open.me ? nameOn(open.screening, who) : null;
  const addedLabel = (at: string) => (at === "start" ? "At the start" : ago(Number(at)));
  // The source narrowed to: the Overview counts what it brought, this list the papers kept once duplicates were merged.
  const narrowedSource = screening.sources.find((one) => one.id === from);
  const merged = narrowedSource ? taken(narrowedSource) - keptOf(narrowedSource) : 0;
  const active = [
    from !== "all" ? { key: "source", label: `Source ${narrowedSource?.name ?? "removed"}`, shown: <Named name="Source">{narrowedSource?.name ?? "removed"}</Named>, clear: { source: null }, fact: merged && narrowedSource ? `${num(keptOf(narrowedSource))} papers, ${plural(merged, "duplicate", "duplicates")} merged` : undefined } : null,
    who
      ? {
          key: "reviewer",
          label: voted === "any" ? (everyone.length > 1 ? `Voted on by ${listed(everyone.map((one) => whoIs(open.screening, one, open.me)))}` : whoName ? `Votes by ${whoName}` : "Your votes") : voted === "none" ? (whoName ? `Waiting for ${whoName}'s vote` : "Waiting for your vote") : voted === "settled" ? `Settled by ${whoName ?? "you"}` : voted === "failed" ? `${whoName ?? "You"} couldn't read it` : `${whoName ?? "You"} voted ${DECISION_LABEL[voted]}`,
          clear: { reviewer: null, voted: null, with: null },
        }
      : null,
    // Beside a reviewer's own kind of vote, the others are named apart.
    also.length && voted !== "any" ? { key: "with", label: `Also voted on by ${listed(also.map((one) => whoIs(open.screening, one, open.me)))}`, clear: { with: null } } : null,
    reason ? { key: "reason", label: filter === "maybe" ? unclearLabel(reason, criteria) : failedLabel(reason, criteria), shown: <Reason reason={reason} criteria={criteria} unclear={filter === "maybe"} />, clear: { reason: null } } : null,
    added !== "all" ? { key: "added", label: `Added ${addedLabel(added)}`, shown: <Named name="Added">{addedLabel(added)}</Named>, clear: { added: null } } : null,
  ].filter((one) => one !== null);
  const anyFilter = active.length > 0 || Boolean(query.trim());

  if (!papers.length) return <p className="px-6 py-20 text-center text-sm text-muted-foreground">{open.gathering ? "Its papers are on their way. They show here as they arrive." : "This screening has no papers yet."}</p>;

  const reviewerOptions = reviewers;
  const settles = (reviewerId: string) => resolves(screening, reviewerId);
  const countVoted = (kind: Voted) => (who ? papers.filter((paper) => votedAs(paper, who, kind)).length : 0);
  // The filters, in the row over the table and in a phone's sheet.
  const filters = (trigger: string) => (
    <>
      {screening.sources.length > 1 ? (
        <FilterMenu
          name="Source"
          value={from}
          onChange={(next) => go({ source: next === "all" ? null : next })}
          className={trigger}
          choices={[{ value: "all", label: "All", icon: <Layers />, count: papers.length }, ...screening.sources.map((source) => { const Icon = kindIcon(source.kind); return { value: source.id, label: source.name, icon: <Icon />, count: papers.filter((one) => one.source === source.id).length }; })]}
        />
      ) : null}
      {/* Any number of reviewers: with several, the table shows the papers all of them voted on. The menu stays open while they are picked. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-slot="select-trigger" data-size="sm" aria-label={`Reviewers: ${everyone.length ? listed(everyone.map((one) => whoIs(open.screening, one, open.me))) : "anyone"}`} className={cn(SELECT_TRIGGER, everyone.length > 0 && FILTER_ON, trigger)}>
            <span className="text-muted-foreground">{everyone.length > 1 ? "Reviewers" : "Reviewer"}</span>
            {everyone.length > 1 ? (
              <span className="flex items-center">{everyone.map((one, i) => { const mark = reviewerOptions.find((option) => option.id === one); return mark ? <span key={one} className={cn("flex rounded-full ring-2 ring-card", i > 0 && "-ms-1")}><ReviewerMark reviewer={mark} className="size-4" /></span> : null; })}</span>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5 font-medium">{who ? <>{whoMark ? <ReviewerMark reviewer={whoMark} className="size-4" /> : null}<span className="truncate">{who === open.me ? "You" : nameOn(open.screening, who)}</span></> : "Anyone"}</span>
            )}
            <ChevronDown className="size-4 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={cn("w-64", AVATARS_FADE_IN)}>
          <DropdownMenuItem onSelect={() => go({ reviewer: null, voted: null, with: null })}><Users /><span className="flex-1">Anyone</span>{everyone.length ? null : <Check className="size-4" />}</DropdownMenuItem>
          {[["People", reviewerOptions.filter((one) => one.kind === "person")], ["Models", reviewerOptions.filter((one) => one.kind === "model")]].map(([label, list]) =>
            (list as Reviewer[]).length ? (
              <div key={label as string} role="group" aria-label={label as string}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{label as string}</DropdownMenuLabel>
                {(list as Reviewer[]).map((one) => (
                  <DropdownMenuItem key={one.id} role="menuitemcheckbox" aria-checked={everyone.includes(one.id)} onSelect={(event) => { event.preventDefault(); pick(one.id); }}>
                    <ReviewerMark reviewer={one} className="size-4" /><span className="min-w-0 flex-1 truncate">{one.id === open.me ? "You" : one.name}</span>{everyone.includes(one.id) ? <Check className="size-4" /> : null}
                  </DropdownMenuItem>
                ))}
              </div>
            ) : null,
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {who && everyone.length === 1 ? (
        <FilterMenu
          name="Vote"
          value={voted}
          onChange={(next) => go({ reviewer: who, voted: next === "any" ? null : next })}
          className={trigger}
          choices={[
            { value: "any" as Voted, label: "Any vote", icon: <ListChecks />, count: countVoted("any") },
            ...DECISIONS.map((decision) => { const { icon: Icon, tone } = RESULT_STYLE[decision]; return { value: decision as Voted, label: DECISION_LABEL[decision], icon: <Icon />, tone, count: countVoted(decision) }; }),
            { value: "none" as Voted, label: NO_VOTE.yet, icon: <Hourglass />, count: countVoted("none"), group: "No vote" },
            ...(countVoted("failed") ? [{ value: "failed" as Voted, label: NO_VOTE.failed, icon: <TriangleAlert />, tone: "destructive" as const, count: countVoted("failed"), group: "No vote" }] : []),
            ...(settles(who) ? [{ value: "settled" as Voted, label: "Settled the result", icon: <GitCompare />, tone: "info" as const, count: countVoted("settled"), group: "Decisions" }] : []),
          ]}
        />
      ) : null}
      {arrivals.length ? (
        <FilterMenu
          name="Added"
          value={added}
          onChange={(next) => go({ added: next === "all" ? null : next })}
          className={trigger}
          choices={[
            { value: "all", label: "Any time", icon: <Clock />, count: papers.length },
            { value: "start", label: "At the start", icon: <Play />, count: papers.filter((one) => one.batch === undefined).length },
            ...arrivals.map((time) => ({ value: String(time), label: ago(time), icon: <RefreshCw />, tone: "primary" as const, count: papers.filter((one) => one.batch === time).length, group: "After the start" })),
          ]}
        />
      ) : null}
    </>
  );
  const sorter = (trigger: string) => (
    <FilterMenu name="Order" lead={<ArrowUpDown className="size-3.5" />} value={sort} onChange={(next) => go({ sort: next === "added" ? null : next })} narrows={false} align="end" className={trigger} choices={SORTS.map((one) => { const Icon = SORT_ICON[one]; return { value: one, label: SORT_LABEL[one], icon: <Icon /> }; })} />
  );
  // Pills, as the tabs and the search box in the same bar are. A long value is cut sooner where the page is narrow, so more of the row is in view.
  const trigger = "h-8 w-auto max-w-48 gap-1.5 rounded-full px-3.5 text-xs @5xl/papers:max-w-72";

  // A column head that orders the table: pressed again, the other way round.
  const sortHead = (label: string, on: boolean, next: Sort | null, descending = false) => (
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
          name="Result"
          value={filter}
          onChange={(next) => go({ result: next === "all" ? null : next })}
          className="h-8 w-full rounded-full px-3.5 text-xs sm:hidden"
          choices={[{ value: "all" as typeof filter, label: "All", icon: <Layers />, count: narrowed.length }, ...RESULTS.map((result) => { const Icon = RESULT_ICON[result]; return { value: result as typeof filter, label: RESULT_LABEL[result], icon: <Icon />, tone: RESULT_STYLE[result].tone, count: tabCounts[result] }; })]}
        />
        <div className="max-sm:hidden">
          <Segmented
            label="Result"
            value={filter}
            onChange={(next) => go({ result: next === "all" ? null : next })}
            options={[
              { id: "all" as const, label: "All", detail: <span className="tabular-nums text-muted-foreground"><AnimatedNumber value={narrowed.length} /></span> },
              ...RESULTS.map((result) => ({ id: result, label: RESULT_LABEL[result], icon: RESULT_ICON[result], detail: <span className={cn("tabular-nums", tabCounts[result] ? TONE[RESULT_STYLE[result].tone].ink : "text-muted-foreground")}><AnimatedNumber value={tabCounts[result]} /></span> })),
            ]}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 max-sm:w-full">
          <div className="relative min-w-0 flex-1 @2xl/papers:max-w-md">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => void setPlace({ q: event.target.value || null, page: null }, { history: "replace" })} placeholder="Find by title, author or abstract" aria-label="Find a paper" className="h-8 rounded-full ps-8 text-sm" />
          </div>
          {/* Under a wide window the bar's Export is in its menu: here it is beside the list it exports. */}
          <Button variant="outline" size="sm" className="h-8 max-sm:hidden xl:hidden" onClick={() => onExport("papers")}><Download />Export</Button>
          <Button variant="outline" size="sm" className="h-8 @2xl/papers:hidden" onClick={() => setFiltering(true)}>
            <SlidersHorizontal />Filters
            {active.length ? <span className="rounded-full bg-primary/12 px-1.5 text-2xs tabular-nums text-primary">{active.length}</span> : null}
          </Button>
          <VoteMarksHelp blind={screening.rule.blind === "after"} className="@2xl/papers:hidden">Each paper shows one mark for each reviewer it was given to, in the order of the reviewers.</VoteMarksHelp>
        </div>
      </div>

      {/* Row two, on one line at every width: what the columns show, what narrows the list, and its order. Where the filters don't all fit, the run of them scrolls sideways under a fade, and the order keeps its place at the row's end. Taking every filter away is with the chips under this row. */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-4 sm:px-6 @max-2xl/papers:hidden">
        {criteria.length ? <div className="shrink-0"><Segmented label="Show columns" value={columns} onChange={(next) => void setPlace({ by: next === "reviewers" ? null : next })} options={[{ id: "reviewers", label: "Votes" }, { id: "criteria", label: "Answers" }]} /></div> : null}
        {/* Its margin and padding give the pills' focus rings room inside the box that cuts what runs past it. */}
        <FadeRow scrolls scrollbar="none" className="-m-1 flex flex-1 items-center gap-2 p-1 *:shrink-0">{filters(trigger)}</FadeRow>
        <div className="shrink-0">{sorter(trigger)}</div>
      </div>

      {/* A filter by how someone else voted can't count the votes hidden from the person looking: it says how many it leaves out, as the Overview and the files do. */}
      {keptBack ? <div className="px-4 pb-3 sm:px-6"><LeftOutNote votes={keptBack} papers={keptBack} of="this filter" /></div> : null}
      {/* What narrows the list, each a chip that takes it away, and one press that takes them all. On a phone this is where the filters show. */}
      {active.length ? (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 @max-2xl/papers:pt-3 sm:px-6">
          {active.map((one) => (
            <span key={one.key} className="contents">
              <Button variant="secondary" size="xs" className="h-6 max-w-full gap-1 rounded-md bg-primary/10 pe-1 text-xs font-medium text-primary hover:bg-primary/15" aria-label={`Remove the filter ${one.label}`} onClick={() => go(one.clear)}>
                <span className="flex min-w-0 items-center gap-1 truncate [&_.text-muted-foreground]:text-current [&_.text-muted-foreground]:opacity-70">{"shown" in one && one.shown ? one.shown : one.label}</span><X className="size-3.5 opacity-70" />
              </Button>
              {"fact" in one && one.fact ? <Chip>{one.fact}</Chip> : null}
            </span>
          ))}
          <Button variant="ghost" size="xs" className="h-6 text-xs" onClick={clearFilters}><X />Clear filters</Button>
        </div>
      ) : null}

      <Sheet open={filtering} onOpenChange={setFiltering}>
        <SheetContent side="bottom" className="gap-0 p-0 @2xl/papers:hidden">
          <SheetHeader className="border-b border-border-subtle px-4 py-3"><SheetTitle>Filters</SheetTitle><SheetDescription className="sr-only">What narrows the list of papers, and its order</SheetDescription></SheetHeader>
          <div className="grid gap-2 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] [&>[data-slot=select-trigger]]:w-full [&>[data-slot=select-trigger]]:max-w-none [&>[data-slot=select-trigger]]:justify-start [&>[data-slot=select-trigger]>svg:last-child]:ms-auto">
            {filters("h-10 text-sm")}
            {sorter("h-10 text-sm")}
            <Button variant="outline" className="mt-2" onClick={() => setFiltering(false)}>Show {plural(rows.length, "paper", "papers")}</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* What can be done with the selected papers. It floats over the foot of the window, so selecting a row moves no row. */}
      <AnimatePresence>
        {chosen.length ? (
          <motion.div key="chosen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2, ease: EASE }} className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4 max-lg:bottom-24">
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-border-subtle bg-card px-3 py-2 shadow-lg">
              <span className="px-1 text-sm font-medium tabular-nums">{everyRow ? `All ${num(chosen.length)} selected` : `${num(chosen.length)} selected`}</span>
              {allShown && !everyRow && rows.length > shown.length ? <Button variant="link" size="sm" className="h-7 px-1" onClick={() => setPicked([...new Set([...chosen, ...rows.map((one) => one.id)])])}>Select all {num(rows.length)}</Button> : null}
              {conflictsPicked.length && open.canResolve ? (
                <span className="flex items-center gap-1.5 border-s border-border-subtle ps-2">
                  <span className="text-xs text-muted-foreground">Settle {conflictsPicked.length} in conflict as</span>
                  {DECISIONS.map((decision) =>
                    decision === "exclude" ? (
                      <Popover key={decision}>
                        <PopoverTrigger asChild><VoteButton decision={decision} size="sm" /></PopoverTrigger>
                        <PopoverContent side="top" align="end" className="w-80 p-3">
                          <ReasonPicker criteria={open.screening.criteria} many={conflictsPicked.length > 1} onPick={(key, note) => settleAll("exclude", { reason: key, note })} />
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <VoteButton key={decision} decision={decision} size="sm" onClick={() => settleAll(decision)} />
                    ),
                  )}
                </span>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-7"><Download />Export</Button></DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end">
                  <DropdownMenuItem onSelect={() => exportPicked("ris")}>RIS file, for a reference manager</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => exportPicked("csv")}>{chosen.some((one) => { const paper = papers.find((p) => p.id === one); return paper && !open.canSee(paper); }) ? "CSV file, with the votes you can see" : "CSV file, with every vote"}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setPicked([])}>Clear selection</Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid border-t border-border-subtle">
        <div ref={list} className="@container/table min-w-0">
          {/* A full page's height while there are pages, so a short last page doesn't move the pager. The table scrolls sideways only where it can't fit, which would stop its head row sticking. */}
          <Wide fits={fits} style={{ minHeight: pager.pages > 1 ? (PAGE + 2) * ROW : undefined }}>
            {shown.length ? (
              <>
                <ul className="divide-y divide-border-subtle @2xl/papers:hidden">
                  {shown.map((one) => {
                    const visible = open.canSee(one);
                    return (
                      <li key={one.id} data-paper={one.id} className={cn("flex gap-3 px-4 py-3 transition-colors", opened === one.id && "bg-muted")}>
                        <Checkbox className="mt-0.5" checked={chosen.includes(one.id)} onCheckedChange={() => setPicked(chosen.includes(one.id) ? chosen.filter((p) => p !== one.id) : [...chosen, one.id])} aria-label={`Select ${one.title}`} />
                        <button type="button" aria-expanded={opened === one.id} onClick={() => (opened === one.id ? close() : show(one.id))} className="block min-w-0 flex-1 space-y-2 text-start outline-none focus-visible:underline">
                          <span className="line-clamp-2 text-sm font-medium">{one.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{one.authors.join(", ")}, {one.year}</span>
                          <span className="flex items-center gap-1">
                            {votes[one.id]!.map(({ reviewer: r, vote, failed }) => <VoteMark key={r.id} vote={vote} failed={failed} settled={Boolean(settled[one.id]!.final)} hidden={!visible && r.id !== open.me} who={r.id === open.me ? "You" : r.name} />)}
                            <ResultChip result={settled[one.id]!.result} className="ms-auto" />
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
                        <Checkbox checked={allShown} onCheckedChange={() => setPicked(allShown ? chosen.filter((p) => !shown.some((one) => one.id === p)) : [...new Set([...chosen, ...shown.map((one) => one.id)])])} aria-label="Select every paper on this page" />
                      </TableHead>
                      <TableHead rowSpan={2} aria-sort={sort === "title" ? "ascending" : sort === "title-desc" ? "descending" : "none"}>
                        {sortHead("Paper", sort === "title" || sort === "title-desc", sort === "title" ? "title-desc" : "title", sort === "title-desc")}
                      </TableHead>
                      <TableHead colSpan={columns === "criteria" ? criteria.length : reviewers.length} className="h-8 px-1 pt-2 text-center" style={{ width: `${columns === "criteria" ? criteria.length * 4.5 : reviewers.length * reviewerWidth}rem` }}>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          {columns === "criteria" ? "Answers" : "Votes"}
                          {columns === "criteria" ? (
                            <Help title="Answers" side="bottom">
                              <p>Each column is a criterion, and the mark is the answer its reviewers gave.</p>
                              <Legend>
                                <LegendRow mark={<AnswerMark answer="yes" label="Yes" />}>Yes, it meets it</LegendRow>
                                <LegendRow mark={<AnswerMark answer="no" label="No" />}>No, it doesn&apos;t</LegendRow>
                                <LegendRow mark={<AnswerMark answer="unclear" label="Unclear" />}>Unclear from the abstract</LegendRow>
                                <LegendRow mark={<DifferMark />}>Reviewers answered it differently</LegendRow>
                              </Legend>
                            </Help>
                          ) : (
                            <VoteMarksHelp blind={screening.rule.blind === "after"}>Each column is a reviewer. Press a face for the papers they voted on.</VoteMarksHelp>
                          )}
                        </span>
                      </TableHead>
                      <TableHead rowSpan={2} className={cn("w-52 ps-6", reasonHidden)}>
                        <span className="inline-flex items-center gap-1">
                          Reason
                          <Help title="Reason" side="bottom" facts={<><HelpFact>Points on included papers only</HelpFact><HelpFact>Points from the most common answer</HelpFact></>}>
                            <p>Why a paper stands where it does: the criterion that excluded it, the one a Maybe is unclear on, how a conflict split, or whose vote it waits for.</p>
                            <p>An included paper shows its points and stars. Each criterion earns the points set in the screening&apos;s settings, from the answer most reviewers gave, and the stars follow the point thresholds set there.</p>
                          </Help>
                        </span>
                      </TableHead>
                      <TableHead rowSpan={2} aria-sort={sort === "result" ? "ascending" : "none"} className={cn("text-end", lastCell, !fits && "sticky end-0 bg-card")}>
                        {sortHead("Result", sort === "result", sort === "result" ? null : "result")}
                      </TableHead>
                    </TableRow>
                    <TableRow className="border-b-0 hover:bg-transparent">
                      {columns === "reviewers"
                        ? reviewers.map((one) => (
                            <TableHead key={one.id} className="h-auto px-0 pb-2 text-center align-top">
                              <DropdownMenu>
                                <TooltipHint label={one.id === open.me ? "Your votes" : `Votes by ${one.name}`}>
                                  <DropdownMenuTrigger asChild>
                                    <button type="button" aria-label={one.id === open.me ? "Your votes" : `Votes by ${one.name}`} className="mx-auto flex w-full flex-col items-center gap-1 rounded-md py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted">
                                      <ReviewerMark reviewer={one} you={one.id === open.me} />
                                      {/* Each head opens a menu of that reviewer's votes, and says so with the arrow a menu has. */}
                                      <span className="flex max-w-full items-center gap-0.5 px-0.5 text-2xs font-normal text-muted-foreground"><span className="truncate">{/* The column is narrow: a first word under the face, with the whole name in its menu and its tooltip. */}{one.id === open.me ? "You" : firstName(one.name)}</span><ChevronDown aria-hidden className="size-3 shrink-0 opacity-70" /></span>
                                    </button>
                                  </DropdownMenuTrigger>
                                </TooltipHint>
                                <DropdownMenuContent align="center" className="w-auto min-w-60 [&_[role=menuitem]]:whitespace-nowrap">
                                  <DropdownMenuLabel><ReviewerName reviewer={one} you={one.id === open.me} /></DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  {DECISIONS.map((decision) => {
                                    const Icon = RESULT_STYLE[decision].icon;
                                    return (
                                      <DropdownMenuItem key={decision} asChild>
                                        <NextLink href={papersHref(id, { reviewer: one.id, voted: decision })}><Icon />Papers {one.id === open.me ? "you" : shortName(one)} voted {DECISION_LABEL[decision]}</NextLink>
                                      </DropdownMenuItem>
                                    );
                                  })}
                                  <DropdownMenuItem asChild><NextLink href={papersHref(id, { reviewer: one.id, voted: "none" })}><ListChecks />Papers waiting for {one.id === open.me ? "your" : `${shortName(one)}'s`} vote</NextLink></DropdownMenuItem>
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
                      const visible = open.canSee(one);
                      const cast = votes[one.id]!;
                      const state = settled[one.id]!;
                      const waitsForMe = open.isReviewer && !state.final && cast.some((entry) => entry.reviewer.id === open.me && !entry.vote && !entry.failed);
                      return (
                        <TableRow key={one.id} data-paper={one.id} data-state={opened === one.id ? "selected" : undefined} className="cursor-pointer border-border-subtle" style={{ height: ROW }} onClick={() => (opened === one.id ? close() : show(one.id))}>
                          <TableCell className="ps-4 sm:ps-6" onClick={(event) => event.stopPropagation()}>
                            <Checkbox checked={chosen.includes(one.id)} onCheckedChange={() => setPicked(chosen.includes(one.id) ? chosen.filter((p) => p !== one.id) : [...chosen, one.id])} aria-label={`Select ${one.title}`} />
                          </TableCell>
                          <TableCell className="py-2 whitespace-normal">
                            <button type="button" aria-expanded={opened === one.id} className="block w-full min-w-0 text-start outline-none focus-visible:underline">
                              <span className="line-clamp-2 text-sm font-medium leading-5">
                                {one.title}
                                {one.batch !== undefined && one.batch === newest ? <StateChip tone="primary" className="ms-2 h-5 align-[1px] px-1.5 text-2xs">New</StateChip> : null}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">{one.authors.join(", ")}, {one.year}, {one.venue}</span>
                            </button>
                          </TableCell>
                          {columns === "reviewers"
                            ? reviewers.map((r) => {
                                const theirs = cast.find((entry) => entry.reviewer.id === r.id);
                                return <TableCell key={r.id} className="px-0 text-center">{theirs ? <VoteMark vote={theirs.vote} failed={theirs.failed} settled={Boolean(state.final)} hidden={!visible && r.id !== open.me} who={r.id === open.me ? "You" : r.name} className="align-middle" /> : null}</TableCell>;
                              })
                            : criteria.map((criterion) => {
                                const given = visible ? [...new Set(cast.flatMap((entry) => entry.vote?.answers[criterion.key] ?? []))] : [];
                                return (
                                  <TableCell key={criterion.key} className="px-1 text-center">
                                    {given.length === 1 ? <span className="inline-flex align-middle"><AnswerMark answer={given[0]!} label={criterion.short} /></span> : given.length > 1 ? <DifferMark label={`Reviewers differ on ${criterion.short}`} /> : null}
                                  </TableCell>
                                );
                              })}
                          <TableCell className={cn("ps-6", reasonHidden)} onClick={(event) => (event.target as HTMLElement).closest("a") && event.stopPropagation()}>
                            <Why paper={one} open={open} visible={visible} reasonKey={reasonKey(one)} />
                          </TableCell>
                          <TableCell className={cn("text-end", lastCell, !fits && "sticky end-0 bg-card")} onClick={(event) => (event.target as HTMLElement).closest("a") && event.stopPropagation()}>
                            <span className="inline-flex items-center gap-1.5">
                              {/* A result a person settled, against the votes, carries their face: it opens what they settled. */}
                              {state.resolvedBy ? (
                                <TooltipHint label={`Settled by ${whoIs(open.screening, state.resolvedBy, open.me)}`}>
                                  <NextLink href={narrow({ reviewer: state.resolvedBy, voted: "settled" }).href} aria-current={narrow({ reviewer: state.resolvedBy, voted: "settled" })["aria-current"]} aria-label={`Settled by ${whoIs(open.screening, state.resolvedBy, open.me)}`} className="flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                                    <IdentityAvatar name={nameOn(open.screening, state.resolvedBy)} imageUrl={personOf(state.resolvedBy)?.imageUrl} className="size-5" />
                                  </NextLink>
                                </TooltipHint>
                              ) : null}
                              {waitsForMe ? (
                                <Button asChild size="xs" className="h-6"><NextLink href={screenHref(id, { paper: one.id })}>Vote<ChevronRight /></NextLink></Button>
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
              <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
                {anyFilter ? (
                  <>
                    <p className="text-sm text-muted-foreground">No paper here matches.</p>
                    <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">{emptyResult(filter, Boolean(screening.finishedAt))}</p>
                    {/* Nothing has got this far, and the papers that could are still short of a vote or split: each count opens them. */}
                    {filter === "include" || filter === "maybe" || filter === "exclude" ? (
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {(["waiting", "conflict"] as const).map((result) => (tabCounts[result] ? <LinkChip key={result} href={papersHref(id, { result })} tone={RESULT_STYLE[result].tone} icon={RESULT_STYLE[result].icon}>{num(tabCounts[result])} {RESULT_LABEL[result].toLowerCase()}</LinkChip> : null))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </Wide>
          {pager.pages > 1 ? <CommandCenterPagination className="border-t border-border-subtle p-4 sm:px-6" currentPage={pager.page} totalPages={pager.pages} onPageChange={(next) => { pager.setPage(next); top.current?.scrollIntoView({ block: "start" }); }} totalItems={pager.total} itemsPerPage={PAGE} itemLabel="papers" /> : null}
        </div>

      </div>
      {/* The paper opens in a drawer at the window's side, from its top to its foot, and scrolls there on its own: the place a record's details open in most products with a table. It never sits in the page, under the filters, where how much of it shows would depend on how far the page is scrolled. */}
      <Sheet open={Boolean(paper)} onOpenChange={(next) => !next && close()}>
        {/* It opens with the focus on itself, so no button's tooltip covers the paper's title. */}
        <SheetContent data-paper-drawer showCloseButton={false} onOpenAutoFocus={focusContent} className={`w-full gap-0 p-0 outline-none sm:max-w-lg xl:max-w-xl ${AVATARS_FADE_IN}`}>
          <SheetTitle className="sr-only">{paper?.title ?? "Paper"}</SheetTitle>
          <SheetDescription className="sr-only">Its abstract, its votes and its result</SheetDescription>
          {/* Each paper has its own scroll, so the next one starts at its title and not where the last was left. */}
          {paper ? <ScrollArea key={paper.id} shades className="min-h-0 flex-1"><PaperPanel paper={paper} open={open} onClose={close} place={{ at, of: rows.length }} onStep={step} /></ScrollArea> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The mark for a criterion its reviewers answered differently: the sign and colour of a conflict. */
function DifferMark({ label = "Reviewers answered it differently" }: { label?: string }) {
  return (
    <span role="img" aria-label={label} className={cn("inline-flex size-6 items-center justify-center rounded-md align-middle", RESULT_STYLE.conflict.chip)}>
      <GitCompare aria-hidden className="size-3.5" />
    </span>
  );
}

function Legend({ children }: { children: ReactNode }) {
  return <div className="space-y-1.5 pt-1 text-foreground">{children}</div>;
}
function LegendRow({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return <p className="flex items-center gap-2.5">{mark}{children}</p>;
}

/** What each vote mark means, over the table's columns and beside a phone's search. `children` says where the marks are. */
function VoteMarksHelp({ blind, children, className }: { /** The screening hides the others' votes until you vote. */ blind: boolean; children: ReactNode; className?: string }) {
  return (
    <Help title="Vote marks" side="bottom" className={className}>
      <p>{children}</p>
      {blind ? <p>{VOTES_HIDDEN_SAYS}</p> : null}
      <Legend>
        {DECISIONS.map((decision) => <LegendRow key={decision} mark={<VoteMark vote={{ decision }} who="A reviewer" />}>Voted {DECISION_LABEL[decision]}</LegendRow>)}
        {blind ? <LegendRow mark={<VoteMark vote={{ decision: "include" }} hidden who="A reviewer" />}>Voted, hidden while the paper waits for the reviewer&apos;s own vote</LegendRow> : null}
        <LegendRow mark={<VoteMark who="A reviewer" />}>{NO_VOTE_SAYS.yet}</LegendRow>
        <LegendRow mark={<VoteMark settled who="A reviewer" />}>{NO_VOTE_SAYS.none}</LegendRow>
        <LegendRow mark={<VoteMark failed who="A model" />}>{NO_VOTE_SAYS.failed}</LegendRow>
        <LegendRow mark={<span className="size-6" />}>An empty cell is a paper that isn&apos;t theirs to vote on</LegendRow>
      </Legend>
    </Help>
  );
}

/** A link inside a row, which opens what it names rather than the row's paper. */
/** The table's frame. It scrolls sideways only where the table can't fit: a frame that scrolls would stop the head row sticking to the page. */
function Wide({ fits, style, children }: { fits: boolean; style: CSSProperties; children: ReactNode }) {
  return fits ? <div style={style}>{children}</div> : <ScrollArea axis="x" shades style={style}>{children}</ScrollArea>;
}

const ROW_LINK = "rounded-sm outline-none decoration-muted-foreground/50 underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50";

/** What put a paper where it stands: the criterion it failed, how its reviewers split, or whose vote it waits for. Each opens the papers it names. */
function Why({ paper, open, visible, reasonKey }: { paper: Paper; open: Open; visible: boolean; reasonKey?: string }) {
  const id = open.screening.id;
  const narrow = useNarrow(id, open.me);
  const state = open.settled[paper.id]!;
  const entries = open.votes[paper.id]!;
  const cast = entries.flatMap((one) => one.vote ?? []);
  if (state.result === "waiting") {
    const missing = entries.filter((one) => !one.vote && !one.failed).map((one) => one.reviewer).sort((a, b) => Number(b.id === open.me) - Number(a.id === open.me));
    if (!missing.length) return <span className="text-xs text-muted-foreground">No reviewer can vote on it yet</span>;
    const mine = missing[0]!.id === open.me;
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn("shrink-0", mine && "font-medium text-primary")}>{mine ? "Waiting on you" : "Waiting on"}</span>
        <span className="flex items-center">
          {missing.slice(0, 5).map((one, i) => {
            const link = narrow({ reviewer: one.id, voted: "none" });
            const says = `${link.on ? "Stop showing only the papers" : "Papers"} waiting for ${one.id === open.me ? "your vote" : `${one.name}'s vote`}`;
            return (
            <TooltipHint key={one.id} label={says}>
              <NextLink href={link.href} aria-current={link["aria-current"]} aria-label={says} className={cn("flex outline-none ring-2 ring-card transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:ring-ring/50", link.on && "z-10 ring-foreground", one.kind === "model" ? "rounded-md" : "rounded-full", i > 0 && "-ms-1.5")}>
                <ReviewerMark reviewer={one} you={one.id === open.me} />
              </NextLink>
            </TooltipHint>
            );
          })}
          {missing.length > 5 ? <span className="ms-1.5 tabular-nums">+{missing.length - 5}</span> : null}
        </span>
      </span>
    );
  }
  // What whoever settled it wrote down, beside the votes they settled: the reason a settled paper has.
  const settledNote = state.resolvedBy && state.note ? <TooltipHint label={state.note} onlyWhenClipped><span className="min-w-0 truncate text-xs text-muted-foreground">{inQuotes(state.note)}</span></TooltipHint> : null;
  if (!visible) return settledNote;
  if (state.result === "conflict" || state.resolvedBy) return <span className="flex min-w-0 items-center gap-2"><Tally votes={cast} className="shrink-0" />{settledNote}</span>;
  if (reasonKey && (state.result === "exclude" || state.result === "maybe")) {
    const label = state.result === "exclude" ? failedLabel(reasonKey, open.screening.criteria) : unclearLabel(reasonKey, open.screening.criteria);
    // Pressed again while the table is narrowed to this reason, it takes the reason away and keeps the result.
    const link = narrow({ result: state.result, reason: reasonKey }, ["reason"]);
    return (
      <QuestionHint question={questionOf(reasonKey, open.screening.criteria)} label={label}>
        <NextLink href={link.href} aria-current={link["aria-current"]} className={cn("block truncate text-xs", link.on ? "font-medium text-foreground" : "text-muted-foreground", ROW_LINK)}><Reason reason={reasonKey} criteria={open.screening.criteria} unclear={state.result === "maybe"} /></NextLink>
      </QuestionHint>
    );
  }
  // An included paper carries the stars its answers earn, as it is saved with them.
  const score = state.result === "include" && open.screening.criteria.length ? scoreOf(open.screening, entries) : null;
  return score ? <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground"><Stars count={score.stars} />{score.points} of {score.of} points</span> : null;
}

/** The reasons a paper is excluded for, with a note. "Another reason" needs the note written. */
/** The drawer's own scroll is the outside system: a step that opens low in it is brought into view once, as it is first drawn. Kept outside the panel so it is the same function on every draw: one made anew each draw would be called again whenever a model reads on, and pull the drawer back. */
const intoView = (part: HTMLElement | null) => part?.scrollIntoView({ block: "nearest", behavior: "smooth" });

function ReasonPicker({ criteria, many = false, note: given, onNote, onPick, onBack }: { criteria: Criterion[]; /** The reason is for several papers picked together. */ many?: boolean; /** The note the step before already holds: it is shown here as it was written, and never looks lost. Left out, the picker keeps its own. */ note?: string; onNote?: (note: string) => void; onPick: (reason: string, note?: string) => void; onBack?: () => void }) {
  const [own, setOwn] = useState("");
  const [missing, setMissing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const note = given ?? own;
  const setNote = onNote ?? setOwn;
  return (
    <div className="space-y-2">
      <Input ref={field} value={note} onChange={(event) => { setNote(event.target.value); setMissing(false); }} placeholder="Note, needed for another reason" aria-label="Note" aria-invalid={missing || undefined} aria-describedby={missing ? "reason-note-error" : undefined} className="h-8 bg-card text-sm" />
      {missing ? <p id="reason-note-error" className="text-xs ink-destructive">Write the reason in the note</p> : null}
      <ReasonRows
        criteria={criteria}
        many={many}
        onPick={(reason) => {
          // A reason no criterion covers is the note itself.
          if (reason === "other" && !note.trim()) {
            setMissing(true);
            field.current?.focus();
            return;
          }
          onPick(reason, note.trim() || undefined);
        }}
      />
      {onBack ? <Button variant="ghost" size="sm" className="w-full" onClick={onBack}>Back</Button> : null}
    </div>
  );
}

/** One paper beside the table: what it says, who voted what on each criterion and when, your own vote where it is yours to give, and the final decision when they disagree. */
function PaperPanel({ paper, open, onClose, onStep, place }: { paper: Paper; open: Open; onClose: () => void; onStep: (by: 1 | -1) => void; place: { at: number; of: number } }) {
  const { screening, settled, votes } = open;
  const id = screening.id;
  const narrow = useNarrow(id, open.me);
  const [shown, setShown] = useState<{ reviewer: string; criterion: string } | null>(null);
  // What is being decided in the panel: your own vote, or the paper's result. Excluding asks for the reason first.
  const [deciding, setDeciding] = useState<"vote" | "result" | null>(null);
  const [reasonFor, setReasonFor] = useState<"vote" | "result" | null>(null);
  const [note, setNote] = useState("");
  const state = settled[paper.id]!;
  const visible = open.canSee(paper);
  const cast = youFirst(votes[paper.id]!, open.me);
  const mine = open.myVote(paper);
  const isMine = cast.some((one) => one.reviewer.id === open.me);
  const quotedCriterion = shown && visible ? screening.criteria.find((c) => c.key === shown.criterion) : undefined;
  const quoted = quotedCriterion ? passageAt(paper, quotedCriterion, screening.criteria) : -1;
  const quoting = shown ? cast.find((one) => one.reviewer.id === shown.reviewer) : undefined;
  const source = screening.sources.find((one) => one.id === paper.source);
  // The paper's two chips that narrow the table: each shows when it does, and takes it away on a second press.
  const added = paper.batch !== undefined ? narrow({ added: String(paper.batch) }) : null;
  const from = source ? narrow({ source: source.id }) : null;
  const failed = cast.filter((one) => one.failed);
  const score = state.result === "include" && visible && screening.criteria.length ? scoreOf(screening, cast) : null;
  // The reviewers the paper still waits for: who an override settles it without.
  const awaited = cast.filter((one) => !one.vote && !one.failed).map((one) => one.reviewer);
  const settle = (kind: "vote" | "result", decision: Decision, reason?: string, withNote?: string) => {
    const said = withNote ?? (note.trim() || undefined);
    if (kind === "vote") open.vote(paper, { decision, answers: { ...mine?.answers }, reason, note: said, at: Date.now() });
    else open.resolve(paper, decision, said, reason);
    setDeciding(null);
    setReasonFor(null);
    setNote("");
  };
  const buttons = (kind: "vote" | "result") =>
    reasonFor === kind ? (
      <div ref={intoView}><ReasonPicker criteria={screening.criteria} note={note} onNote={setNote} onPick={(reason, withNote) => settle(kind, "exclude", reason, withNote)} onBack={() => setReasonFor(null)} /></div>
    ) : (
      <div className="space-y-2">
        <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={kind === "vote" ? "Note for the others (optional)" : "Note for the record (optional)"} aria-label="Note" className="h-8 bg-card text-sm" />
        <div className="grid grid-cols-3 gap-2">
          {DECISIONS.map((decision) => <VoteButton key={decision} decision={decision} on={kind === "vote" && mine?.decision === decision} className={kind === "vote" && mine?.decision === decision ? undefined : "bg-card"} onClick={() => (decision === "exclude" ? setReasonFor(kind) : settle(kind, decision))} />)}
        </div>
      </div>
    );

  return (
    <div className="space-y-5 px-4 pb-6 sm:px-6">
      {/* Where it is in the list, and the way through it: it stays in view while the paper is read. */}
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-1 border-b border-border-subtle bg-card px-4 py-2.5 sm:-mx-6 sm:px-6">
        <span className="me-auto text-xs tabular-nums text-muted-foreground">{place.at >= 0 ? `${num(place.at + 1)} of ${num(place.of)}` : "Not in this list"}</span>
        <PaperStepper onStep={onStep} canPrevious={place.at > 0} canNext={place.at >= 0 && place.at < place.of - 1} />
        <TooltipHint label={<span className="flex items-center gap-2">Close<Kbd className="pointer-coarse:hidden">Esc</Kbd></span>}><Button variant="ghost" size="icon" className="-me-2 size-7 text-muted-foreground" aria-label="Close" aria-keyshortcuts="Escape" onClick={onClose}><X /></Button></TooltipHint>
      </div>
      <div className="space-y-2">
        <h2 className="text-base font-semibold leading-snug">{paper.title}</h2>
        <p className="text-sm text-muted-foreground">{paper.authors.join(", ")}. <span className="italic">{paper.venue}</span>, {paper.year}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ResultChip result={state.result} />
        {score ? <Chip><Stars count={score.stars} />{score.points} of {score.of} points</Chip> : null}
        <PaperFacts paper={paper} source={from && source ? { name: source.name, kind: source.kind, href: from.href, on: from.on, current: from["aria-current"] } : undefined} added={added ? { at: paper.batch!, href: added.href, on: added.on, current: added["aria-current"] } : undefined} />
      </div>
      <p className="text-sm leading-6">{paper.sentences.map((sentence, i) => <span key={i} className={cn("rounded-sm box-decoration-clone transition-colors duration-300", quoted === i && "bg-warning/20")}>{sentence} </span>)}</p>

      {/* Your own vote, where the paper is yours to vote on. While it waits for you, it is the one thing here that needs you. */}
      {isMine && open.isReviewer ? (
        mine && deciding !== "vote" ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Your vote</h3>
            <div className="flex items-center gap-2 text-sm">
              <VoteMark vote={mine} who="You" />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">You voted {DECISION_LABEL[mine.decision]}{mine.reason ? <ReasonChip reason={mine.reason} criteria={screening.criteria} className="min-w-0 shrink" /> : null}</span>
              <Button variant="ghost" size="xs" onClick={() => setDeciding("vote")}>Change it</Button>
            </div>
          </section>
        ) : (
          <Panel tone="primary" className="space-y-2 p-3 ring-1 ring-primary/20">
            <h3 className="text-sm font-medium">{mine ? "Change your vote" : state.final ? "Settled without your vote" : "Waiting for your vote"}</h3>
            {buttons("vote")}
          </Panel>
        )
      ) : null}

      {/* A conflict that is the person looking's to settle stands here, over the votes it settles: it is what the paper needs from them, and under the votes and the discussion it was a screen away. */}
      {!state.resolvedBy && open.canResolve && state.result === "conflict" ? (
        <Panel tone="info" className="space-y-2 p-3 ring-1 ring-info/25">
          <h3 className="text-sm font-medium">Settle this conflict</h3>
          {buttons("result")}
        </Panel>
      ) : null}

      {/* While the rule hides the others' votes, the table is the one Screen draws: a lock where a vote is cast, the rule's chip beside the title and its reason under the table. */}
      <Section title="Everyone's votes" help={<VotesHelp blind={screening.rule.blind === "after"} side="left" />} aside={visible ? undefined : <ShutChip by="vote" />}>
          <ScrollArea axis="x" shades className="rounded-2xl border border-border-subtle"><div className="p-3"><Matrix criteria={screening.criteria} cast={cast} me={open.me} hidden={!visible} settled={Boolean(state.final)} shown={shown} onShow={setShown} passage={visible && quoting?.vote && shown ? (quoting.reviewer.kind === "model" ? <Evidence paper={paper} reviewer={quoting.reviewer} criterion={screening.criteria.find((c) => c.key === shown.criterion)!} criteria={screening.criteria} answer={quoting.vote.answers[shown.criterion]} /> : <Said reviewer={quoting.reviewer} vote={quoting.vote} criterion={screening.criteria.find((c) => c.key === shown.criterion)!} criteria={screening.criteria} you={quoting.reviewer.id === open.me} />) : undefined} /></div></ScrollArea>
        {visible ? null : <ShutNote by="vote">{VOTES_SHUT}</ShutNote>}
        {visible ? (
          <ul className="space-y-2 pt-1">
            {failed.map(({ reviewer }) => {
              const unread = open.unread(reviewer).length;
              const retry = open.retryOf(reviewer);
              return (
                // On a phone the button goes under the name, so the name is never cut short.
                <li key={reviewer.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-xs sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                  <ReviewerMark reviewer={reviewer} className="size-5" />
                  <span className="flex min-w-0 items-center gap-1"><ReviewerName reviewer={reviewer} className="font-medium" /><span className="shrink-0 text-muted-foreground">couldn&apos;t read it</span></span>
                  {open.canChange ? <RetryRead papers={unread} cost={credits(retry.cost)} short={retry.short ? credits(retry.short) : undefined} onRetry={() => open.retry(reviewer)} className="justify-self-start max-sm:col-start-2" /> : null}
                </li>
              );
            })}
            {cast.filter((one) => one.vote).map(({ reviewer, vote }) => (
              <li key={reviewer.id} className="flex items-start gap-2 text-xs">
                <ReviewerMark reviewer={reviewer} className="size-5" />
                <span className="min-w-0 flex-1">
                  <ReviewerName reviewer={reviewer} you={reviewer.id === open.me} className="inline-flex max-w-full align-middle font-medium" /> <span className="text-muted-foreground">voted {DECISION_LABEL[vote!.decision]} {ago(vote!.at)}</span>{vote!.reason ? <> <ReasonChip reason={vote!.reason} criteria={screening.criteria} className="max-w-full min-w-0 shrink align-middle" /></> : null}
                  {vote!.note ? <span className="block text-muted-foreground">{inQuotes(vote!.note)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {/* What its reviewers said to each other, where its votes show and there is something to talk over. Where a rule keeps it shut, the rule stands in its place. */}
      {visible ? <Discussion open={open} paper={paper} /> : <DiscussionShut open={open} />}

      {/* The paper's result: settled by a person where its reviewers disagree, and open to change after that. */}
      {state.resolvedBy ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IdentityAvatar name={nameOn(open.screening, state.resolvedBy)} imageUrl={personOf(state.resolvedBy)?.imageUrl} className="size-5" />
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">Settled by {whoIs(screening, state.resolvedBy, open.me)}{state.reason ? <ReasonChip reason={state.reason} criteria={screening.criteria} className="min-w-0 shrink" /> : null}{state.note ? <span className="text-muted-foreground">{inQuotes(state.note)}</span> : null}</span>
          {open.canResolve ? <Button variant="ghost" size="xs" onClick={() => open.resolve(paper, null)}><Undo2 />Reopen</Button> : null}
        </div>
      ) : !open.canResolve ? (
        state.result === "conflict" ? (
          <Panel tone="info" className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <IdentityAvatar name={nameOn(open.screening, screening.rule.resolver)} imageUrl={personOf(screening.rule.resolver)?.imageUrl} className="size-6" />
            <span className="min-w-0 flex-1">Waiting for {whoIs(screening, screening.rule.resolver, open.me)} to settle it</span>
            <LinkChip href={papersHref(id, { result: "conflict" })} tone="info">Every conflict</LinkChip>
          </Panel>
        ) : null
      ) : state.result === "conflict" ? null : deciding === "result" ? (
        // Opened from a button at the foot of the drawer, it is brought into view: its three buttons would otherwise open under the fold.
        <section ref={intoView} className="space-y-2">
          <h3 className="flex items-center gap-1 text-sm font-medium">
            Override result
            <Help title="Overriding a result" side="left" facts={<><HelpFact>Votes kept</HelpFact><HelpFact icon={Undo2}>Can be reopened</HelpFact></>}>
              <p>Your decision replaces the result the votes gave. The votes stay on record. Reopen takes your decision away, and the votes decide the result again.</p>
            </Help>
          </h3>
          {/* Settling it now ends the wait for whoever has yet to vote: said before it is done (it was only seen afterwards, as their column going). */}
          {awaited.length ? <Note icon={Hourglass}>{listed(awaited.map((one) => (one.id === open.me ? "You" : one.name)))} {awaited.length === 1 && awaited[0]!.id !== open.me ? "has" : "have"} yet to vote. Your decision settles the paper without {awaited.length === 1 ? "that vote" : "those votes"}, and takes it off {awaited.every((one) => one.id === open.me) ? "your list" : awaited.some((one) => one.id === open.me) ? "your lists" : awaited.length === 1 ? "their list" : "their lists"}.</Note> : null}
          {buttons("result")}
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setDeciding(null)}>Cancel</Button>
        </section>
      ) : visible ? (
        <Button variant="outline" size="sm" onClick={() => setDeciding("result")}>Override result</Button>
      ) : (
        // The result is hidden with the votes until the person looking has voted, so it can't be overridden yet. The button stays, shut, with what opens it.
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled>Override result</Button>
          <ShutChip by="vote">After you vote</ShutChip>
        </div>
      )}
    </div>
  );
}
