"use client";

// The open screening's Overview, one column that scrolls with the window: how far it has got and what
// to do next, who has voted how and how far they agree, the facts about it, and the counts a methods
// section asks for.

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import NextLink from "next/link";
import { parseAsStringLiteral, useQueryStates } from "nuqs";
import { AiIcon, ArrowDown, ArrowRight, Ban, ChevronDown, CircleCheck, CirclePause, Clock, Coins, Download, FileSearch, Folder, GitCompare, Hourglass, ListChecks, Mail, MoreHorizontal, Move, RefreshCw, RotateCcw, Trash2 } from "@/components/icons";
import { AnimatedNumber, Chip, Meter } from "@/components/screening/parts";
import { EASE } from "@/components/settings/model-map";
import { LIST } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpFact } from "@/components/ui/help";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { num, plural, excludedBy, foundTotal, paperTotal, readersOf, firstName, DECISIONS, DECISION_LABEL, EVERY_LABEL, NOW, RESULTS, RESULT_LABEL, SCHEDULE, activeReviewers, ago, agreement, count, day, failedLabel, growing, keptOf, HOME, lookOf, modelsOf, personOf, questionOf, taken, workspaceOf, type Reviewer, type Screening } from "./data";
import type { ExportTab } from "./dialogs";
import { COLLECTIONS, COMMUNITY_COLLECTIONS } from "./form-data";
import { EffectList, effectItems, effectLines, effectMoves, lineText, movesText } from "./effects";
import { papersHref, screenHref, settingsHref } from "./links";
import { DIVIDED_ROW, FilterMenu, Help, LinkChip, Panel, QuestionHint, RESULT_ICON, RESULT_STYLE, Reason, ResultBar, ReviewerMark, ReviewerName, Section, type Tone } from "./parts";
import { credits, paperCredits, useMock, type Open } from "./store";
import { ConfirmChange } from "./team";
import { useWorkspace } from "./workspace";

/** What the Overview shows, kept in its address: the order of the reviewers, and every check for new papers or the last few. */
const PLACE = {
  sort: parseAsStringLiteral(["voted", "agrees"] as const),
  checks: parseAsStringLiteral(["all"] as const),
};

/** Papers still to be voted on, hatched wherever a bar shows them, so they never read as excluded ones. */
const HATCH = "bg-foreground/10 bg-[repeating-linear-gradient(-45deg,transparent_0_3px,color-mix(in_oklab,var(--foreground)_14%,transparent)_3px_5px)]";
/** A row or a count that opens its papers. */
const ROW_LINK = "rounded-lg outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50";

/** The Overview as a page of the open screening. */
export function OverviewPage() {
  const { open, exportTo } = useWorkspace();
  return <Overview open={open} onExport={exportTo} />;
}

function Overview({ open, onExport }: { open: Open; onExport: (tab: ExportTab) => void }) {
  const { screening, papers } = open;

  if (!papers.length && open.gathering) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
        <p className="text-sm font-medium">Its papers are on their way</p>
        <p className="max-w-md text-sm text-muted-foreground">They show here as they arrive from its sources. You can start screening as soon as the first are in.</p>
      </div>
    );
  }
  if (!papers.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
        <p className="text-sm font-medium">No papers yet</p>
        <p className="max-w-md text-sm text-muted-foreground">This screening has no source to take papers from.</p>
        {open.canChange ? <Button asChild variant="outline" size="sm" className="mt-2"><NextLink href={settingsHref(screening.id, "papers")}>Add a source</NextLink></Button> : null}
      </div>
    );
  }

  return (
    <div className="@container/overview space-y-8 p-4 sm:p-6">
      <Progress open={open} onExport={onExport} />
      {/* Everything here is the page's own content and scrolls with it: nothing is a sidebar. Two rows of two, each smaller block beside the one it goes with: who started it, where its papers go and what its models cost beside the reviewers, and the checks that bring papers in beside how far the reviewers agree. */}
      <div className="grid grid-cols-1 items-start gap-8 @5xl/overview:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0"><Reviewers open={open} /></div>
        <div className="min-w-0"><Facts open={open} /></div>
        <div className="min-w-0"><Agreement open={open} /></div>
        <div className="min-w-0"><Checks open={open} /></div>
      </div>
      <Flow open={open} onExport={onExport} />
    </div>
  );
}

// ── Progress ─────────────────────────────────────────────────────────────────────────────────────

/** How far the screening has got, in the colour of what it needs: the person looking, nobody, or someone else. */
function Progress({ open, onExport }: { open: Open; onExport: (tab: ExportTab) => void }) {
  const { finish } = useWorkspace();
  const { screening, papers, counts, toDo, conflicts } = open;
  const settledAll = counts.conflict + counts.waiting === 0;
  const settle = conflicts.length > 0 && open.canResolve;
  const tone: Tone = toDo.length || settle ? "primary" : settledAll ? "success" : "neutral";
  const finishable = settledAll && open.canChange && !open.screening.finishedAt;
  const resolver = personOf(screening.rule.resolver)?.name ?? "the person who settles them";
  const to = screening.destination;
  const extract = `/extraction/new?${to.collection ? `collection=${to.collection}` : `screening=${screening.id}`}`;
  const finished = Boolean(screening.finishedAt);

  const screen = toDo.length ? (
    <Button asChild size="sm" variant={finished ? "outline" : "default"}><NextLink href={screenHref(screening.id)}><ListChecks />Screen <AnimatedNumber value={toDo.length} /> {toDo.length === 1 ? "paper" : "papers"}</NextLink></Button>
  ) : null;
  const conflictsButton = conflicts.length ? (
    <Button asChild size="sm" variant={toDo.length || finished || !open.canResolve ? "outline" : "default"}><NextLink href={screenHref(screening.id, { queue: "conflicts" })}><GitCompare />{open.canResolve ? "Settle" : "See"} <AnimatedNumber value={conflicts.length} /> {conflicts.length === 1 ? "conflict" : "conflicts"}</NextLink></Button>
  ) : null;

  return (
    <Panel tone={tone} className="space-y-4 p-5">
      <Section
        title="Progress"
        help={
          <Help
            title="Where a paper stands"
            facts={RESULTS.map((result) => {
              const Icon = RESULT_STYLE[result].icon;
              const text = result === "maybe" ? "Maybe when a must-have can't be answered" : result === "conflict" ? `In conflict until ${resolver} settles it` : RESULT_LABEL[result];
              return <HelpFact key={result} icon={Icon}>{text}</HelpFact>;
            })}
          >
            <p>A paper settles once its votes meet the screening&apos;s rule. Maybe counts as settled: the reviewers agree the abstract can&apos;t decide it.</p>
            <p>A Maybe is not saved with the included papers. It stays under Maybe on the Papers page, and a reviewer who changes their vote settles it again.</p>
          </Help>
        }
        aside={
          <>
            {screen}
            {conflictsButton}
            {settledAll ? (
              <>
                <Button variant="outline" size="sm" onClick={() => onExport("papers")}><Download />Export included papers</Button>
                {/* With every paper settled, finishing is the next step for a member. Once it is finished, extracting is. */}
                <Button asChild size="sm" variant={finishable ? "outline" : "default"}><NextLink href={extract}><FileSearch />Extract from the included papers</NextLink></Button>
                {finishable ? <Button size="sm" onClick={finish}><CircleCheck />Mark as finished</Button> : null}
              </>
            ) : null}
          </>
        }
      >
        <div className="space-y-3">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-3xl font-semibold tabular-nums tracking-tight"><AnimatedNumber value={papers.length - counts.conflict - counts.waiting} /></span>
            <span className="text-sm text-muted-foreground">of {papers.length.toLocaleString("en-GB")} papers settled</span>
            {open.reading.length && !screening.paused && !open.outOfCredits && !finished ? <Chip className="self-center bg-card/70"><AiIcon working className="size-3.5" />Models are reading</Chip> : null}
          </p>
          <ResultBar counts={counts} className="h-3" />
          <div className="-mx-2 flex flex-wrap gap-x-1 gap-y-1">
            {RESULTS.map((result) => {
              const Icon = RESULT_STYLE[result].icon;
              const inner = (
                <>
                  <span className={cn("flex size-6 items-center justify-center rounded-md", RESULT_STYLE[result].chip)}><Icon className="size-3.5" /></span>
                  <span className="font-semibold tabular-nums"><AnimatedNumber value={counts[result]} /></span>
                  <span className="text-muted-foreground">{RESULT_LABEL[result]}</span>
                </>
              );
              // A count of none opens nothing, and keeps its place in the row.
              return counts[result] ? (
                <NextLink key={result} href={papersHref(screening.id, { result })} className={cn("flex items-center gap-2 px-2 py-1.5 text-sm", ROW_LINK, "hover:bg-foreground/[0.06]")}>{inner}</NextLink>
              ) : (
                <span key={result} className="flex items-center gap-2 px-2 py-1.5 text-sm opacity-60">{inner}</span>
              );
            })}
          </div>
          <Yours open={open} />
        </div>
      </Section>
    </Panel>
  );
}

/** Your own votes, each count opening those papers, and the papers of yours that still wait for someone else. */
function Yours({ open }: { open: Open }) {
  const { screening } = open;
  const mine = open.yours.flatMap((paper) => open.myVote(paper) ?? []);
  if (!mine.length) return null;
  const waiting = open.yours.filter((paper) => open.myVote(paper) && open.settled[paper.id]!.result === "waiting");
  const others = [...new Map(waiting.flatMap((paper) => open.votes[paper.id]!.filter((one) => !one.vote && !one.failed).map((one) => [one.reviewer.id, one.reviewer] as const))).values()];
  const named = others.slice(0, 2);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-card/70 px-3 py-2 text-sm">
      <span className="font-medium">Your {mine.length.toLocaleString("en-GB")} {mine.length === 1 ? "vote" : "votes"}</span>
      <span className="flex items-center gap-1">
        {DECISIONS.map((decision) => {
          const n = count(mine, (vote) => vote.decision === decision);
          const Icon = RESULT_STYLE[decision].icon;
          return n ? (
            <NextLink key={decision} href={papersHref(screening.id, { voted: decision })} aria-label={`${n} you voted ${DECISION_LABEL[decision]}`} className={cn("flex items-center gap-1 px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground", ROW_LINK)}>
              <span className={cn("flex size-4 items-center justify-center rounded", RESULT_STYLE[decision].chip)}><Icon className="size-2.5" /></span>
              {n}
            </NextLink>
          ) : null;
        })}
      </span>
      {waiting.length ? (
        <span className="min-w-0 flex-1 text-muted-foreground max-sm:basis-full">
          <NextLink href={papersHref(screening.id, { reviewer: open.me, result: "waiting" })} className="font-medium text-foreground underline-offset-2 hover:underline">{waiting.length.toLocaleString("en-GB")} of them {waiting.length === 1 ? "waits" : "wait"}</NextLink>
          {" for "}
          {named.map((reviewer, i) => (
            <span key={reviewer.id}>
              {i ? " and " : ""}
              {/* Your papers that still wait for this reviewer's vote. */}
              <NextLink href={papersHref(screening.id, { reviewer: reviewer.id, voted: "none", with: open.me })} className="text-foreground underline-offset-2 hover:underline">{reviewer.name}</NextLink>
            </span>
          ))}
          {others.length > 2 ? ` and ${others.length - 2} more` : ""} to vote.
        </span>
      ) : null}
    </div>
  );
}

// ── Reviewers ────────────────────────────────────────────────────────────────────────────────────


/** The columns of the Reviewers table: on a phone a row is two lines, the name alone on the first. */
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-x-4 gap-y-2 px-4 @2xl/reviewers:gap-x-3 @2xl/reviewers:grid-cols-[minmax(0,1.2fr)_minmax(8.75rem,0.7fr)_repeat(3,3.25rem)_10.5rem_2rem]";

function Reviewers({ open }: { open: Open }) {
  const { screening, papers, votes, settled } = open;
  const [{ sort }, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  const [leaving, setLeaving] = useState<Reviewer | null>(null);
  // Taking someone off keeps their votes counting. Throwing the votes out is asked for, in the same dialog.
  const [discard, setDiscard] = useState(false);
  // The person some papers are being moved from, while that is being set up.
  const [moving, setMoving] = useState<string | null>(null);
  const reviewers = activeReviewers(screening);
  const rows = useMemo(
    () =>
      reviewers.map((reviewer) => {
        const theirs = papers.filter((paper) => votes[paper.id]!.some((one) => one.reviewer.id === reviewer.id));
        const cast = theirs.flatMap((paper) => votes[paper.id]!.find((one) => one.reviewer.id === reviewer.id)!.vote ?? []);
        const judged = theirs.flatMap((paper) => {
          const [vote, final] = [votes[paper.id]!.find((one) => one.reviewer.id === reviewer.id)!.vote, settled[paper.id]!.final];
          return vote && final ? [{ vote: vote.decision, final }] : [];
        });
        // A vote is compared with the people's: the other people given the paper for a person, all of them for a model, and never with a model's. There is something to agree with where at least one of those people has voted and the ones who have voted alike.
        const compared = theirs.flatMap((paper) => {
          const cast = votes[paper.id]!.filter((one) => !one.failed);
          const mine = cast.find((one) => one.reviewer.id === reviewer.id)?.vote;
          const people = cast.flatMap((one) => (one.reviewer.kind === "person" && one.reviewer.id !== reviewer.id && one.vote ? [one.vote.decision] : []));
          if (!mine || !people.length || new Set(people).size > 1) return [];
          return [people[0] === mine.decision];
        });
        // A person's pace is what they voted on in the last three days. At that pace, how long what is left takes them.
        // What is left for them is what their To do holds: their papers without their vote that aren't settled already without it.
        const left = theirs.filter((paper) => !votes[paper.id]!.find((one) => one.reviewer.id === reviewer.id)!.vote && !settled[paper.id]!.final).length;
        // There is a pace to go by once their first vote is a day old: five votes in the first five minutes of a screening say nothing about the weeks to come.
        const perDay = cast.some((vote) => vote.at < NOW - DAY) ? count(cast, (vote) => vote.at > NOW - 3 * DAY) / 3 : 0;
        return {
          reviewer,
          assigned: theirs.length,
          done: cast.length,
          split: DECISIONS.map((decision) => count(cast, (vote) => vote.decision === decision)),
          agrees: compared.length ? count(compared, (same) => same) / compared.length : null,
          compared: compared.length,
          missed: count(judged, (one) => one.final === "include" && one.vote === "exclude"),
          included: count(judged, (one) => one.final === "include"),
          left,
          perDay,
          // Nothing voted in three days by someone who has been on the screening that long. A screening made from another keeps its reviewers' older dates, so its own start counts too.
          idle: left > 0 && perDay === 0 && Math.max(reviewer.addedAt, screening.createdAt) < NOW - 3 * DAY && cast.every((vote) => vote.at < NOW - 3 * DAY),
        };
      }),
    [reviewers, papers, votes, settled],
  );
  type Row = (typeof rows)[number];
  const by = (row: Row) => (sort === "voted" ? row.done / Math.max(row.assigned, 1) : (row.agrees ?? -1));
  const ordered = (list: Row[]) => (sort ? [...list].sort((a, b) => by(b) - by(a)) : list);
  const groups = [
    { label: "People", rows: ordered(rows.filter((row) => row.reviewer.kind === "person")) },
    { label: "Models", rows: ordered(rows.filter((row) => row.reviewer.kind === "model")) },
  ].filter((group) => group.rows.length);
  // Who papers can be moved from: a person with papers left that someone else doesn't have. Where every person reads every paper there is nobody to move one to.
  const takers = rows.filter((row) => row.reviewer.kind === "person" && !row.reviewer.email);
  const gone = screening.reviewers.filter((one) => one.left && !one.email).map((reviewer) => ({ reviewer, cast: count(papers, (paper) => votes[paper.id]!.some((one) => one.reviewer.id === reviewer.id && one.vote)) }));
  const stillVoting = takers.filter((row) => row.left > 0);
  // Said where there is more than one person: for one alone, their own row says it.
  const everyoneDone = !screening.finishedAt && takers.length > 1 && stillVoting.length > 0 && stillVoting.every((row) => row.perDay > 0) ? `Everyone done in about ${daysFrom(Math.max(...stillVoting.map((row) => Math.ceil(row.left / row.perDay))))}, at this pace` : null;
  const givers = open.canChange && !screening.finishedAt ? takers.filter((row) => row.left > 0 && takers.some((other) => other !== row && open.movable(row.reviewer.id, other.reviewer.id).length)) : [];
  const without = (reviewer: Reviewer): Screening => ({ ...screening, reviewers: screening.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: Date.now(), ...(discard ? { discarded: Date.now() } : {}) } : one)) });
  const leavingVotes = leaving ? count(open.papers, (paper) => open.votes[paper.id]!.some((one) => one.reviewer.id === leaving.id && one.vote)) : 0;
  const { people: readers, each } = readersOf(screening);
  const people = readers.length;
  // With two reviewers there is one pair, so its figure sits in this section's head instead of a section of its own.
  const [a, b] = reviewers;
  const pair = reviewers.length === 2 ? agreement(b!.id, a!.id, open) : null;
  const leavingMe = leaving?.id === open.me;

  // A column the table can be ordered by: highest first, and a second press puts the table back as it was.
  const sortable = (id: "voted" | "agrees", label: string) => (
    <button type="button" onClick={() => void setPlace({ sort: sort === id ? null : id })} className={cn("flex items-center gap-1 rounded-md outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50", sort === id && "font-medium text-foreground")}>
      {label}
      <ArrowDown aria-hidden className={cn("size-3.5 shrink-0", sort === id ? "opacity-100" : "opacity-0")} />
    </button>
  );

  return (
    <Section
      id="reviewers"
      title="Reviewers"
      help={
        <Help title="How papers are shared out" facts={<>{each ? <HelpFact>{each < people ? `${each} of ${people} people a paper` : `Every person reads every paper`}</HelpFact> : null}{modelsOf(screening).length ? <HelpFact>Models read every open paper</HelpFact> : null}</>}>
          <p>Each person votes on a share of the papers. Each model votes on every paper that was open when it joined.</p>
          <p>Under a person&apos;s count is when they get through what they have left, if they keep the pace of their last three days.</p>
        </Help>
      }
      aside={
        <>
        {/* When the last of the people gets through their papers, where each of them has a pace to go by: what moving papers brings forward. */}
        {everyoneDone ? <span className="text-xs tabular-nums text-muted-foreground">{everyoneDone}</span> : null}
        {/* Evening out the work: the person with the most left is offered first. */}
        {givers.length ? <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setMoving([...givers].sort((x, y) => y.left - x.left)[0]!.reviewer.id)}><Move />Move papers</Button> : null}
        {pair ? (
          <span className="flex items-center gap-1">
            <NextLink href={pairHref(screening.id, b!, a!)} className={cn("flex items-center gap-2 px-2 py-1 text-sm", ROW_LINK)}>
              <span className="text-muted-foreground">Agreement</span>
              <span className="rounded-md px-2 py-0.5 font-semibold tabular-nums" style={{ backgroundColor: shade(pair.kappa) }}>{pair.kappa.toFixed(2)}</span>
              <span className="tabular-nums text-muted-foreground">{sameText(pair)}</span>
            </NextLink>
            {KAPPA_HELP}
          </span>
        ) : null}
        </>
      }
    >
      {rows.length ? (
        <div role="table" aria-label="Reviewers" className={cn(LIST, "@container/reviewers overflow-clip")}>
          <div role="row" className={cn(COLUMNS, "sticky top-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+var(--screening-frame,0px))] z-10 whitespace-nowrap bg-card py-2 text-xs text-muted-foreground @max-2xl/reviewers:hidden")}>
            <span role="columnheader">Reviewer</span>
            <span role="columnheader" aria-sort={sort === "voted" ? "descending" : "none"}>{sortable("voted", "Papers voted on")}</span>
            {DECISIONS.map((decision) => { const Icon = RESULT_ICON[decision]; return <span key={decision} role="columnheader" className="flex items-center justify-end gap-1"><Icon className="size-3.5 shrink-0" />{DECISION_LABEL[decision]}</span>; })}
            <span role="columnheader" aria-sort={sort === "agrees" ? "descending" : "none"} className="flex items-center justify-end gap-0.5">
              {sortable("agrees", "Agrees with people")}
              <Help title="Agrees with people" side="bottom" facts={<><HelpFact>A person with the other people on the paper</HelpFact><HelpFact>A model with the people, never with a model</HelpFact></>}>
                <p>How often this reviewer voted as the people did, on the papers where the people who have voted so far voted alike. A low figure is a reviewer who reads the criteria differently from the rest.</p>
                <p>Under a model, the papers the screening included that it voted to exclude.</p>
              </Help>
            </span>
            <span role="columnheader"><span className="sr-only">Actions</span></span>
          </div>
          {groups.map((group) => (
            <div key={group.label} role="rowgroup" className="divide-y divide-border-subtle border-t border-border-subtle first:border-t-0">
              <div role="row" className="flex items-center gap-2 bg-inset px-4 py-1.5 text-xs font-medium">
                <span role="cell">{group.label} <span className="font-normal tabular-nums text-muted-foreground">{group.rows.length}</span></span>
              </div>
              {group.rows.map((row) => <ReviewerRow key={row.reviewer.id} open={open} row={row} onLeave={setLeaving} onMove={givers.includes(row) ? () => setMoving(row.reviewer.id) : undefined} />)}
            </div>
          ))}
          {/* Whoever was taken off, and what became of their votes: results can rest on votes from someone no longer in the lists above. */}
          {gone.length ? (
            <div role="rowgroup" className="divide-y divide-border-subtle border-t border-border-subtle">
              <div role="row" className="flex items-center gap-2 bg-inset px-4 py-1.5 text-xs font-medium">
                <span role="cell">Taken off <span className="font-normal tabular-nums text-muted-foreground">{gone.length}</span></span>
              </div>
              {gone.map(({ reviewer, cast }) => (
                <div key={reviewer.id} role="row" className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span role="cell" className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex opacity-55"><ReviewerMark reviewer={reviewer} className="size-8" /></span>
                    <span className="min-w-0 truncate font-medium">{reviewer.name}</span>
                  </span>
                  <span role="cell" className="shrink-0 text-xs tabular-nums text-muted-foreground">{reviewer.discarded ? "Votes thrown out" : cast ? `${cast.toLocaleString("en-GB")} ${cast === 1 ? "vote still counts" : "votes still count"}` : "Cast no vote"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Nobody votes on these papers yet. Add a person or a model from the row above.</p>
      )}
      <ConfirmChange
        open={leaving !== null}
        title={leavingMe ? "Leave this screening?" : leaving ? `Take ${leaving.name} off this screening?` : ""}
        confirm={leavingMe ? "Leave" : "Take off"}
        onClose={() => { setLeaving(null); setDiscard(false); }}
        onConfirm={() => leaving && open.update(() => without(leaving), { what: `Took ${leaving.name} off the screening`, effect: [...effectItems(screening, without(leaving)).filter((line) => line.kind !== "leave").map(lineText), movesText(effectMoves(screening, without(leaving)))].filter(Boolean).join(". ") || undefined })}
      >
        {leaving ? <EffectList lines={effectLines(screening, without(leaving))} moves={effectMoves(screening, without(leaving))} /> : null}
        {/* Their work stands unless whoever takes them off says otherwise: the votes go only where that is asked for, and what it undoes shows above before it is done. */}
        {leaving && leavingVotes ? (
          <label className="flex items-start gap-3 rounded-xl border border-border-subtle p-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">Throw out {leavingMe ? "your" : "their"} {leavingVotes.toLocaleString("en-GB")} {leavingVotes === 1 ? "vote" : "votes"}</span>
              <span className="block text-xs text-muted-foreground">{discard ? "The votes stay on record and count for nothing. The papers they decided are voted on again." : "Off, the votes go on counting and no paper's result changes."}</span>
            </span>
            <Switch checked={discard} onCheckedChange={setDiscard} aria-label={`Throw out ${leavingMe ? "your" : "their"} votes`} />
          </label>
        ) : null}
      </ConfirmChange>
      {/* Made anew for each move, so it starts from the person it was opened for. */}
      {moving ? <MovePapers key={moving} open={open} people={takers} from={moving} onClose={() => setMoving(null)} /> : null}
    </Section>
  );
}

/**
 * Moves papers one person has yet to vote on to another, to even out the work: who gives them up, who takes them,
 * how many, and where that leaves the two of them. Only papers the taker doesn't already have can go.
 */
function MovePapers({ open, people, from: first, onClose }: { open: Open; people: ReviewerRowData[]; from: string; onClose: () => void }) {
  const [from, setFrom] = useState(first);
  const [chosen, setChosen] = useState<string | null>(null);
  const [asked, setAsked] = useState<number | null>(null);
  const giver = people.find((row) => row.reviewer.id === from) ?? people[0]!;
  const others = people.filter((row) => row !== giver).map((row) => ({ row, can: open.movable(giver.reviewer.id, row.reviewer.id).length }));
  // Whoever has the least left is offered first.
  const taker = others.find((one) => one.row.reviewer.id === chosen && one.can) ?? [...others].filter((one) => one.can).sort((x, y) => x.row.left - y.row.left)[0];
  const most = taker?.can ?? 0;
  // To start with, enough to leave the two with the same number.
  const papers = Math.max(1, Math.min(most, asked ?? Math.round((giver.left - (taker?.row.left ?? 0)) / 2)));
  // The day the last of the people is done, as it is and with the move, in days from now.
  const lastDay = (leftOf: (row: ReviewerRowData) => number) => {
    const still = people.filter((row) => leftOf(row) > 0);
    return still.length && still.every((row) => row.perDay > 0) ? Math.max(...still.map((row) => Math.ceil(leftOf(row) / row.perDay))) : null;
  };
  const doneBefore = lastDay((row) => row.left);
  const doneAfter = taker ? lastDay((row) => (row === giver ? row.left - papers : row === taker.row ? row.left + papers : row.left)) : null;
  const face = (row: ReviewerRowData) => <ReviewerMark reviewer={row.reviewer} className="size-4" />;
  const nameOf = (row: ReviewerRowData) => (row.reviewer.id === open.me ? "You" : row.reviewer.name);
  const load = (row: ReviewerRowData, after: number) => (
    <div key={row.reviewer.id} className="flex items-center gap-2.5 px-3 py-2.5 text-sm">
      <ReviewerMark reviewer={row.reviewer} className="size-7" />
      <span className="min-w-0 flex-1 truncate font-medium">{nameOf(row)}</span>
      <span className="flex shrink-0 items-center gap-1.5 tabular-nums"><span className="text-muted-foreground">{num(row.left)} left</span><ArrowRight aria-hidden className="size-3.5 text-muted-foreground" /><span className="font-semibold">{num(after)} left</span></span>
      <span className="w-36 shrink-0 text-end text-xs tabular-nums text-muted-foreground">{doneIn(after, row.perDay) ?? (!after ? "Nothing left" : row.idle ? "No votes in 3 days" : null)}</span>
    </div>
  );
  return (
    <ConfirmChange open title="Move papers between reviewers" confirm={taker ? `Move ${plural(papers, "paper", "papers")}` : "Move"} disabled={!taker} onClose={onClose} onConfirm={() => taker && open.move(giver.reviewer, taker.row.reviewer, papers)}>
      <div className="flex flex-wrap items-center gap-2">
        <FilterMenu name="From" value={giver.reviewer.id} onChange={(next) => { setFrom(next); setChosen(null); setAsked(null); }} narrows={false} className="h-8 rounded-full px-3.5 text-xs" choices={people.filter((row) => row.left > 0).map((row) => ({ value: row.reviewer.id, label: nameOf(row), icon: face(row), count: row.left }))} />
        {taker ? <FilterMenu name="To" value={taker.row.reviewer.id} onChange={(next) => { setChosen(next); setAsked(null); }} narrows={false} className="h-8 rounded-full px-3.5 text-xs" choices={others.filter((one) => one.can).map((one) => ({ value: one.row.reviewer.id, label: nameOf(one.row), icon: face(one.row), count: one.can }))} /> : null}
      </div>
      {taker ? (
        <>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 text-sm"><span id="move-how-many" className="font-medium">Papers to move</span><span className="tabular-nums text-muted-foreground"><span className="text-base font-semibold text-foreground">{papers}</span> of {most} that {nameOf(taker.row) === "You" ? "you don't" : `${taker.row.reviewer.name.split(" ")[0]} doesn't`} already have</span></div>
            <Slider aria-labelledby="move-how-many" min={1} max={Math.max(most, 1)} step={1} value={[papers]} onValueChange={([next]) => setAsked(next ?? 1)} disabled={most <= 1} />
          </div>
          <div className={cn(LIST, "divide-y divide-border-subtle")}>
            {load(giver, giver.left - papers)}
            {load(taker.row, taker.row.left + papers)}
          </div>
          {/* What the move does to the day the last of them is done, where every one of them has a pace to go by. */}
          {doneAfter && doneBefore ? <p className="text-sm tabular-nums"><span className="font-medium">Everyone done in about {daysFrom(doneAfter)}</span>{doneAfter === doneBefore ? <span className="text-muted-foreground">, the same as now</span> : <span className="text-muted-foreground">, where it is about {daysFrom(doneBefore)} now</span>}</p> : null}
          <p className="text-sm text-muted-foreground">It starts at the number that leaves the two of them with as many papers as each other. The papers furthest down {nameOf(giver) === "You" ? "your" : `${firstName(giver.reviewer.name)}'s`} queue go. Votes already cast stay where they are.</p>
        </>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Everyone else already has all of {nameOf(giver) === "You" ? "your" : `${firstName(giver.reviewer.name)}'s`} papers.</p>
      )}
    </ConfirmChange>
  );
}

type ReviewerRowData = { reviewer: Reviewer; assigned: number; done: number; split: number[]; agrees: number | null; compared: number; missed: number; included: number; left: number; perDay: number; idle: boolean };
const DAY = 86_400_000;
/** When someone gets through so many papers at their pace, in days from now, or nothing where they have no pace to go by. It is said as a day to come ("done in"), so it never reads as Screen's count of the minutes the papers themselves take. */
const doneIn = (left: number, perDay: number) => (left <= 0 || perDay <= 0 ? null : `Done in about ${daysFrom(Math.ceil(left / perDay))}`);
const daysFrom = (days: number) => (days === 1 ? "a day" : days < 14 ? `${days} days` : `${Math.round(days / 7)} weeks`);

/** One reviewer: the whole row opens the papers they voted on, and each count opens its own. */
function ReviewerRow({ open, row, onLeave, onMove }: { open: Open; row: ReviewerRowData; onLeave: (reviewer: Reviewer) => void; /** Opens the move of some of this person's papers to someone else, where they have papers that can go. */ onMove?: () => void }) {
  const { screening } = open;
  const { reviewer, assigned, done, split, agrees, compared, missed, included, left, perDay, idle } = row;
  const takes = doneIn(left, perDay);
  const id = screening.id;
  const unreadPapers = reviewer.kind === "model" ? open.unread(reviewer) : [];
  const unread = unreadPapers.length;
  const reading = reviewer.kind === "model" && done + unread < assigned && !screening.finishedAt;
  const held = open.outOfCredits ? { icon: Coins, text: "Stopped, out of credits" } : screening.paused ? { icon: CirclePause, text: "Paused" } : open.waitingFor ? { icon: Clock, text: "Waiting its turn" } : null;
  const mine = reviewer.id === open.me;
  // Above the row's own link, so a count or a menu opens itself and not the row.
  const above = "relative z-[1]";
  return (
    <div role="row" className={cn(COLUMNS, "relative py-3 transition-colors hover:bg-muted/40")}>
      <div role="cell" className="flex min-w-0 items-start gap-3 @max-2xl/reviewers:col-span-2">
        <ReviewerMark reviewer={reviewer} className="size-8" />
        <div className="min-w-0">
          <NextLink href={papersHref(id, { reviewer: reviewer.id })} className="flex min-w-0 text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline">
            <ReviewerName reviewer={reviewer} you={mine} />
          </NextLink>
          {reviewer.kind === "model" ? (
            <p className="flex min-w-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
              {reading ? (held ? <held.icon className="size-3.5 shrink-0" /> : <AiIcon working className="size-3.5 shrink-0" />) : <Coins className="size-3.5 shrink-0" />}
              <span className="truncate">{reading ? (held?.text ?? "Reading") : `${credits(open.spent(reviewer))} credits spent`}</span>
            </p>
          ) : (
            <p className="truncate text-xs text-muted-foreground">{reviewer.email ? "Invited, hasn't joined yet" : assigned && done === assigned ? "Done" : reviewer.addedAt > NOW ? "Added just now" : reviewer.reminded ? `Reminded ${ago(reviewer.reminded)}` : mine ? "Active now" : (personOf(reviewer.id)?.seen)}</p>
          )}
        </div>
      </div>
      <div role="cell" className="min-w-0 @max-2xl/reviewers:col-start-1 @max-2xl/reviewers:row-start-2">
        <div className="flex items-center gap-3">
          <Meter value={done} max={Math.max(assigned, 1)} fill={assigned && done === assigned ? "bg-success" : "bg-foreground/45"} />
          <NextLink href={papersHref(id, { reviewer: reviewer.id })} className={cn(above, "-mx-1.5 shrink-0 whitespace-nowrap px-1.5 py-0.5 text-end text-xs tabular-nums text-muted-foreground @2xl/reviewers:w-[4.75rem]", ROW_LINK, "hover:bg-muted hover:text-foreground")}><AnimatedNumber value={done} /> of {num(assigned)}</NextLink>
        </div>
        {/* When a person gets through what they have left, at the pace of their last three days: a second line, as a model has for what it couldn't read. */}
        {reviewer.kind === "person" && !reviewer.email && left > 0 && !screening.finishedAt ? (
          takes ? (
            <p className="flex items-center gap-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground"><Clock className="size-3.5 shrink-0" />{takes}</p>
          ) : idle ? (
            <p className="flex items-center gap-1 whitespace-nowrap text-xs ink-warning"><Hourglass className="size-3.5 shrink-0" />No votes in 3 days</p>
          ) : null
        ) : null}
        {/* The papers it got to and couldn't read, under how many it read: a second line that, with the count over it, is no taller than the name and its credits, so a paper that fails while it reads moves nothing. It has no margin of its own for that reason, and neither has a person's second line. */}
        {unread ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className={cn(above, "flex h-4 w-fit gap-1 rounded px-1.5 text-xs bg-destructive/10 ink-destructive hover:bg-destructive/15")} aria-label={`${unread} ${unread === 1 ? "paper" : "papers"} it couldn't read`}>{unread} couldn&apos;t be read<ChevronDown aria-hidden className="size-3.5 opacity-60" /></Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex max-h-[min(26rem,var(--radix-popover-content-available-height))] w-80 flex-col gap-2.5 p-3 text-sm">
              <p>Its provider gave an error on {unread === 1 ? "this paper" : `these ${unread} papers`}, so it has no say in {unread === 1 ? "it" : "them"}. The other reviewers settle {unread === 1 ? "it" : "them"}.</p>
              <ul className="-mx-1 min-h-10 flex-1 space-y-0.5 overflow-y-auto">
                {unreadPapers.map((paper) => (
                  <li key={paper.id}><NextLink href={papersHref(id, { paper: paper.id })} className={cn("block px-1 py-1 text-xs", ROW_LINK)}><span className="line-clamp-2">{paper.title} ({paper.year})</span></NextLink></li>
                ))}
              </ul>
              {open.canChange ? <Button size="sm" className="w-full shrink-0" onClick={() => open.retry(reviewer)}><RotateCcw />Have it read {unread === 1 ? "it" : "them"} again, for {credits(unread * paperCredits(reviewer.model!))} credits</Button> : null}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      {DECISIONS.map((decision, i) => {
        const Icon = RESULT_STYLE[decision].icon;
        const inner = (
          <>
            <span className={cn("flex size-4 items-center justify-center rounded", RESULT_STYLE[decision].chip)}><Icon className="size-2.5" /></span>
            {split[i]}
          </>
        );
        return (
          <div key={decision} role="cell" className="flex justify-end @max-2xl/reviewers:hidden">
            {split[i] ? (
              <NextLink href={papersHref(id, { reviewer: reviewer.id, voted: decision })} aria-label={`${split[i]} voted ${DECISION_LABEL[decision]}`} className={cn(above, "flex items-center gap-1 px-1.5 py-0.5 text-xs tabular-nums", ROW_LINK, "hover:bg-muted")}>{inner}</NextLink>
            ) : (
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground opacity-60">{inner}</span>
            )}
          </div>
        );
      })}
      <div role="cell" className="min-w-0 text-end @max-2xl/reviewers:col-span-2 @max-2xl/reviewers:col-start-2 @max-2xl/reviewers:row-start-2">
        <p className="text-sm font-semibold tabular-nums">{agrees === null ? <span className="font-normal text-muted-foreground">Nothing to compare yet</span> : <>{Math.round(agrees * 100)}%<span className="font-normal text-muted-foreground @2xl/reviewers:hidden">{reviewer.kind === "person" ? " same vote as the others" : " same vote as the people"}</span></>}</p>
        {reviewer.kind === "model" && included ? (
          missed ? (
            <NextLink href={papersHref(id, { reviewer: reviewer.id, voted: "exclude", result: "include" })} className={cn(above, "block whitespace-nowrap text-xs tabular-nums ink-destructive underline-offset-2 hover:underline")}>Excluded {missed} of the {num(included)} included it voted on</NextLink>
          ) : (
            <p className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">Excluded 0 of the {num(included)} included it voted on</p>
          )
        ) : agrees !== null ? (
          <p className="whitespace-nowrap text-xs tabular-nums text-muted-foreground @max-2xl/reviewers:hidden">of {compared} papers</p>
        ) : null}
      </div>
      <div role="cell" className="@max-2xl/reviewers:col-start-3 @max-2xl/reviewers:row-start-1">
        {open.canChange ? (
          <DropdownMenu>
            <TooltipHint label="More">
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className={cn(above, "size-8 text-muted-foreground")} aria-label={`More for ${reviewer.name}`}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
            </TooltipHint>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem asChild><NextLink href={papersHref(id, { reviewer: reviewer.id })}><ListChecks />See {mine ? "your" : "their"} votes in Papers</NextLink></DropdownMenuItem>
              {unread ? <DropdownMenuItem onSelect={() => open.retry(reviewer)}><RotateCcw />Read the {unread} it couldn&apos;t again</DropdownMenuItem> : null}
              {reviewer.kind === "person" && !mine && done < assigned ? (
                <DropdownMenuItem onSelect={() => open.update((s) => ({ ...s, reviewers: s.reviewers.map((one) => (one.id === reviewer.id ? { ...one, reminded: Date.now() } : one)) }), { what: `Sent ${reviewer.name} a reminder`, effect: `${assigned - done} papers wait for them` })}><Mail />Send a reminder</DropdownMenuItem>
              ) : null}
              {onMove ? <DropdownMenuItem onSelect={onMove}><Move />Move papers to someone else</DropdownMenuItem> : null}
              <DropdownMenuItem variant="destructive" onSelect={() => onLeave(reviewer)}><Trash2 />{mine ? "Leave this screening" : "Take off this screening"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

// ── Agreement ────────────────────────────────────────────────────────────────────────────────────

/** Cohen's kappa in four bands, from below chance-corrected fair agreement up to almost perfect. */
const BANDS = [
  { label: "Below 0.4", kappa: 0.2 },
  { label: "0.4 to 0.6", kappa: 0.5 },
  { label: "0.6 to 0.8", kappa: 0.7 },
  { label: "0.8 and up", kappa: 0.9 },
];
const shade = (kappa: number) => (kappa < 0.4 ? "color-mix(in oklab, var(--destructive) 16%, transparent)" : kappa < 0.6 ? "color-mix(in oklab, var(--warning) 22%, transparent)" : `color-mix(in oklab, var(--success) ${Math.round(18 + Math.max(0, Math.min(1, (kappa - 0.6) / 0.4)) * 42)}%, transparent)`);
/** The papers two reviewers both voted on, the ones they split on first. */
const pairHref = (id: string, a: Reviewer, b: Reviewer) => papersHref(id, { reviewer: a.id, with: b.id, sort: "split" });
const sameText = (pair: { same: number }) => `${Math.round(pair.same * 100)}% same`;
const KAPPA_HELP = (
  <Help title="Cohen's kappa" facts={<><HelpFact>1.0 same vote every time</HelpFact><HelpFact>0.6 and up substantial</HelpFact><HelpFact>0 no better than chance</HelpFact><HelpFact>Below 0 worse than chance</HelpFact></>}>
    <p>How far two reviewers agree beyond chance, on the papers both have voted on. Methods sections report it. The overall figure is the mean of every pair.</p>
    <p>On a handful of papers it swings widely, and can fall below 0. It steadies as more papers have both votes.</p>
  </Help>
);

/** How far each pair of reviewers agrees. With two reviewers, their one figure is in the Reviewers section's head instead. */
function Agreement({ open }: { open: Open }) {
  const { screening } = open;
  const reviewers = activeReviewers(screening);
  const pairs = useMemo(
    () => reviewers.flatMap((a, row) => reviewers.slice(0, row).map((b) => ({ a, b, pair: agreement(a.id, b.id, open) }))),
    [reviewers, open],
  );
  if (reviewers.length < 3) return null;
  const known = pairs.flatMap((one) => (one.pair ? [one.pair.kappa] : []));
  // Light's kappa: the mean of every pair's, the figure the squares add up to.
  const overall = known.length ? known.reduce((sum, kappa) => sum + kappa, 0) / known.length : null;
  const short = (reviewer: Reviewer) => (reviewer.id === open.me ? "You" : firstName(reviewer.name));

  return (
    <Section
      id="agreement"
      title="Agreement between reviewers"
      help={KAPPA_HELP}
      aside={
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {BANDS.map((band) => (
            <span key={band.label} className="flex items-center gap-1.5 whitespace-nowrap tabular-nums"><span className="size-3 rounded ring-1 ring-border-subtle ring-inset" style={{ backgroundColor: shade(band.kappa) }} />{band.label}</span>
          ))}
        </span>
      }
    >
      {overall === null ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">How far the reviewers agree shows here once two of them have voted on the same papers.</p>
      ) : (
        <div className="space-y-3">
          {/* The figure, named for what it is and with its scale, and beside it a link that says where it goes. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-3">
              <span className="rounded-lg px-2.5 py-1 text-2xl font-semibold tabular-nums tracking-tight" style={{ backgroundColor: shade(overall) }}>{overall.toFixed(2)}</span>
              <span className="text-sm">
                <span className="font-medium">Overall agreement, as Cohen&apos;s kappa</span>
                <span className="block text-xs text-muted-foreground">0 is no better than chance, 1 is full agreement. Across {known.length} {known.length === 1 ? "pair" : "pairs"} of reviewers</span>
              </span>
            </span>
            <LinkChip href={papersHref(screening.id, { sort: "split" })} icon={GitCompare}>The papers they split on most</LinkChip>
          </div>
          {/* Each pair once: the rows from the second reviewer on, the columns up to the one before last. */}
          <div className={cn(LIST, "overflow-x-auto p-4 @max-2xl/overview:hidden")}>
            <div className="grid min-w-max items-center gap-1" style={{ gridTemplateColumns: `minmax(9rem, auto) repeat(${reviewers.length - 1}, minmax(3.5rem, 1fr))` }}>
              <span />
              {reviewers.slice(0, -1).map((reviewer) => (
                <NextLink key={reviewer.id} href={papersHref(screening.id, { reviewer: reviewer.id })} aria-label={reviewer.id === open.me ? "Your votes" : `Votes by ${reviewer.name}`} className={cn("flex min-w-0 flex-col items-center gap-1 px-1 py-1", ROW_LINK)}>
                  <ReviewerMark reviewer={reviewer} you={reviewer.id === open.me} />
                  <span className="max-w-full truncate text-2xs text-muted-foreground">{short(reviewer)}</span>
                </NextLink>
              ))}
              {reviewers.slice(1).map((a, i) => (
                <div key={a.id} className="contents">
                  <NextLink href={papersHref(screening.id, { reviewer: a.id })} className={cn("flex min-w-0 items-center gap-2 px-1.5 py-1 pe-3 text-xs", ROW_LINK)}><ReviewerMark reviewer={a} className="size-5" /><ReviewerName reviewer={a} you={a.id === open.me} /></NextLink>
                  {reviewers.slice(0, -1).map((b, column) => {
                    if (column > i) return <span key={b.id} className="h-12" />;
                    const pair = pairs.find((one) => one.a.id === a.id && one.b.id === b.id)?.pair;
                    if (!pair) return <span key={b.id} className="flex h-12 items-center justify-center rounded-lg border border-dashed border-border-subtle text-2xs text-muted-foreground">None yet</span>;
                    return (
                      <NextLink key={b.id} href={pairHref(screening.id, a, b)} aria-label={`${a.name} and ${b.name}: kappa ${pair.kappa.toFixed(2)}, same vote on ${Math.round(pair.same * 100)}% of ${pair.papers} papers`} className="flex h-12 flex-col items-center justify-center rounded-lg outline-none ring-foreground/20 transition-shadow hover:ring-2 focus-visible:ring-2 focus-visible:ring-ring/50" style={{ backgroundColor: shade(pair.kappa) }}>
                        <span className="text-xs font-semibold tabular-nums">{pair.kappa.toFixed(2)}</span>
                        <span className="text-2xs tabular-nums text-foreground/70">{sameText(pair)}</span>
                      </NextLink>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          {/* On a phone, the same pairs as a list. */}
          <ul className={cn(LIST, "@2xl/overview:hidden")}>
            {pairs.map(({ a, b, pair }) => (
              <li key={`${a.id}:${b.id}`}>
                <NextLink href={pairHref(screening.id, a, b)} className="flex items-center gap-3 px-4 py-2.5 text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40">
                  <span className="flex shrink-0 items-center"><ReviewerMark reviewer={b} className="size-6" /><ReviewerMark reviewer={a} className="-ms-1.5 size-6 ring-2 ring-card" /></span>
                  <span className="min-w-0 flex-1 line-clamp-2">{b.name} and {a.name}</span>
                  {pair ? (
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs tabular-nums text-muted-foreground">{sameText(pair)}</span>
                      <span className="rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums" style={{ backgroundColor: shade(pair.kappa) }}>{pair.kappa.toFixed(2)}</span>
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">None yet</span>
                  )}
                </NextLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

// ── Facts ────────────────────────────────────────────────────────────────────────────────────────

/** The facts about the screening, as wells beside the reviewers: who started it, where its included papers go, what its models cost, and its checks for new papers. */
function Facts({ open }: { open: Open }) {
  const { screening, counts } = open;
  const store = useMock();
  const starter = personOf(screening.createdBy);
  const workspace = workspaceOf(screening);
  const models = modelsOf(screening);
  const spent = models.reduce((sum, model) => sum + open.spent(model), 0);
  const most = models.reduce((sum, model) => sum + open.most(model), 0);
  // The papers a model got to and couldn't read: the line under what was spent says so, as each model's row does. A paper two models failed on is one paper.
  const unread = new Set(models.flatMap((model) => open.unread(model).map((paper) => paper.id))).size;
  const left = workspace === HOME ? store.wallet : workspace.credits;
  const to = screening.destination;
  const collection = to.kind === "none" ? null : to.kind === "new" ? to.name || `Included in ${screening.name}` : ([...COLLECTIONS, ...COMMUNITY_COLLECTIONS].find((one) => one.id === to.collection)?.name ?? "A collection");
  return (
    <div className="space-y-6">
      <Panel className="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-3 text-sm">
        <IdentityAvatar name={starter?.name ?? ""} imageUrl={starter?.imageUrl} className="size-6" />
        <span className="flex min-w-0 items-center gap-1"><ReviewerName reviewer={{ kind: "person", name: starter?.name ?? "Someone" }} you={screening.createdBy === open.me} className="font-medium" /></span>
        <span className="text-muted-foreground">started it {ago(screening.createdAt)}</span>
        <WorkspaceTag size="sm" workspace={lookOf(workspace, screening.createdBy)} />
      </Panel>

      <Section
        title="Included papers go to"
        help={
          <Help title="Where included papers go" facts={<><HelpFact>Saved as each is included</HelpFact>{to.prune ? <HelpFact>Excluded papers are taken out</HelpFact> : null}</>}>
            <p>Each paper is saved to this collection when it is included.</p>
          </Help>
        }
        aside={open.canChange ? <Button asChild variant="ghost" size="sm" className="h-7 text-xs"><NextLink href={settingsHref(screening.id, "goes-to")}>{collection ? "Change" : "Choose a collection"}</NextLink></Button> : null}
      >
        <Panel className="space-y-2.5">
          {collection ? (
            <p className="flex items-start gap-2 text-sm font-medium">
              <Folder className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="line-clamp-2">{collection}</span>
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm font-medium"><Ban className="size-4 shrink-0 text-muted-foreground" />Nowhere yet</p>
          )}
          <LinkChip href={papersHref(screening.id, { result: "include" })} tone="success" icon={RESULT_STYLE.include.icon} className="w-fit">
            <AnimatedNumber value={counts.include} /> {collection ? "saved so far" : "included, kept here"}
          </LinkChip>
        </Panel>
      </Section>

      <Section
        title="Credits"
        help={
          <Help title="What a screening costs" facts={models.length ? models.map((model) => <HelpFact key={model.id} icon={Coins}>{model.name}, {credits(paperCredits(model.model!))} a paper</HelpFact>) : <HelpFact>People only</HelpFact>}>
            <p>People screen for free. A model is paid for each paper it reads, from this workspace&apos;s credits.</p>
          </Help>
        }
      >
        <Panel className="space-y-2.5">
          {models.length ? (
            <>
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                  <AnimatedNumber value={Math.ceil(spent)} /> spent
                  {open.reading.length && !screening.paused && !open.outOfCredits ? <AiIcon working className="size-3.5" /> : null}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">{most - spent >= 1 ? `${credits(most)} once every paper is read` : unread ? `${unread} ${unread === 1 ? "paper" : "papers"} couldn't be read` : "Every paper is read"}</p>
              </div>
              <Meter value={spent} max={Math.max(most, 1)} fill={left < most - spent ? "bg-warning" : "bg-foreground/45"} />
              <div className="flex flex-wrap gap-1.5">
                <LinkChip href="/settings/billing" tone={left < most - spent ? "warning" : "neutral"} icon={Coins}>{credits(left)} left in {workspace.name}</LinkChip>
                <Chip>{models.length} {models.length === 1 ? "model" : "models"}</Chip>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">Nothing to pay</p>
              <Chip>People only</Chip>
            </div>
          )}
        </Panel>
      </Section>

    </div>
  );
}

const RECENT_CHECKS = 3;

/** Whether the screening checks its sources for new papers by itself, each check and what it brought, and the papers it started with. */
function Checks({ open }: { open: Open }) {
  const { screening, papers, settled } = open;
  const [{ checks }, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  const sources = growing(screening);
  if (!sources.length) return null;
  const all = [...(screening.updates ?? [])].reverse();
  const shown = checks === "all" ? all : all.slice(0, RECENT_CHECKS);
  const fixed = screening.sources.length - sources.length;
  const atStart = papers.filter((paper) => paper.batch === undefined).length;
  return (
    <Section
      id="new-papers"
      title="Checks for new papers"
      help={
        <Help title="Checking for new papers" facts={<>{screening.living ? <><HelpFact icon={RefreshCw}>{EVERY_LABEL[screening.living.every]}</HelpFact><HelpFact>Next on {day(screening.living.next)}</HelpFact></> : <HelpFact>Only when asked</HelpFact>}{fixed ? <HelpFact>Skips {fixed} fixed {fixed === 1 ? "source" : "sources"}</HelpFact> : null}</>}>
          <p>A check runs each source&apos;s search again and adds the papers this screening doesn&apos;t have yet. Uploaded files and pasted lists never change, so checks skip them.</p>
        </Help>
      }
      aside={open.canChange ? <Button variant="outline" size="sm" className="h-7 text-xs" disabled={Boolean(screening.checking)} onClick={open.check}><RefreshCw className={screening.checking ? "animate-spin motion-reduce:animate-none" : undefined} />Check now</Button> : null}
    >
      <Panel className="space-y-1 p-0">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-1">
          {screening.living ? (
            <Chip icon={RefreshCw}>Checks {EVERY_LABEL[screening.living.every].toLowerCase()}, next {day(screening.living.next)}</Chip>
          ) : (
            <>
              <Chip>Checks only when asked</Chip>
              {open.canChange ? <Button asChild variant="ghost" size="sm" className="h-6 px-1.5 text-xs"><NextLink href={settingsHref(screening.id, "new-papers")}>Check on a schedule</NextLink></Button> : null}
            </>
          )}
        </div>
        <div className="divide-y divide-border-subtle">
          <AnimatePresence initial={false}>
            {shown.map((update) => {
              const batch = papers.filter((paper) => paper.batch === update.at);
              const counts = { include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0 };
              for (const paper of batch) counts[settled[paper.id]!.result]++;
              const who = update.by === SCHEDULE ? null : personOf(update.by);
              const added = String(update.at);
              return (
                <motion.div key={update.at} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", DIVIDED_ROW)}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    {who ? <ReviewerMark reviewer={{ kind: "person", name: who.name, imageUrl: who.imageUrl }} className="size-7" /> : <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground"><Clock className="size-3.5" /></span>}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-sm"><span className="font-medium">{who ? `${update.by === open.me ? "You" : who.name} checked` : "Scheduled check"}</span><span className="text-xs text-muted-foreground">{ago(update.at)}</span></p>
                      {update.found ? (
                        <>
                          {/* Each source that gained papers, with how many were new to the screening. */}
                          {screening.sources.flatMap((source) => {
                            const found = source.updates?.find((one) => one.at === update.at);
                            const fresh = found ? found.added - found.duplicates : 0;
                            return fresh ? [<NextLink key={source.id} href={papersHref(screening.id, { added, source: source.id })} className="block text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"><span className="line-clamp-2">{fresh} new from {source.name}</span></NextLink>] : [];
                          })}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Chip>{update.found} found</Chip>
                            {update.found - update.added ? <Chip>{update.found - update.added} already in it</Chip> : null}
                            {update.added ? <LinkChip href={papersHref(screening.id, { added })} tone="primary">{update.added} added</LinkChip> : null}
                          </div>
                          {/* Where the papers it added stand now. */}
                          {batch.length ? (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <ResultBar counts={counts} className="h-1.5 min-w-24 flex-1" />
                              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                {RESULTS.filter((result) => counts[result]).map((result) => {
                                  const Icon = RESULT_ICON[result];
                                  return <span key={result} role="img" aria-label={`${counts[result]} ${RESULT_LABEL[result].toLowerCase()}`} className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground"><Icon className="size-3.5" />{counts[result]}</span>;
                                })}
                              </span>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <Chip>Nothing new</Chip>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {all.length > RECENT_CHECKS ? (
            <div className="px-4 py-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void setPlace({ checks: checks === "all" ? null : "all" })}>{checks === "all" ? "Show the last 3" : `See every check, ${all.length} in all`}</Button>
            </div>
          ) : null}
          <div className="flex items-start gap-3 px-4 py-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground"><Folder className="size-3.5" /></span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm"><span className="font-medium">At the start</span><span className="text-xs text-muted-foreground">{ago(screening.createdAt)}</span></p>
              <LinkChip href={papersHref(screening.id, { added: "start" })} className="w-fit">{atStart.toLocaleString("en-GB")} papers from {screening.sources.length} {screening.sources.length === 1 ? "source" : "sources"}</LinkChip>
            </div>
          </div>
        </div>
      </Panel>
    </Section>
  );
}

// ── Flow ─────────────────────────────────────────────────────────────────────────────────────────

type FlowRow = { key: string; label: string; value: number; href?: string; fill: string; indent?: boolean; /** The question a reason stands for. */ question?: string; /** A reason for excluding, which is drawn where the label would be. */ reason?: string };

/** The counts a PRISMA diagram is drawn from, left to right: found, duplicates merged, the papers screened, and included. Every count above none opens its papers. */
function Flow({ open, onExport }: { open: Open; onExport: (tab: ExportTab) => void }) {
  const { screening, papers, settled, counts } = open;
  const id = screening.id;
  const found = foundTotal(screening.sources);
  const kept = paperTotal(screening.sources);
  const arriving = open.gathering ? kept - papers.length : 0;
  const reasons = excludedBy(open);
  const neutral = "bg-foreground/25";
  const steps: Array<{ title: string; total: number; href?: string; rows: FlowRow[] }> = [
    { title: "Found", total: found, rows: screening.sources.map((source) => ({ key: source.id, label: source.name, value: taken(source), href: papersHref(id, { source: source.id }), fill: neutral })) },
    {
      title: "Duplicates merged",
      total: found - kept,
      href: settingsHref(id, "papers"),
      rows: screening.sources.flatMap((source) => (taken(source) - keptOf(source) ? [{ key: source.id, label: source.name, value: taken(source) - keptOf(source), href: settingsHref(id, "papers"), fill: neutral }] : [])),
    },
    {
      title: "Papers",
      total: kept,
      href: papersHref(id),
      rows: [
        { key: "exclude", label: RESULT_LABEL.exclude, value: counts.exclude, href: papersHref(id, { result: "exclude" }), fill: RESULT_STYLE.exclude.bar },
        ...reasons.map(([key, value]) => ({ key: `reason:${key}`, label: failedLabel(key, screening.criteria), reason: key, question: questionOf(key, screening.criteria), value, href: papersHref(id, { result: "exclude", reason: key }), fill: RESULT_STYLE.exclude.bar, indent: true })),
        { key: "maybe", label: RESULT_LABEL.maybe, value: counts.maybe, href: papersHref(id, { result: "maybe" }), fill: RESULT_STYLE.maybe.bar },
        { key: "conflict", label: RESULT_LABEL.conflict, value: counts.conflict, href: papersHref(id, { result: "conflict" }), fill: RESULT_STYLE.conflict.bar },
        { key: "waiting", label: RESULT_LABEL.waiting, value: counts.waiting, href: papersHref(id, { result: "waiting" }), fill: HATCH },
        // Papers still on their way from its sources have nowhere to open yet.
        ...(open.gathering ? [{ key: "arriving", label: "Still arriving", value: arriving, fill: HATCH }] : []),
      ],
    },
    {
      title: "Included",
      total: counts.include,
      href: papersHref(id, { result: "include" }),
      rows: screening.sources.flatMap((source) => {
        const value = count(papers, (paper) => paper.source === source.id && settled[paper.id]!.result === "include");
        return value ? [{ key: source.id, label: source.name, value, href: papersHref(id, { result: "include", source: source.id }), fill: RESULT_STYLE.include.bar }] : [];
      }),
    },
  ];
  return (
    <Section
      id="flow"
      title="PRISMA flow"
      help={
        <Help title="PRISMA flow" facts={<><HelpFact>Title and abstract</HelpFact><HelpFact>{screening.sources.length} {screening.sources.length === 1 ? "source" : "sources"}</HelpFact></>}>
          <p>The counts a review&apos;s PRISMA diagram is drawn from, from the papers its sources found to the ones it included.</p>
        </Help>
      }
      aside={<Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onExport("flow")}><Download />Download diagram</Button>}
    >
      <div className="grid grid-cols-1 divide-y divide-border-subtle rounded-2xl border border-border-subtle @3xl/overview:grid-cols-4 @3xl/overview:divide-x @3xl/overview:divide-y-0">
        {steps.map((step, i) => (
          <div key={step.title} className="relative min-w-0 space-y-3 p-4">
            {/* A count of none opens nothing, as in Progress. */}
            {step.href && step.total ? (
              <NextLink href={step.href} className={cn("-mx-2 -my-1 block px-2 py-1", ROW_LINK)}>
                <p className="text-xs text-muted-foreground">{step.title}</p>
                <p className="text-2xl font-semibold tabular-nums tracking-tight"><AnimatedNumber value={step.total} /></p>
              </NextLink>
            ) : (
              <div className={cn(!step.total && "opacity-60")}>
                <p className="text-xs text-muted-foreground">{step.title}</p>
                <p className="text-2xl font-semibold tabular-nums tracking-tight"><AnimatedNumber value={step.total} /></p>
              </div>
            )}
            {step.rows.length ? null : <p className="text-xs text-muted-foreground">None</p>}
            <ul className="-mx-2 space-y-0.5">
              {step.rows.map((row) => {
                const inner = (
                  <>
                    <span className="flex items-baseline justify-between gap-3 text-xs"><span className={cn("line-clamp-2 min-w-0 text-muted-foreground", row.indent && "ps-3")}>{row.reason ? <Reason reason={row.reason} criteria={screening.criteria} /> : row.label}</span><span className="shrink-0 font-medium tabular-nums">{row.value.toLocaleString("en-GB")}</span></span>
                    <Meter value={row.value} max={Math.max(found, 1)} fill={row.fill} className={cn("h-1", row.indent && "ms-3 w-[calc(100%-0.75rem)]")} />
                  </>
                );
                return (
                  <li key={row.key}>
                    <QuestionHint question={row.question} label={row.label}>
                      {row.href && row.value ? <NextLink href={row.href} className={cn("block space-y-1 px-2 py-1.5", ROW_LINK)}>{inner}</NextLink> : <div className={cn("space-y-1 px-2 py-1.5", !row.value && "opacity-60")}>{inner}</div>}
                    </QuestionHint>
                  </li>
                );
              })}
            </ul>
            {i < steps.length - 1 ? <ArrowRight aria-hidden className="absolute -end-2 top-5 z-10 hidden size-4 rounded-full bg-card text-muted-foreground @3xl/overview:block" /> : null}
          </div>
        ))}
      </div>
    </Section>
  );
}
