"use client";

// The open screening's Overview, one column that scrolls with the window: how far it has got and what
// to do next, who has voted how and how far they agree, the facts about it, and the counts a methods
// section asks for.

import { AutoHeight } from "@/components/ui/auto-height";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { useState, type ComponentProps } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { collectionHref } from "@/lib/library/links";
import { AnimatePresence, motion } from "motion/react";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { parseAsStringLiteral, useQueryState, useQueryStates } from "nuqs";
import { FileText, Lock, TriangleAlert, AiIcon, ArrowDown, ArrowRight, ArrowUpDown, Ban, ChevronDown, CircleCheck, Clock, Coins, Download, FileSearch, Folder, GitCompare, Hourglass, ListChecks, Mail, MoreHorizontal, Move, RefreshCw, RotateCcw, Trash2 } from "@/components/icons";
import { AnimatedNumber, Chip, Meter } from "./parts";
import { EASE } from "@/components/settings/model-map";
import { LIST } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpFact } from "@/components/ui/help";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { showStyledToast } from "@/components/ui/sonner";
import { TooltipHint } from "@/components/ui/tooltip";
import { PageStepper } from "@/components/shared/page-stepper";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage, useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { inWorkspace, useWorkspace as usePageWorkspace } from "@/lib/workspaces/url";
import type { Id } from "@/convex/_generated/dataModel";
import { EXTRACT_HREF, pickForExtraction } from "./extract";
import { cn } from "@/lib/utils";
import { reasonCriteria, DAY, pairOf, inOrder, leftOf, removedOf, readersOf, splitsIn, firstName, DECISIONS, RESULTS, activeReviewers, growing, lookOf, modelsOf, personIn, questionOf, taken, type Reviewer, type Result, shortName } from "./data";
import { gotThrough, modelsAdvise, theirsOf } from "@/lib/screening/rules";
import type { ExportTab } from "./dialogs";
import { papersHref, reviewerHref, screenHref, settingsHref } from "./links";
import { SENTENCE_CHIP, settleMeans, votesBy, TONE, FIGURE_LINK, HATCH, EmptyNote, ShutChip, ShutNote, RetryRead, retryLabel, DIVIDED_ROW, FilterMenu, Help, LinkChip, Panel, QuestionHint, RESULT_ICON, RESULT_STYLE, Reason, ResultBar, ReviewerMark, ReviewerName, Section, type Tone, MODELS_READING, MODELS_SAY, INLINE_LINK, StateChip } from "./pieces";
import { pdfsMissed, pdfsOf, unreadPdfs, useFigures, PACE_DAYS, type Figures, type Open, perPaper } from "./store";
import { ConfirmChange } from "./team";
import { useWorkspace } from "./workspace";
import { useOpenInAddress } from "./address";
import { useWords } from "./words";
import { ScrollArea } from "@/components/ui/scroll-area";

/** What the Overview shows, kept in its address: the order of the reviewers, and every check for new papers or the last few. */
const PLACE = {
  sort: parseAsStringLiteral(["voted", "agrees"] as const),
  checks: parseAsStringLiteral(["all"] as const),
};

/** Papers still to be voted on, hatched wherever a bar shows them, so they never read as excluded ones. */
/** A row or a count that opens its papers. */
const ROW_LINK = "rounded-lg outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50";
/** This part's own messages, as a function that is not a component is handed them. */
type T = ReturnType<typeof useTranslations<"screening.overview">>;
const notSaved = (t: T, error: unknown) => showStyledToast("error", getErrorMessage(error, t("notSaved")));
/** The cells of a pair's matrix where the two voted the same way. */
const SAME = [0, 4, 8];

/** The Overview as a page of the open screening. */
export function OverviewPage() {
  const { open, exportTo } = useWorkspace();
  return <Overview open={open} onExport={exportTo} />;
}

function Overview({ open, onExport }: { open: Open; onExport: (tab: ExportTab) => void }) {
  const { screening, total } = open;
  const read = useFigures(screening.id);
  const t = useTranslations("screening.overview");
  const words = useWords();

  if (!total && open.gathering) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
        <p className="text-sm font-medium">{t("empty.arriving")}</p>
        <p className="max-w-md text-sm text-muted-foreground">{t("empty.arrivingSays", { reviewer: String(open.isReviewer) })}</p>
      </div>
    );
  }
  if (!total) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
        <p className="text-sm font-medium">{words.t("empty.all")}</p>
        {/* No source, or sources that held nothing it can screen: Settings shows which, and what each left out. */}
        <p className="max-w-md text-sm text-muted-foreground">{t("empty.noPaper", { sources: String(screening.sources.length > 0) })}</p>
        {open.canChange ? <Button asChild variant="outline" size="sm" className="mt-2"><NextLink href={settingsHref(screening.id, "papers")}>{t("empty.toSources", { sources: String(screening.sources.length > 0) })}</NextLink></Button> : null}
      </div>
    );
  }

  return (
    <div className="@container/overview space-y-8 p-4 sm:p-6">
      <Progress open={open} onExport={onExport} />
      {/* Everything here is the page's own content and scrolls with it: nothing is a sidebar. The reviewers' table takes the page's width, with room for its columns. Under it the small facts stack beside the checks, two halves of a like height, and how far the reviewers agree takes a row of its own where there is a figure to show: no column stands empty beside a tall one. */}
      <Reviewers open={open} figures={read.figures} now={read.now} />
      {/* The small facts side by side in a row of their own, and the checks under them across the page: blocks of unlike heights never stand beside each other, so no column stands empty. */}
      <Facts open={open} />
      <Checks open={open} figures={read.figures} />
      <Agreement open={open} figures={read.figures} />
      <Flow open={open} figures={read.figures} onExport={onExport} />
    </div>
  );
}

// ── Progress ─────────────────────────────────────────────────────────────────────────────────────

/** How far the screening has got, in the colour of what it needs: the person looking, nobody, or someone else. */
function Progress({ open, onExport }: { open: Open; onExport: (tab: ExportTab) => void }) {
  const { finish } = useWorkspace();
  const { screening, total, counts, toDo, conflicts } = open;
  const settledAll = counts.conflict + counts.waiting === 0;
  const settle = conflicts > 0 && open.canResolve;
  const tone: Tone = toDo || settle ? "primary" : settledAll ? "success" : "neutral";
  const finishable = settledAll && open.canChange && !open.screening.finishedAt;
  const workspaceId = usePageWorkspace();
  const finished = Boolean(screening.finishedAt);
  const t = useTranslations("screening.overview");
  const tp = useTranslations("screening.pieces");
  const words = useWords();

  const screen = toDo ? (
    <Button asChild size="sm" variant={finished ? "outline" : "default"}><NextLink href={screenHref(screening.id)}><ListChecks />{t.rich("progress.screen", { count: toDo, num: () => <AnimatedNumber value={toDo} /> })}</NextLink></Button>
  ) : null;
  const removed = removedOf(screening.sources);
  const conflictsButton = conflicts ? (
    <Button asChild size="sm" variant={toDo || finished || !open.canResolve ? "outline" : "default"}><NextLink href={screenHref(screening.id, { queue: "conflicts" })}><GitCompare />{t.rich("progress.conflicts", { settle: String(open.canResolve), count: conflicts, num: () => <AnimatedNumber value={conflicts} /> })}</NextLink></Button>
  ) : null;

  return (
    <Panel tone={tone} className="space-y-4 p-5">
      <Section
        title={t("progress.title")}
        help={
          <Help
            title={t("progress.helpTitle")}
            facts={RESULTS.filter((result) => result !== "conflict" || splitsIn(screening, open.counts.conflict, open.invited)).map((result) => {
              const Icon = RESULT_STYLE[result].icon;
              const text = result === "maybe" ? t("progress.maybeMeans") : result === "conflict" ? t("progress.conflictUntil", { you: String(screening.rule.resolver === open.me), name: words.nameOn(screening, screening.rule.resolver) }) : words.result(result);
              return <HelpFact key={result} icon={Icon}>{text}</HelpFact>;
            })}
          >
            {/* What settles a paper here, said outright: the rule's own name is in the chips over the page, and this must read without them. */}
            <p>{t("progress.settles", { means: settleMeans(words, screening, open.invited) })}</p>
            <p>{t("progress.maybeStays")}</p>
          </Help>
        }
        aside={
          <>
            {screen}
            {conflictsButton}
            {settledAll ? (
              <>
                {/* Offered once there is something in it: with nothing included, the file would be empty. */}
                {counts.include ? <Button variant="outline" size="sm" onClick={() => onExport("papers")}><Download />{t("progress.exportIncluded")}</Button> : null}
                {/* With every paper settled, finishing is the next step for a member. Once it is finished, extracting is. */}
                {counts.include ? <Button asChild size="sm" variant={finishable ? "outline" : "default"}><NextLink href={EXTRACT_HREF} onClick={() => pickForExtraction(workspaceId, screening, counts.include)}><FileSearch />{t("progress.extract")}</NextLink></Button> : null}
                {finishable ? <Button size="sm" onClick={finish}><CircleCheck />{t("progress.finish")}</Button> : null}
              </>
            ) : null}
          </>
        }
      >
        <div className="space-y-3">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-3xl font-semibold tabular-nums tracking-tight"><AnimatedNumber value={total - counts.conflict - counts.waiting} /></span>
            {/* The line under the count: its words and the chips beside them centred on one another, and the whole line on the count's baseline. */}
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm text-muted-foreground">{t("progress.settledOf", { total })}</span>
              {open.modelsNow === "reading" ? <Chip className="bg-card/70"><AiIcon working className="size-3.5" />{MODELS_READING(tp)}</Chip> : null}
              {/* Fewer papers than its sources held asks for a reason where the count is: what was left out, and what two sources both brought. */}
              {!open.gathering && removed.left ? <SettingsChip open={open} part="papers">{t("progress.leftOut", { count: removed.left, bare: String(removed.bare === removed.left) })}</SettingsChip> : null}
              {/* A plan gives one screening so many papers: where a source held more, its reading stopped there, and the way to more is the plan. */}
              {screening.sources.some((source) => source.read?.capped) ? <LinkChip href="/pricing" tone="warning" icon={TriangleAlert}>{t("progress.capped", { workspace: screening.workspace.name, personal: String(screening.workspace.kind === "personal") })}</LinkChip> : null}
              {/* A living source can bring a paper that is only a PDF after the screening started: with models alone that can't read it, it waits for a reviewer. */}
              {unreadPdfs(screening) ? <SettingsChip open={open} part="reviewers" tone="warning" icon={FileText}>{t("progress.pdfsUnread", { count: unreadPdfs(screening) })}</SettingsChip> : null}
              {!open.gathering && removed.merged ? <SettingsChip open={open} part="papers">{t("progress.merged", { count: removed.merged })}</SettingsChip> : null}
            </span>
          </p>
          <ResultBar counts={counts} className="h-3" counted />
          <div className="-mx-2 flex flex-wrap gap-x-1 gap-y-1">
            {/* In conflict is a count only where a paper can be in conflict, or one is. */}
            {RESULTS.filter((result) => result !== "conflict" || splitsIn(screening, counts.conflict, open.invited)).map((result) => {
              const Icon = RESULT_STYLE[result].icon;
              const inner = (
                <>
                  <span className={cn("flex size-6 items-center justify-center rounded-md", RESULT_STYLE[result].chip)}><Icon className="size-3.5" /></span>
                  <span className={cn("font-semibold tabular-nums", TONE[RESULT_STYLE[result].tone].ink, counts[result] > 0 && FIGURE_LINK)}><AnimatedNumber value={counts[result]} /></span>
                  <span className="text-muted-foreground">{words.result(result)}</span>
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
          <Started open={open} />
        </div>
      </Section>
    </Panel>
  );
}

/** Who started the screening, and when, at the foot of its progress. Its workspace is named where it is someone else's or an organization: your own needs no name. */
function Started({ open }: { open: Open }) {
  const { screening } = open;
  const t = useTranslations("screening.overview");
  const words = useWords();
  const starter = personIn(screening, screening.createdBy);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
      <IdentityAvatar name={starter?.name ?? ""} imageUrl={starter?.imageUrl} className="size-6" />
      <span className="flex min-w-0 items-center gap-1"><ReviewerName reviewer={{ kind: "person", name: starter?.name ?? words.t("someone") }} you={screening.createdBy === open.me} className="font-medium" /></span>
      <span className="text-muted-foreground">{t("facts.startedIt", { ago: words.ago(screening.createdAt) })}</span>
      {screening.workspace.kind === "personal" && open.canChange ? null : <WorkspaceTag size="sm" workspace={lookOf(screening.workspace)} />}
    </p>
  );
}

/** Your own votes, each count opening those papers, and the papers of yours that still wait for someone else. */
function Yours({ open }: { open: Open }) {
  const workspaceId = usePageWorkspace();
  // Where a paper waits for more votes than one: how many of the papers you voted on still wait for someone else's. The link to them shows only where there are some, so it never opens an empty list.
  const asked = Boolean(open.counts.waiting && !open.screening.finishedAt && splitsIn(open.screening, 0, open.invited));
  const yourCounts = useProtectedQuery(api.screening.paperViews.counts, inWorkspace(workspaceId, asked ? { jobId: open.screening.id, reviewer: open.me } : "skip")).data;
  const stillWaiting = yourCounts?.waiting ?? 0;
  const { screening } = open;
  const t = useTranslations("screening.overview");
  const mine = screening.reviewers.find((one) => one.id === open.me)?.tally;
  if (!mine?.cast) return null;
  // Where the line under the votes wraps (a phone), its arrival slides the panel open rather than pushing what is below.
  return (
    <AutoHeight>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-card/70 px-3 py-2 text-sm">
      <span className="font-medium">{t("yours.votes", { count: mine.cast })}</span>
      <span className="flex items-center gap-1">
        {DECISIONS.map((decision) => {
          const n = mine[decision];
          const Icon = RESULT_STYLE[decision].icon;
          return n ? (
            <NextLink key={decision} href={papersHref(screening.id, { voted: decision })} aria-label={t("yours.voted", { decision, count: n })} className={cn("flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium tabular-nums", TONE[RESULT_STYLE[decision].tone].ink, ROW_LINK)}>
              <span className={cn("flex size-4 items-center justify-center rounded", RESULT_STYLE[decision].chip)}><Icon className="size-2.5" /></span>
              <span className={FIGURE_LINK}>{n}</span>
            </NextLink>
          ) : null;
        })}
      </span>
      {/* The papers of theirs that still wait for someone else, where a paper waits for more votes than one: never where the first vote, or a person's alone, settles it. */}
      {asked && stillWaiting ? <NextLink href={papersHref(screening.id, { reviewer: open.me, result: "waiting" })} className={cn(INLINE_LINK, "min-w-0 font-normal text-muted-foreground animate-in fade-in")}>{t("yours.stillWaitCount", { count: stillWaiting })}</NextLink> : null}
    </div>
    </AutoHeight>
  );
}

// ── Reviewers ────────────────────────────────────────────────────────────────────────────────────


/** A count that opens the part of the settings it comes from, for whoever may open them: its workspace's members. For anyone else it is the count alone, and leads nowhere they can't go. */
function SettingsChip({ open, part, ...chip }: { open: Open; part: "papers" | "reviewers" } & Omit<ComponentProps<typeof LinkChip>, "href">) {
  return open.canChange ? <LinkChip href={settingsHref(open.screening.id, part)} {...chip} /> : <StateChip tone={chip.tone ?? "neutral"} icon={chip.icon} className={chip.className}>{chip.children}</StateChip>;
}

/**
 * The columns of the Reviewers table. On a phone a row is two lines of its own, the name alone on the first. Wider,
 * the table holds the columns and every row takes them from it, so a column is as wide as its heading needs in
 * whichever language: "Include" and "Agrees with people" are longer words in most. A name the wider headings
 * leave less room for runs onto a second line.
 */
const TABLE = "@2xl/reviewers:grid @2xl/reviewers:gap-x-3 @2xl/reviewers:grid-cols-[minmax(11rem,1.2fr)_minmax(8.75rem,0.7fr)_repeat(3,minmax(3.25rem,auto))_fit-content(10.5rem)_2rem]";
/** A part of the table that spans it: a group of rows, or a line that isn't cut into the columns. */
const ACROSS = "@2xl/reviewers:col-span-full";
const SHARED = "@2xl/reviewers:col-span-full @2xl/reviewers:grid @2xl/reviewers:grid-cols-subgrid";
// On a narrow card what is said in the second column takes at most 60% of the row and wraps, so it never runs over how far the reviewer is, in the first.
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_fit-content(60%)_2rem] items-center gap-x-4 gap-y-2 px-4 @2xl/reviewers:col-span-full @2xl/reviewers:grid-cols-subgrid @2xl/reviewers:gap-x-3";

function Reviewers({ open, figures, now }: { open: Open; figures: Figures | undefined; now: number }) {
  const { screening, counts } = open;
  const t = useTranslations("screening.overview");
  const words = useWords();
  const format = useFormatter();
  const [{ sort }, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  // Taking someone off asks first, in the one confirmation the frame opens for it.
  const { takeOff } = useWorkspace();
  // The person some papers are being moved from, while that is being set up.
  // Moving someone's papers opens over the page as the screening's other dialogs do: a step in the history, with whose papers they are.
  const [moving, setMoving] = useOpenInAddress("moveFrom", null);
  const reviewers = inOrder(activeReviewers(screening), open.me);
  const isPerson = new Set(screening.reviewers.filter((one) => one.kind === "person").map((one) => one.id));
  const rows: ReviewerRowData[] = reviewers.map((reviewer) => {
    const tally = reviewer.tally;
    // A vote is compared with each person's on the same paper, and never with a model's: every pair of votes on a paper both voted on, and how many of them are the same.
    const withPeople = (figures?.pairs ?? []).filter((pair) => (pair.a === reviewer.id && isPerson.has(pair.b)) || (pair.b === reviewer.id && isPerson.has(pair.a)));
    const compared = withPeople.reduce((sum, pair) => sum + pair.matrix.reduce((all, n) => all + n, 0), 0);
    // Where the share rests on one other person it opens the papers the two voted on; on more, the comparison pair by pair.
    const other = withPeople.length === 1 ? (withPeople[0]!.a === reviewer.id ? withPeople[0]!.b : withPeople[0]!.a) : null;
    const agreesHref = other ? papersHref(screening.id, { reviewer: reviewer.id, with: other, sort: "split" }) : "#agreement";
    const same = withPeople.reduce((sum, pair) => sum + SAME.reduce((all, cell) => all + pair.matrix[cell]!, 0), 0);
    const left = tally?.waiting ?? 0;
    // A person's pace is what they voted on in the last three days. There is a pace to go by once they have been on it a day: five votes in the first five minutes say nothing about the weeks to come.
    const perDay = reviewer.kind === "person" && Math.max(reviewer.addedAt, screening.createdAt) < now - DAY ? (figures?.recent[reviewer.id] ?? 0) / PACE_DAYS : 0;
    return {
      reviewer,
      // The papers that are theirs to vote on, and the ones they have got through. A paper a model got to and couldn't read is one it is through with: it is counted here, and named on a line of its own under the row.
      assigned: theirsOf(tally),
      done: gotThrough(tally),
      split: DECISIONS.map((decision) => tally?.[decision] ?? 0),
      agrees: compared ? same / compared : null,
      agreesHref,
      known: figures !== undefined,
      compared,
      missed: tally?.missed ?? 0,
      // Out of every included paper, the number Progress shows: one it never voted on is one it didn't exclude.
      included: counts.include,
      left,
      perDay,
      // Nothing voted in three days by someone who has been on the screening that long.
      idle: Boolean(figures) && left > 0 && perDay === 0 && Math.max(reviewer.addedAt, screening.createdAt) < now - PACE_DAYS * DAY,
    };
  });
  type Row = (typeof rows)[number];
  const by = (row: Row) => (sort === "voted" ? row.done / Math.max(row.assigned, 1) : (row.agrees ?? -1));
  const ordered = (list: Row[]) => (sort ? [...list].sort((a, b) => by(b) - by(a)) : list);
  const groups = [
    { label: t("reviewers.people"), rows: ordered(rows.filter((row) => row.reviewer.kind === "person")) },
    { label: t("reviewers.models"), rows: ordered(rows.filter((row) => row.reviewer.kind === "model")) },
  ].filter((group) => group.rows.length);
  // Who papers can be moved from: a person with papers left that someone else doesn't have. Where every person reads every paper there is nobody to move one to.
  const takers = rows.filter((row) => row.reviewer.kind === "person" && !row.reviewer.email);
  const gone = screening.reviewers.filter((one) => one.left && !one.email).map((reviewer) => ({ reviewer, cast: reviewer.tally?.cast ?? 0 }));
  const stillVoting = takers.filter((row) => row.left > 0);
  // Said where there is more than one person: for one alone, their own row says it.
  const everyoneDone = !screening.finishedAt && takers.length > 1 && stillVoting.length > 0 && stillVoting.every((row) => row.perDay > 0) ? t("reviewers.everyoneDone", daysFrom(Math.max(...stillVoting.map((row) => Math.ceil(row.left / row.perDay))))) : null;
  const { people: readers, each } = readersOf(screening, open.invited);
  const people = readers.length;
  // Where every person reads every paper, everyone already has the papers there are to move.
  const givers = open.canChange && !screening.finishedAt && each < people ? takers.filter((row) => row.left > 0) : [];
  // With two reviewers there is one pair, so its figure sits in this section's head instead of a section of its own.
  const [a, b] = reviewers;
  const pair = reviewers.length === 2 ? pairOf(figures, b!.id, a!.id) : null;

  // A column the table can be ordered by: highest first, and a second press puts the table back as it was.
  const sortable = (id: "voted" | "agrees", label: string) => (
    <button type="button" onClick={() => void setPlace({ sort: sort === id ? null : id })} className={cn("flex items-center gap-1 rounded-md outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50", sort === id && "font-medium text-foreground")}>
      {label}
      {sort === id ? <ArrowDown aria-hidden className="size-3.5 shrink-0" /> : <ArrowUpDown aria-hidden className="size-3 shrink-0 opacity-40" />}
    </button>
  );

  return (
    <Section
      id="reviewers"
      title={t("reviewers.title")}
      help={
        <Help title={t("reviewers.helpTitle")} facts={<>{each ? <HelpFact>{each < people ? t("reviewers.eachOf", { each, people }) : t("reviewers.everyPerson")}</HelpFact> : null}{modelsOf(screening).length ? <HelpFact>{t("reviewers.modelsRead")}</HelpFact> : null}</>}>
          <p>{t("reviewers.sharing", { share: String(each < people), models: String(modelsOf(screening).length > 0) })}</p>
          <p>{t("reviewers.pace")}</p>
        </Help>
      }
      aside={
        <>
        {/* When the last of the people gets through their papers, where each of them has a pace to go by: what moving papers brings forward. */}
        {everyoneDone ? <span className="text-xs tabular-nums text-muted-foreground">{everyoneDone}</span> : null}
        {/* Evening out the work: the person with the most left is offered first. */}
        {givers.length ? <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setMoving([...givers].sort((x, y) => y.left - x.left)[0]!.reviewer.id)}><Move />{t("reviewers.move")}</Button> : null}
        {pair ? (
          <span className="flex items-center gap-1">
            <NextLink href={pairHref(screening.id, b!, a!)} className={cn("flex items-center gap-2 px-2 py-1 text-sm", ROW_LINK)}>
              <span className="text-muted-foreground">{t("reviewers.agreement")}</span>
              <span className="rounded-md px-2 py-0.5 font-semibold tabular-nums" style={{ backgroundColor: shade(pair.kappa) }}>{kappaText(format, pair.kappa, t("kappa.none"))}</span>
              <span className="tabular-nums text-muted-foreground">{sameText(t, pair)}</span>
            </NextLink>
            <KappaHelp />
          </span>
        ) : null}
        </>
      }
    >
      {rows.length || open.invited.length || gone.length ? (
        <div className="@container/reviewers">
        <div role="table" aria-label={t("reviewers.title")} className={cn(LIST, TABLE, "overflow-clip")}>
          <div role="row" className={cn(COLUMNS, "sticky top-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+var(--screening-frame,0px))] z-10 whitespace-nowrap bg-card py-2 text-xs text-muted-foreground @max-2xl/reviewers:hidden")}>
            <span role="columnheader">{t("reviewers.reviewer")}</span>
            <span role="columnheader" aria-sort={sort === "voted" ? "descending" : "none"}>{sortable("voted", t("reviewers.votedOn"))}</span>
            {DECISIONS.map((decision) => { const Icon = RESULT_ICON[decision]; return <span key={decision} role="columnheader" className="flex justify-end">{/* A word may reach a little into the space before its column, as "Include" does: a longer one widens the column while there is room, and breaks onto a second line where there isn't, so the names keep theirs. */}<span className="-ms-2 flex items-center gap-1 whitespace-normal hyphens-auto text-end"><Icon className="size-3.5 shrink-0" />{words.decision(decision)}</span></span>; })}
            <span role="columnheader" aria-sort={sort === "agrees" ? "descending" : "none"} className="flex items-center justify-end gap-0.5">
              {sortable("agrees", t("reviewers.agrees"))}
              <Help title={t("reviewers.agrees")} side="bottom" facts={<><HelpFact>{t("reviewers.agreesPerson")}</HelpFact><HelpFact>{t("reviewers.agreesModel")}</HelpFact></>}>
                <p>{t("reviewers.agreesMeans")}</p>
                <p>{t("reviewers.agreesMissed")}</p>
              </Help>
            </span>
            <span role="columnheader"><span className="sr-only">{t("reviewers.actions")}</span></span>
          </div>
          {groups.map((group) => (
            <div key={group.label} role="rowgroup" className={cn(SHARED, "divide-y divide-border-subtle border-t border-border-subtle first:border-t-0")}>
              <div role="row" className={cn(ACROSS, "flex items-center gap-2 bg-inset px-4 py-1.5 text-xs font-medium")}>
                <span role="cell">{group.label} <span className="font-normal tabular-nums text-muted-foreground">{group.rows.length}</span></span>
              </div>
              {group.rows.map((row) => <ReviewerRow key={row.reviewer.id} open={open} row={row} onLeave={takeOff} onMove={givers.includes(row) ? () => setMoving(row.reviewer.id) : undefined} />)}
            </div>
          ))}
          {/* Whoever was invited by email to vote and has yet to answer: counted among its people, and no reviewer until they join. */}
          {open.invited.length ? (
            <div role="rowgroup" className={cn(ACROSS, "divide-y divide-border-subtle border-t border-border-subtle")}>
              <div role="row" className="flex items-center gap-2 bg-inset px-4 py-1.5 text-xs font-medium">
                <span role="cell">{t("reviewers.invited")} <span className="font-normal tabular-nums text-muted-foreground">{open.invited.length}</span></span>
              </div>
              {open.invited.flatMap((one) => (one.email ? [{ email: one.email }] : [])).map((one) => (
                <div key={one.email} role="row" className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  {/* The address and what waiting means stack under each other on a phone, so the address keeps the row's width. */}
                  <span role="cell" className="flex min-w-0 flex-1 items-center gap-3">
                    <ReviewerMark reviewer={{ kind: "person", name: one.email, email: one.email }} className="size-8" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{one.email}</span>
                      <span className="text-xs text-muted-foreground sm:shrink-0 sm:text-end">{words.t(screening.finishedAt ? "person.invitedFinished" : "person.invited")}</span>
                    </span>
                  </span>
                </div>
              ))}
              {/* A guest is told how many, and never whose address. */}
              {open.invited.some((one) => !one.email) ? (
                <div role="row" className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span role="cell" className="flex min-w-0 flex-1 items-center gap-3">
                    <ReviewerMark reviewer={{ kind: "person", name: "", email: "invited" }} className="size-8" />
                    <span className="min-w-0 text-muted-foreground">{t("reviewers.invitedCount", { count: open.invited.filter((one) => !one.email).length, finished: String(Boolean(screening.finishedAt)) })}</span>
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
          {/* Whoever was taken off, and what became of their votes: results can rest on votes from someone no longer in the lists above. */}
          {gone.length ? (
            <div role="rowgroup" className={cn(ACROSS, "divide-y divide-border-subtle border-t border-border-subtle")}>
              <div role="row" className="flex items-center gap-2 bg-inset px-4 py-1.5 text-xs font-medium">
                <span role="cell">{t("reviewers.takenOff")} <span className="font-normal tabular-nums text-muted-foreground">{gone.length}</span></span>
              </div>
              {gone.map(({ reviewer, cast }) => (
                <div key={reviewer.id} role="row" className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span role="cell" className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex opacity-55"><ReviewerMark reviewer={reviewer} className="size-8" /></span>
                    <span className="min-w-0 truncate font-medium">{reviewer.name}</span>
                  </span>
                  <span role="cell" className="shrink-0 text-xs tabular-nums text-muted-foreground">{reviewer.discarded ? t("reviewers.thrownOut") : cast ? t("reviewers.stillCount", { count: cast }) : t("reviewers.castNone")}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        </div>
      ) : (
        <EmptyNote>{t("reviewers.nobody", { change: String(open.canChange && !screening.finishedAt) })}</EmptyNote>
      )}
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
  const workspaceId = usePageWorkspace();
  const t = useTranslations("screening.overview");
  const words = useWords();
  const giver = people.find((row) => row.reviewer.id === from) ?? people[0]!;
  const others = people.filter((row) => row !== giver);
  // Whoever has the least left is offered first.
  const picked = others.find((row) => row.reviewer.id === chosen) ?? [...others].sort((x, y) => x.left - y.left)[0];
  // How many of the giver's papers the taker doesn't already have: counted by the server for the two of them.
  const counted = useProtectedQuery(api.screening.reviewers.movable, inWorkspace(workspaceId, picked && giver.reviewer.row && picked.reviewer.row ? { jobId: open.screening.id, from: giver.reviewer.row, to: picked.reviewer.row } : "skip")).data;
  const can = counted?.count;
  const taker = picked && can ? { row: picked, can } : undefined;
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
  const nameOf = (row: ReviewerRowData) => words.youOr(row.reviewer, open.me);
  const isMe = (row: ReviewerRowData) => row.reviewer.id === open.me;
  const load = (row: ReviewerRowData, after: number) => (
    // When they would be done goes under the name, as on the reviewers' rows, so the name keeps the row's width in a narrow dialog.
    <div key={row.reviewer.id} className="flex items-center gap-2.5 px-3 py-2.5 text-sm">
      <ReviewerMark reviewer={row.reviewer} className="size-7 self-start" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium [overflow-wrap:anywhere]">{nameOf(row)}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{doneIn(t, after, row.perDay) ?? (!after ? t("move.nothingLeft") : row.idle ? t("row.idle") : null)}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 tabular-nums"><span className="text-muted-foreground">{t("move.left", { count: row.left })}</span><ArrowRight aria-hidden className="size-3.5 text-muted-foreground" /><span className="font-semibold">{t("move.left", { count: after })}</span></span>
    </div>
  );
  return (
    <ConfirmChange open title={t("move.title")} confirm={taker ? t("move.confirm", { count: papers }) : t("move.confirmBare")} disabled={!taker} onClose={onClose} onConfirm={() => void (taker && open.move(giver.reviewer, taker.row.reviewer, papers).catch((error) => notSaved(t, error)))}>
      <div className="flex flex-wrap items-center gap-2">
        <FilterMenu name={t("move.from")} value={giver.reviewer.id} onChange={(next) => { setFrom(next); setChosen(null); setAsked(null); }} narrows={false} className="h-8 rounded-full px-3.5 text-xs" choices={people.filter((row) => row.left > 0).map((row) => ({ value: row.reviewer.id, label: nameOf(row), icon: face(row), count: row.left }))} />
        {picked ? <FilterMenu name={t("move.to")} value={picked.reviewer.id} onChange={(next) => { setChosen(next); setAsked(null); }} narrows={false} className="h-8 rounded-full px-3.5 text-xs" choices={others.map((row) => ({ value: row.reviewer.id, label: nameOf(row), icon: face(row), count: row.left }))} /> : null}
      </div>
      {taker ? (
        <>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 text-sm"><span id="move-how-many" className="font-medium">{t("move.howMany")}</span><span className="tabular-nums text-muted-foreground">{t.rich("move.ofMost", { papers, most, you: String(isMe(taker.row)), name: firstName(taker.row.reviewer.name), b: (chunks) => <span className="text-base font-semibold text-foreground">{chunks}</span> })}</span></div>
            <Slider aria-labelledby="move-how-many" min={1} max={Math.max(most, 1)} step={1} value={[papers]} onValueChange={([next]) => setAsked(next ?? 1)} disabled={most <= 1} />
          </div>
          <div className={cn(LIST, "divide-y divide-border-subtle")}>
            {load(giver, giver.left - papers)}
            {load(taker.row, taker.row.left + papers)}
          </div>
          {/* What the move does to the day the last of them is done, where every one of them has a pace to go by. */}
          {doneAfter && doneBefore ? <p className="text-sm tabular-nums">{t.rich("move.doneAfter", { same: String(doneAfter === doneBefore), afterDays: daysFrom(doneAfter).days, afterWeeks: daysFrom(doneAfter).weeks, beforeDays: daysFrom(doneBefore).days, beforeWeeks: daysFrom(doneBefore).weeks, b: (chunks) => <span className="font-medium">{chunks}</span>, muted: (chunks) => <span className="text-muted-foreground">{chunks}</span> })}</p> : null}
          <p className="text-sm text-muted-foreground">{t("move.startsAt", { you: String(isMe(giver)), name: firstName(giver.reviewer.name) })}</p>
        </>
      ) : can === undefined ? (
        // While the two are counted, the dialog keeps the room the count will take.
        <div aria-hidden className="h-40" />
      ) : (
        <EmptyNote>{picked && counted && !counted.whole ? t("move.noneNear", { giverYou: String(isMe(giver)), giver: firstName(giver.reviewer.name), takerYou: String(isMe(picked)), taker: firstName(picked.reviewer.name) }) : picked ? t("move.hasAll", { takerYou: String(isMe(picked)), taker: firstName(picked.reviewer.name), giverYou: String(isMe(giver)), giver: firstName(giver.reviewer.name) }) : t("move.nobodyElse")}</EmptyNote>
      )}
    </ConfirmChange>
  );
}

type ReviewerRowData = { reviewer: Reviewer; assigned: number; done: number; split: number[]; agrees: number | null; /** Where the share opens: the papers it rests on, or the comparison pair by pair. */ agreesHref: string; /** The figures agreement is counted from have arrived: until then there is no "nothing to compare". */ known: boolean; compared: number; missed: number; included: number; left: number; perDay: number; idle: boolean };
/** When someone gets through so many papers at their pace, in days from now, or nothing where they have no pace to go by. It is said as a day to come ("done in"), so it never reads as Screen's count of the minutes the papers themselves take. */
const doneIn = (t: T, left: number, perDay: number) => (left <= 0 || perDay <= 0 ? null : t("move.doneIn", daysFrom(Math.ceil(left / perDay))));
/** A number of days as a message says it: a day, so many days, or so many weeks from two weeks on. */
const daysFrom = (days: number) => ({ days, weeks: days < 14 ? 0 : Math.round(days / 7) });

/** One reviewer: the whole row opens the papers they voted on, and each count opens its own. */
function ReviewerRow({ open, row, onLeave, onMove }: { open: Open; row: ReviewerRowData; onLeave: (reviewer: Reviewer) => void; /** Opens the move of some of this person's papers to someone else, where they have papers that can go. */ onMove?: () => void }) {
  const { screening } = open;
  const { reviewer, assigned, done, split, agrees, agreesHref, known, compared, missed, included, left, perDay, idle } = row;
  const t = useTranslations("screening.overview");
  const tp = useTranslations("screening.pieces");
  const words = useWords();
  // The people there are to compare a vote with: none, where it is the only person or a model with no people beside it.
  const peopleOn = readersOf(screening).people.length;
  const takes = doneIn(t, left, perDay);
  const id = screening.id;
  const unread = reviewer.kind === "model" ? (reviewer.tally?.failed ?? 0) : 0;
  const reading = reviewer.kind === "model" && left > 0 && !screening.finishedAt;
  // A model is given none of the papers that are only a PDF it can't read: its row says so, where it would otherwise look as if it had read everything.
  const notGiven = reviewer.kind === "model" && reviewer.model ? pdfsMissed(reviewer.model, pdfsOf(screening.sources)) : null;
  const retry = open.retryOf(reviewer);
  const heldBy = open.modelsNow && open.modelsNow !== "reading" ? open.modelsNow : null;
  const held = heldBy ? MODELS_SAY[heldBy] : null;
  const mine = reviewer.id === open.me;
  // Above the row's own link, so a count or a menu opens itself and not the row.
  const above = "relative z-[1]";
  const papersAt = reviewerHref(id, reviewer);
  return (
    <div role="row" className={cn(COLUMNS, "relative py-3 transition-colors hover:bg-muted/40")}>
      <div role="cell" className="flex min-w-0 items-start gap-3 @max-2xl/reviewers:col-span-2">
        <ReviewerMark reviewer={reviewer} className="size-8" />
        <div className="min-w-0">
          {/* Someone with no paper to open yet (just added, nothing dealt) is named, not linked: their list would be empty. */}
          {papersAt ? (
            <NextLink href={papersAt} className="flex min-w-0 text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline">
              <ReviewerName reviewer={reviewer} you={mine} wrap />
            </NextLink>
          ) : (
            <span className="flex min-w-0 text-sm font-medium"><ReviewerName reviewer={reviewer} you={mine} wrap /></span>
          )}
          {reviewer.kind === "model" ? (
            <p className={cn("flex min-w-0 items-center gap-1 text-xs tabular-nums", reading && held?.stop ? "ink-warning" : "text-muted-foreground")}>
              {reading ? (held ? <held.icon className="size-3.5 shrink-0" /> : <AiIcon working className="size-3.5 shrink-0" />) : <Coins className="size-3.5 shrink-0" />}
              <span className="truncate">{reading ? (heldBy ? tp(`modelsSay.${heldBy}.row`) : t("row.reading")) : t("row.creditsSpent", { credits: words.creditsOf(open.spent(reviewer)) })}</span>
            </p>
          ) : (
            <p className="truncate text-xs text-muted-foreground">{reviewer.email ? words.t("person.invited") : assigned && done === assigned ? t("row.done") : reviewer.reminded ? t("row.reminded", { ago: words.ago(reviewer.reminded) }) : mine && !screening.finishedAt ? t("row.activeNow") : t("row.added", { ago: words.ago(reviewer.addedAt) })}</p>
          )}
        </div>
      </div>
      <div role="cell" className="min-w-0 @max-2xl/reviewers:col-start-1 @max-2xl/reviewers:row-start-2">
        <div className="flex items-center gap-3">
          <Meter value={done} max={Math.max(assigned, 1)} fill={assigned && done === assigned ? "bg-success" : "bg-foreground/45"} />
          {papersAt ? <NextLink href={papersAt} className={cn(above, "-mx-1.5 shrink-0 whitespace-nowrap px-1.5 py-0.5 text-end text-xs tabular-nums text-muted-foreground @2xl/reviewers:w-[4.75rem]", ROW_LINK, "hover:bg-muted hover:text-foreground")}><span className={FIGURE_LINK}>{/* While its papers are still being read from their sources nobody has any yet: "0 of 0" would say it never will. */}{open.gathering && !assigned ? t("row.arriving") : t.rich("row.doneOf", { done, assigned, num: () => <AnimatedNumber value={done} /> })}</span></NextLink> : <span className="-mx-1.5 shrink-0 whitespace-nowrap px-1.5 py-0.5 text-end text-xs tabular-nums text-muted-foreground @2xl/reviewers:w-[4.75rem]"><span className={FIGURE_LINK}>{/* While its papers are still being read from their sources nobody has any yet: "0 of 0" would say it never will. */}{open.gathering && !assigned ? t("row.arriving") : t.rich("row.doneOf", { done, assigned, num: () => <AnimatedNumber value={done} /> })}</span></span>}
        </div>
        {/* When a person gets through what they have left, at the pace of their last three days: a second line, as a model has for what it couldn't read. */}
        {reviewer.kind === "person" && !reviewer.email && left > 0 && !screening.finishedAt ? (
          takes ? (
            <p className="flex items-center gap-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground"><Clock className="size-3.5 shrink-0" />{takes}</p>
          ) : idle ? (
            <p className="flex items-center gap-1 whitespace-nowrap text-xs ink-warning"><Hourglass className="size-3.5 shrink-0" />{t("row.idle")}</p>
          ) : null
        ) : null}
        {/* The papers it got to and couldn't read, under how many it read: a second line that, with the count over it, is no taller than the name and its credits, so a paper that fails while it reads moves nothing. It has no margin of its own for that reason, and neither has a person's second line. */}
        {unread ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className={cn(above, "flex h-4 w-fit gap-1 rounded px-1.5 text-xs bg-destructive/10 ink-destructive hover:bg-destructive/15")} aria-label={t("row.unreadLabel", { count: unread })}>{t("row.unread", { count: unread })}<ChevronDown aria-hidden className="size-3.5 opacity-60" /></Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex max-h-[min(26rem,var(--radix-popover-content-available-height))] w-80 flex-col gap-2.5 p-3 text-sm">
              <p>{t("row.unreadSays", { count: unread })}</p>
              <Unread open={open} model={reviewer} />
              {open.canChange && !screening.finishedAt ? <RetryRead papers={unread} cost={words.creditsOf(retry.cost)} short={retry.short ? words.creditsOf(retry.short) : undefined} onRetry={() => void open.retry(reviewer).catch((error) => notSaved(t, error))} variant="default" size="sm" className="shrink-0" /> : null}
            </PopoverContent>
          </Popover>
        ) : null}
        {notGiven?.papers ? <p className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"><FileText className="size-3.5 shrink-0" />{notGiven.why === "text" ? t("row.notGivenText", { count: notGiven.papers }) : t("row.notGivenLong", { count: notGiven.papers })}</p> : null}
      </div>
      {/* How someone else voted is kept from a reviewer who still has papers to vote on: their own row, and how far each of the others is, say everything else. */}
      {reviewer.tally?.kept ? (
        <div role="cell" className="col-span-4 flex justify-end @max-2xl/reviewers:col-span-2 @max-2xl/reviewers:col-start-2 @max-2xl/reviewers:row-start-2">
          <Chip icon={Lock} className={SENTENCE_CHIP}>{words.t("hiddenWhileToDo")}</Chip>
        </div>
      ) : (
      <>
      {DECISIONS.map((decision, i) => {
        const Icon = RESULT_STYLE[decision].icon;
        const inner = (
          <>
            <span className={cn("flex size-4 items-center justify-center rounded", RESULT_STYLE[decision].chip)}><Icon className="size-2.5" /></span>
            <span className={cn(split[i] ? cn("font-medium", TONE[RESULT_STYLE[decision].tone].ink, FIGURE_LINK) : undefined)}>{split[i]}</span>
          </>
        );
        return (
          <div key={decision} role="cell" className="flex justify-end @max-2xl/reviewers:hidden">
            {split[i] ? (
              <NextLink href={papersHref(id, { reviewer: reviewer.id, voted: decision })} aria-label={t("row.voted", { decision, count: split[i]! })} className={cn(above, "flex items-center gap-1 px-1.5 py-0.5 text-xs tabular-nums", ROW_LINK, "hover:bg-muted")}>{inner}</NextLink>
            ) : (
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground opacity-60">{inner}</span>
            )}
          </div>
        );
      })}
      {/* The share goes to the comparison it is drawn from, pair by pair: the rest of the row opens the reviewer's votes. */}
      <div role="cell" className="min-w-0 text-end @max-2xl/reviewers:col-span-2 @max-2xl/reviewers:col-start-2 @max-2xl/reviewers:row-start-2">
        <p className="text-sm font-semibold tabular-nums">{agrees === null && !known ? <span aria-hidden className="invisible">0%</span> : agrees === null ? <span className="font-normal text-muted-foreground">{peopleOn - (reviewer.kind === "person" ? 1 : 0) < 1 ? (open.invited.length ? t("row.untilInvitedJoin", { count: open.invited.length }) : reviewer.kind === "person" ? t("row.noOtherPerson") : t("row.noPeople")) : t("row.nothingYet")}</span> : <NextLink href={agreesHref} className={cn(above, "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50", FIGURE_LINK)}>{t.rich("row.agrees", { share: agrees, person: String(reviewer.kind === "person"), muted: (chunks) => <span className="font-normal text-muted-foreground @2xl/reviewers:hidden">{chunks}</span> })}</NextLink>}</p>
        {/* How many pairs of votes the share rests on, a model's as a person's: a share of two votes reads as one. */}
        {agrees !== null && reviewer.kind === "model" && included ? <p className="text-xs tabular-nums text-muted-foreground">{t("row.ofPairs", { count: compared })}</p> : null}
        {reviewer.kind === "model" && included ? (
          missed ? (
            <NextLink href={papersHref(id, { reviewer: reviewer.id, voted: "exclude", result: "include" })} className={cn(above, FIGURE_LINK, "block text-xs tabular-nums ink-destructive")}>{t("row.missedOf", { missed, included })}</NextLink>
          ) : (
            <p className="text-xs tabular-nums text-muted-foreground">{t("row.missedOf", { missed: 0, included })}</p>
          )
        ) : agrees !== null ? (
          <p className="text-xs tabular-nums text-muted-foreground">{t("row.ofPairs", { count: compared })}</p>
        ) : null}
      </div>
      </>
      )}
      <div role="cell" className="@max-2xl/reviewers:col-start-3 @max-2xl/reviewers:row-start-1">
        {open.canChange ? (
          <DropdownMenu>
            <TooltipHint label={t("row.more")}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className={cn(above, "size-8 text-muted-foreground")} aria-label={t("row.moreFor", { name: reviewer.name })}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
            </TooltipHint>
            <DropdownMenuContent align="end" className="w-auto min-w-56 [&_[role=menuitem]]:whitespace-nowrap">
              {done && papersAt ? <DropdownMenuItem asChild><NextLink href={papersAt}><ListChecks />{t("row.seeVotes", { mine: String(mine) })}</NextLink></DropdownMenuItem> : null}
              {unread && !screening.finishedAt ? <DropdownMenuItem disabled={Boolean(retry.short)} onSelect={() => void open.retry(reviewer).catch((error) => notSaved(t, error))}><RotateCcw />{retryLabel(tp, unread, words.creditsOf(retry.cost))}{retry.short ? <span className="ms-auto ps-3 text-xs ink-warning">{t("row.creditsShort", { credits: words.creditsOf(retry.short) })}</span> : null}</DropdownMenuItem> : null}
              {reviewer.kind === "person" && !mine && left ? (
                <DropdownMenuItem onSelect={() => void open.remind(reviewer).catch((error) => notSaved(t, error))}><Mail />{t("row.remind")}</DropdownMenuItem>
              ) : null}
              {onMove ? <DropdownMenuItem onSelect={onMove}><Move />{t("row.moveAway")}</DropdownMenuItem> : null}
              <DropdownMenuItem variant="destructive" onSelect={() => onLeave(reviewer)}><Trash2 />{t("row.takeOff", { mine: String(mine) })}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

/** Papers one page of what a model couldn't read holds. */
const UNREAD_PAGE = 8;
/** The papers a model got to and couldn't read, a page at a time: each opens on the Papers page. */
function Unread({ open, model }: { open: Open; model: Reviewer }) {
  const id = open.screening.id;
  const t = useTranslations("screening.overview");
  // A popover's pages are its own, as a menu's choices are: not steps in the history.
  const papers = useCursorPage(api.screening.paperViews.list, inWorkspace(usePageWorkspace(), { jobId: id, reviewer: model.id, voted: "failed" as const }), UNREAD_PAGE);
  // Until the first page comes, a row holds the place of each paper it will show: the count is known already.
  const coming = papers.isLoading ? Math.min(model.tally?.failed ?? 1, UNREAD_PAGE) : 0;
  return (
    <>
      <ScrollArea shades className="-mx-1 min-h-10 flex-1">
        <ul className={cn("space-y-0.5 transition-opacity", papers.isStale && "opacity-60")}>
          {/* Each row holds two lines, the most a title takes here, loaded or not: a long title never moves what is under the list. */}
          {Array.from({ length: coming }, (_, at) => <li key={`coming-${at}`} aria-hidden className="min-h-10 space-y-1 px-1 py-1"><SkeletonBar className="h-3.5 w-11/12" /><SkeletonBar className="h-3.5 w-3/5" /></li>)}
          {papers.items.map((paper) => (
            <li key={paper.id} className="min-h-10"><NextLink href={papersHref(id, { paper: paper.id })} className={cn("block px-1 py-1 text-xs", ROW_LINK)}><span dir="auto" className="line-clamp-2">{paper.title}{paper.year === undefined ? "" : ` (${paper.year})`}</span></NextLink></li>
          ))}
        </ul>
      </ScrollArea>
      {/* The pager stands from the first frame where the count says there is more than a page. */}
      {papers.hasPages || (papers.isLoading && (model.tally?.failed ?? 0) > UNREAD_PAGE) ? <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><Button variant="ghost" size="xs" disabled={!papers.canPrevious} onClick={papers.previous}>{t("unread.earlier")}</Button><Button variant="ghost" size="xs" disabled={!papers.canNext} onClick={papers.next}>{t("unread.more")}</Button></div> : null}
    </>
  );
}

// ── Agreement ────────────────────────────────────────────────────────────────────────────────────

/** Cohen's kappa in four bands, from below chance-corrected fair agreement up to almost perfect. */
const BANDS = [
  { says: "below", from: 0, to: 0.4, kappa: 0.2 },
  { says: "between", from: 0.4, to: 0.6, kappa: 0.5 },
  { says: "between", from: 0.6, to: 0.8, kappa: 0.7 },
  { says: "above", from: 0.8, to: 1, kappa: 0.9 },
] as const;
const shade = (kappa: number | null) => (kappa === null ? "var(--muted)" : kappa < 0.4 ? "color-mix(in oklab, var(--destructive) 16%, transparent)" : kappa < 0.6 ? "color-mix(in oklab, var(--warning) 22%, transparent)" : `color-mix(in oklab, var(--success) ${Math.round(18 + Math.max(0, Math.min(1, (kappa - 0.6) / 0.4)) * 42)}%, transparent)`);
/** The papers two reviewers both voted on, the ones they split on first. */
const pairHref = (id: string, a: Reviewer, b: Reviewer) => papersHref(id, { reviewer: a.id, with: b.id, sort: "split" });
/** How often two reviewers voted the same, with the papers that is of: a share with nothing to be a share of says little. */
const sameText = (t: T, pair: { same: number; papers: number }) => t("agreement.sameOf", { share: pair.same, count: pair.papers });
/** A kappa as it is read, to two places: "0.62". */
/** A kappa as a figure, or what stands for one where every vote was the same and it has no value. */
const kappaText = (format: ReturnType<typeof useFormatter>, kappa: number | null, none: string) => (kappa === null ? none : format.number(kappa, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
function KappaHelp() {
  const t = useTranslations("screening.overview.kappa");
  return (
    <Help title={t("title")} facts={<><HelpFact>{t("full")}</HelpFact><HelpFact>{t("substantial")}</HelpFact><HelpFact>{t("chance")}</HelpFact><HelpFact>{t("worse")}</HelpFact><HelpFact>{t("noneFact")}</HelpFact></>}>
      <p>{t("means")}</p>
      <p>{t("swings")}</p>
    </Help>
  );
}

/** How far each pair of reviewers agrees. With two reviewers, their one figure is in the Reviewers section's head instead. */
function Agreement({ open, figures }: { open: Open; figures: Figures | undefined }) {
  const { screening } = open;
  const t = useTranslations("screening.overview");
  const tp = useTranslations("screening.pieces");
  const words = useWords();
  const format = useFormatter();
  const reviewers = inOrder(activeReviewers(screening), open.me);
  const pairs = reviewers.flatMap((a, row) => reviewers.slice(0, row).map((b) => ({ a, b, pair: pairOf(figures, a.id, b.id) })));
  if (reviewers.length < 3) return null;
  const known = pairs.flatMap((one) => (one.pair?.kappa != null ? [one.pair.kappa] : []));
  // The papers each pair's figure is of: the fewest and the most two reviewers both voted on.
  const shared = pairs.flatMap((one) => (one.pair?.kappa != null ? [one.pair.papers] : []));
  // Light's kappa: the mean of every pair's, the figure the squares add up to.
  const overall = known.length ? known.reduce((sum, kappa) => sum + kappa, 0) / known.length : null;
  const kept = screening.reviewers.some((one) => one.tally?.kept);
  const short = (reviewer: Reviewer) => (reviewer.id === open.me ? words.t("you") : shortName(reviewer));

  return (
    <Section
      id="agreement"
      title={t("agreement.title")}
      help={<KappaHelp />}
      aside={
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {BANDS.map((band) => (
            <span key={band.kappa} className="flex items-center gap-1.5 whitespace-nowrap tabular-nums"><span className="size-3 rounded ring-1 ring-border-subtle ring-inset" style={{ backgroundColor: shade(band.kappa) }} />{t(`agreement.band.${band.says}`, { from: band.from, to: band.to })}</span>
          ))}
        </span>
      }
    >
      {/* The figures arrive after the page: until they do a block holds the note's room, and the frame slides to what comes. */}
      <AutoHeight>
      {figures === undefined ? <SkeletonBar className="h-[4.25rem] w-full rounded-2xl" /> : !pairs.some((one) => one.pair) ? (
        // Kept from a reviewer who still has papers to vote on (convex/screening/view.ts `keepsVotes`): that is why it is empty for them, and it says so.
        kept ? <ShutNote by="vote">{t("agreement.kept")}</ShutNote> : <EmptyNote>{t("agreement.none")}</EmptyNote>
      ) : (
        <div className="space-y-3">
          {/* The figure, named for what it is and with its scale, and beside it a link that says where it goes. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-3">
              <span className="rounded-lg px-2.5 py-1 text-2xl font-semibold tabular-nums tracking-tight" style={{ backgroundColor: shade(overall) }}>{kappaText(format, overall, t("kappa.none"))}</span>
              <span className="text-sm">
                <span className="font-medium">{t("agreement.mean")}</span>
                {known.length ? <span className="block text-xs text-muted-foreground">{t("agreement.across", { pairs: known.length, left: pairs.filter((one) => one.pair).length - known.length, range: String(Math.min(...shared) !== Math.max(...shared)), min: Math.min(...shared), max: Math.max(...shared) })}</span> : null}
              </span>
            </span>
            <LinkChip href={papersHref(screening.id, { sort: "split" })} icon={GitCompare}>{t("agreement.splitMost")}</LinkChip>
          </div>
          {/* Each pair once: the rows from the second reviewer on, the columns up to the one before last. */}
          <ScrollArea axis="x" shades className={cn(LIST, "@max-2xl/overview:hidden")}>
          <div className="p-4">
            <div className="grid min-w-max items-center gap-1" style={{ gridTemplateColumns: `minmax(9rem, max-content) repeat(${reviewers.length - 1}, minmax(3.5rem, 7rem))` }}>
              <span />
              {reviewers.slice(0, -1).map((reviewer) => (
                <LinkOr key={reviewer.id} href={reviewerHref(screening.id, reviewer)} aria-label={votesBy(tp, reviewer, open.me)} className={cn("flex min-w-0 flex-col items-center gap-1 px-1 py-1", ROW_LINK)}>
                  <ReviewerMark reviewer={reviewer} you={reviewer.id === open.me} />
                  <span className="max-w-full truncate text-2xs text-muted-foreground">{short(reviewer)}</span>
                </LinkOr>
              ))}
              {reviewers.slice(1).map((a, i) => (
                <div key={a.id} className="contents">
                  <LinkOr href={reviewerHref(screening.id, a)} className={cn("flex min-w-0 items-center gap-2 px-1.5 py-1 pe-3 text-xs", ROW_LINK)}><ReviewerMark reviewer={a} className="size-5" /><ReviewerName reviewer={a} you={a.id === open.me} /></LinkOr>
                  {reviewers.slice(0, -1).map((b, column) => {
                    if (column > i) return <span key={b.id} className="h-12" />;
                    const pair = pairs.find((one) => one.a.id === a.id && one.b.id === b.id)?.pair;
                    if (!pair) return <span key={b.id} className="flex h-12 items-center justify-center rounded-lg border border-dashed border-border-subtle text-2xs text-muted-foreground">{t("agreement.noneYet")}</span>;
                    return (
                      <NextLink key={b.id} href={pairHref(screening.id, a, b)} aria-label={t("agreement.cell", { a: a.name, b: b.name, kappa: kappaText(format, pair.kappa, t("kappa.none")), share: pair.same, papers: pair.papers })} className="flex h-12 flex-col items-center justify-center rounded-lg outline-none ring-foreground/20 transition-shadow hover:ring-2 focus-visible:ring-2 focus-visible:ring-ring/50" style={{ backgroundColor: shade(pair.kappa) }}>
                        <span className="text-xs font-semibold tabular-nums">{kappaText(format, pair.kappa, t("kappa.none"))}</span>
                        <span className="text-2xs tabular-nums text-foreground/70">{sameText(t, pair)}</span>
                      </NextLink>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          </ScrollArea>
          {/* On a phone, the same pairs as a list. */}
          <ul className={cn(LIST, "@2xl/overview:hidden")}>
            {pairs.map(({ a, b, pair }) => {
              const row = (
                <>
                  <span className="flex shrink-0 items-center"><ReviewerMark reviewer={b} className="size-6" /><ReviewerMark reviewer={a} className="-ms-1.5 size-6 ring-2 ring-card" /></span>
                    {/* How often they agreed goes under the names, so the names keep the row's width on a phone. */}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="[overflow-wrap:anywhere]">{words.listed([b.name, a.name])}</span>
                      {pair ? <span className="text-xs tabular-nums text-muted-foreground">{sameText(t, pair)}</span> : null}
                    </span>
                    {pair ? (
                      <span className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums" style={{ backgroundColor: shade(pair.kappa) }}>{kappaText(format, pair.kappa, t("kappa.none"))}</span>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">{t("agreement.noneYet")}</span>
                    )}
                </>
              );
              return (
              <li key={`${a.id}:${b.id}`}>
                {/* A pair with nothing to compare opens no list, as on the grid. */}
                {pair ? (
                  <NextLink href={pairHref(screening.id, a, b)} className={cn(PAIR_ROW, "outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40")}>{row}</NextLink>
                ) : (
                  <div className={PAIR_ROW}>{row}</div>
                )}
              </li>
              );
            })}
          </ul>
        </div>
      )}
      </AutoHeight>
    </Section>
  );
}

/** A reviewer pair's row in the phone's list. */
const PAIR_ROW = "flex items-center gap-3 px-4 py-2.5 text-sm";

// ── Facts ────────────────────────────────────────────────────────────────────────────────────────

/** The facts about the screening, as two wells of one height under the reviewers: where its included papers go, and what its models cost. */
function Facts({ open }: { open: Open }) {
  const { screening, counts } = open;
  const t = useTranslations("screening.overview");
  const tl = useTranslations("screening.list");
  const words = useWords();
  const workspace = screening.workspace;
  const models = modelsOf(screening);
  // What was spent counts a model since taken off: the credits went. What it comes to in the end is that and what the models still on it have left to read.
  const spent = screening.reviewers.reduce((sum, reviewer) => sum + (reviewer.tally?.spent ?? 0), 0);
  const most = spent + models.reduce((sum, model) => sum + open.most(model) - open.spent(model), 0);
  const offSpent = spent - models.reduce((sum, model) => sum + open.spent(model), 0);
  // Just started: its papers are in and none has reached a model yet. Nothing is read, so nothing says every paper is.
  const unreached = open.total > 0 && !screening.finishedAt && open.counts.waiting + open.counts.conflict > 0 && models.length > 0 && models.every((model) => (model.tally?.dealt ?? 0) === 0);
  // The readings that failed: the line under what was spent says so, as each model's row does.
  const unread = models.reduce((sum, model) => sum + (model.tally?.failed ?? 0), 0);
  // The workspace's credits are its members' to see: anyone else is told nothing of them.
  const left = open.wallet ?? Infinity;
  const to = screening.destination;
  const collection = to.kind === "none" ? null : (words.collectionName(screening) || t("included.aCollection"));
  return (
    <div className="grid grid-cols-1 gap-6 @4xl/overview:grid-cols-2">

      <Section
        className="flex flex-col"
        title={t("included.title")}
        help={
          <Help title={t("included.helpTitle")} facts={collection ? <><HelpFact>{t("included.savedEach")}</HelpFact>{to.prune ? <HelpFact>{t("included.pruned")}</HelpFact> : null}</> : undefined}>
            <p>{collection ? t("included.toCollection") : t("included.nowhere", { change: String(open.canChange) })}</p>
          </Help>
        }
        aside={open.canChange ? <Button asChild variant="ghost" size="sm" className="h-7 text-xs"><NextLink href={settingsHref(screening.id, "goes-to")}>{collection ? t("included.change") : t("included.choose")}</NextLink></Button> : null}
      >
        <Panel className="flex-1 space-y-2.5">
          {collection ? (
            <p className="flex items-start gap-2 text-sm font-medium">
              <Folder className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {/* The collection opens in the Library, where its papers are. */}
              {to.collection && open.canChange ? <NextLink href={collectionHref(to.collection)} className={cn(INLINE_LINK, "line-clamp-2")}>{collection}</NextLink> : <span className="line-clamp-2">{collection}</span>}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm font-medium"><Ban className="size-4 shrink-0 text-muted-foreground" />{t("included.nowhereYet")}</p>
          )}
          {/* A community that refused or didn't answer: said where the papers were to go, until a later write gets through. */}
          {to.problem || to.pruneProblem ? <p className="flex items-start gap-2 text-sm ink-warning"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{t("included.problem", { why: to.problem ?? to.pruneProblem!, adding: String(Boolean(to.problem)), name: collection ?? "" })}</p> : null}
          {/* None yet opens nothing: a link to an empty list would promise papers. */}
          {counts.include ? (
            <LinkChip href={papersHref(screening.id, { result: "include" })} tone="success" icon={RESULT_STYLE.include.icon} className="w-fit">
              {t.rich("included.count", { count: counts.include, saved: String(Boolean(collection) && !to.problem), num: () => <AnimatedNumber value={counts.include} /> })}
            </LinkChip>
          ) : (
            <StateChip tone="success" icon={RESULT_STYLE.include.icon} className="w-fit">{t.rich("included.count", { count: 0, saved: String(Boolean(collection) && !to.problem), num: () => 0 })}</StateChip>
          )}
        </Panel>
      </Section>

      <Section
        className="flex flex-col"
        title={t("credits.title")}
        help={
          <Help title={t("credits.helpTitle")} facts={models.length ? models.map((model) => <HelpFact key={model.id} icon={Coins}>{t("credits.modelCost", { name: model.name, cost: perPaper({ words, t: tl }, model.model!) })}</HelpFact>) : <HelpFact>{t("credits.peopleOnly")}</HelpFact>}>
            <p>{t("credits.free")}</p>
          </Help>
        }
      >
        <Panel className="flex-1 space-y-2.5">
          {/* What models spent stays in view once the last of them is taken off. */}
          {models.length || spent >= 1 ? (
            <>
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                  {t.rich("credits.spent", { count: Math.ceil(spent), num: () => <AnimatedNumber value={Math.ceil(spent)} /> })}
                  {open.modelsNow === "reading" ? <AiIcon working className="size-3.5" /> : null}
                </p>
                <p className={cn("text-xs tabular-nums", most - spent < 1 && unread ? "ink-destructive" : "text-muted-foreground")}>{most - spent >= 1 ? t("credits.onceRead", { credits: words.credits(most) }) : unread ? t("credits.failed", { count: unread }) : open.gathering || unreached ? t("credits.arriving") : t("credits.allRead")}</p>
              </div>
              <Meter value={spent} max={Math.max(most, 1)} fill={left < most - spent ? "bg-warning" : "bg-foreground/45"} />
              <div className="flex flex-wrap gap-1.5">
                {/* Billing is its workspace's members' to open: anyone else reads the balance. */}{open.wallet === undefined ? null : <LinkChip href="/settings/billing" tone={left < most - spent ? "warning" : "neutral"} icon={Coins}>{t("credits.leftIn", { credits: words.credits(left), workspace: workspace.name, own: String(screening.workspace.kind === "personal" && open.canChange) })}</LinkChip>}
                {models.length ? <Chip>{words.count("models", models.length)}</Chip> : null}
                {/* The total counts what a model spent before it was taken off: said, so it adds up with the rows above. */}
                {offSpent >= 1 ? <Chip>{t("credits.takenOff", { credits: words.credits(offSpent) })}</Chip> : null}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{t("credits.nothingToPay")}</p>
              <Chip>{t("credits.peopleOnly")}</Chip>
            </div>
          )}
        </Panel>
      </Section>
    </div>
  );
}

const RECENT_CHECKS = 3;
/** Checks one page of every check holds. */
const ALL_CHECKS = 20;

/** Whether the screening checks its sources for new papers by itself, each check and what it brought, and the papers it started with. */
function Checks({ open, figures }: { open: Open; figures: Figures | undefined }) {
  const { screening } = open;
  const workspaceId = usePageWorkspace();
  const t = useTranslations("screening.overview");
  const words = useWords();
  const [{ checks }, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  const sources = growing(screening);
  // The latest checks, a page at a time once every one is asked for. The look it started with is its own row under them.
  // Its page is in the address, so Back steps back through the pages; the latest checks are always the first page's.
  const read = useCursorPageAt("checksPage", api.screening.view.checks, inWorkspace(workspaceId, sources.length ? { jobId: screening.id } : "skip"), ALL_CHECKS, { scroll: false });
  const [, setChecksPage] = useQueryState("checksPage");
  // A screening that is not living and has no source to check has no checks to show. A living one whose sources can't gain papers keeps the part, shut, with why: its "Living" chip would otherwise promise checks that never come.
  if (!sources.length) {
    return screening.living ? (
      <Section id="new-papers" title={t("checks.title")} aside={<ShutChip by="sources" />}>
        <ShutNote by="sources">{t("checks.shut", { change: String(open.canChange) })}</ShutNote>
      </Section>
    ) : null;
  }
  const all = read.items.filter((check) => !check.first && check.state !== "running");
  const shown = checks === "all" ? all : all.slice(0, RECENT_CHECKS);
  const later = figures?.checks.later ?? all.length;
  const fixed = screening.sources.length - sources.length;
  return (
    <Section
      id="new-papers"
      title={t("checks.title")}
      help={
        <Help title={t("checks.helpTitle")} facts={<>{screening.living && screening.finishedAt ? <HelpFact icon={RefreshCw}>{t("checks.finished", { every: screening.living.every })}</HelpFact> : screening.living ? <><HelpFact icon={RefreshCw}>{words.t(`every.${screening.living.every}`)}</HelpFact><HelpFact>{t("checks.next", { day: words.day(screening.living.next) })}</HelpFact></> : <HelpFact>{t("checks.onlyAsked")}</HelpFact>}{fixed ? <HelpFact>{t("checks.skips", { count: fixed })}</HelpFact> : null}</>}>
          <p>{t("checks.means")}</p>
        </Help>
      }
      aside={open.canChange ? (() => { // While papers arrive it waits, and says why where it is pointed at.
        const button = <Button variant="outline" size="sm" className="h-7 text-xs" disabled={Boolean(screening.checking || open.gathering)} onClick={() => void open.check()}><RefreshCw className={screening.checking ? "animate-spin motion-reduce:animate-none" : undefined} />{t(screening.finishedAt ? "checks.checkReopens" : "checks.checkNow")}</Button>; return open.gathering && !screening.checking ? <TooltipHint label={t("credits.arriving")}><span tabIndex={0} className="rounded-md">{button}</span></TooltipHint> : button; })() : null}
    >
      <Panel className="space-y-1 p-0">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-1">
          {screening.living ? (
            <>
            <Chip icon={RefreshCw}>{screening.finishedAt ? t("checks.finished", { every: screening.living.every }) : t("checks.every", { every: screening.living.every })}</Chip>
            {screening.finishedAt ? null : <Chip>{t("checks.next", { day: words.day(screening.living.next) })}</Chip>}
            </>
          ) : (
            <>
              <Chip>{t("checks.onlyWhenAsked")}</Chip>
              {open.canChange ? <Button asChild variant="ghost" size="sm" className="h-6 px-1.5 text-xs"><NextLink href={settingsHref(screening.id, "new-papers")}>{t("checks.schedule")}</NextLink></Button> : null}
            </>
          )}
        </div>
        <div className="divide-y divide-border-subtle">
          <AnimatePresence initial={false}>
            {shown.map((check) => {
              // The sources it couldn't read that the screening still has: one taken out since is no longer said, so the count and the names under it agree.
              const unread = (check.unread ?? []).flatMap((id) => screening.sources.find((source) => source.id === id)?.name ?? []);
              const who = check.by;
              return (
                <motion.div key={check.id} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", DIVIDED_ROW)}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    {who ? <ReviewerMark reviewer={{ kind: "person", name: who.name, imageUrl: who.imageUrl }} className="size-7" /> : <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground"><Clock className="size-3.5" /></span>}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-sm"><span className="font-medium">{who ? t("checks.checkedBy", { you: String(who.id === open.me), name: who.name }) : t("checks.scheduled")}</span><span className="text-xs text-muted-foreground">{words.ago(check.at)}</span></p>
                      {check.state === "failed" ? (
                        <StateChip tone="destructive">{t("checks.failed")}</StateChip>
                      ) : check.found ? (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Chip>{t("checks.found", { count: check.found })}</Chip>
                            {/* What it found is what it added, what was in the screening already, and what it left out: each counted apart. */}
                            {check.found - check.added - (check.left ?? 0) > 0 ? <Chip>{t("checks.alreadyIn", { count: check.found - check.added - (check.left ?? 0) })}</Chip> : null}
                            {check.left ? <Chip>{t("checks.leftOut", { count: check.left })}</Chip> : null}
                            {check.added ? <LinkChip href={papersHref(screening.id, { added: check.id })} tone="primary">{t("checks.added", { count: check.added })}</LinkChip> : null}
                          </div>
                          {/* Each source that gained papers, with how many were new to the screening: with more than one source to check, the total alone doesn't say which is still finding papers. */}
                          {check.sources?.length && sources.length > 1 ? (
                            <ul className="space-y-0.5">
                              {check.sources!.map((one) => {
                                const source = screening.sources.find((row) => row.id === one.id);
                                return source ? <li key={one.id} className="min-w-0 text-xs"><NextLink href={papersHref(screening.id, { added: check.id, source: one.id })} className={cn(INLINE_LINK, "font-normal text-muted-foreground hover:text-foreground")}><span className="line-clamp-1">{t("checks.newFrom", { count: one.added, source: source.name })}</span></NextLink></li> : null;
                              })}
                            </ul>
                          ) : null}
                          {/* Where the papers it added stand now. */}
                          {check.counts ? (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <ResultBar counts={check.counts} className="h-1.5 min-w-24 flex-1" counted />
                              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                {RESULTS.filter((result) => check.counts![result]).map((result) => {
                                  const Icon = RESULT_ICON[result];
                                  return <span key={result} role="img" aria-label={t("checks.result", { result, count: check.counts![result] })} className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground"><Icon className="size-3.5" />{check.counts![result]}</span>;
                                })}
                              </span>
                            </div>
                          ) : null}
                        </>
                      ) : unread.length ? null : (
                        <Chip>{t("checks.nothingNew")}</Chip>
                      )}
                      {/* A source it couldn't read is said, in place of "Nothing new": it found nothing there it can vouch for. */}
                      {/* The names under the chip, where a long search wraps instead of being cut off. */}
                      {unread.length ? <SettingsChip open={open} part="papers" tone="warning" icon={TriangleAlert} className="w-fit">{t("checks.unread", { count: unread.length })}</SettingsChip> : null}
                      {unread.length ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{words.listed(unread)}</p> : null}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {later > RECENT_CHECKS ? (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { void setPlace({ checks: checks === "all" ? null : "all" }); if (checks === "all") void setChecksPage(null); }}>{checks === "all" ? t("checks.showLast", { count: RECENT_CHECKS }) : t("checks.seeEvery", { count: later })}</Button>
              {/* The pages of every check say where they are, as the app's other pagers do. */}{checks === "all" && read.hasPages ? <PageStepper className="ms-auto w-28" page={read.page} {...(figures ? { pageCount: Math.max(1, Math.ceil(later / ALL_CHECKS)) } : {})} canPrevious={read.canPrevious} canNext={read.canNext} onPrevious={read.previous} onNext={read.next} /> : null}
            </div>
          ) : null}
          <div className="flex items-start gap-3 px-4 py-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground"><Folder className="size-3.5" /></span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm"><span className="font-medium">{t("checks.atStart")}</span><span className="text-xs text-muted-foreground">{words.ago(screening.createdAt)}</span></p>
              {/* It opens the papers it started with, where there are any: a count of none, or one not yet known, opens nothing. */}
              {(() => { const says = t("checks.startedWith", { known: String(Boolean(figures)), papers: figures?.startedWith ?? 0, sources: screening.sources.filter((source) => source.addedAt <= screening.createdAt).length || 1 }); return figures?.startedWith ? <LinkChip href={papersHref(screening.id, { added: "start" })} className="w-fit">{says}</LinkChip> : <Chip className="w-fit">{says}</Chip>; })()}
            </div>
          </div>
        </div>
      </Panel>
    </Section>
  );
}

// ── Flow ─────────────────────────────────────────────────────────────────────────────────────────

type FlowRow = { key: string; label: string; value: number; href?: string; fill: string; /** The result the count is of, which gives it that result's colour as in Progress. */ tone?: Result; indent?: boolean; /** The question a reason stands for. */ question?: string; /** A reason for excluding, which is drawn where the label would be. */ reason?: string };

/** The counts a PRISMA diagram is drawn from, left to right: found, removed before screening (duplicates, and what a source left out), the papers screened, and included. Every count above none opens its papers. */
function Flow({ open, figures, onExport }: { open: Open; figures: Figures | undefined; onExport: (tab: ExportTab) => void }) {
  const { screening, counts } = open;
  const t = useTranslations("screening.overview");
  const words = useWords();
  const id = screening.id;
  // What the sources held: the papers they brought, and what they left out for having no abstract or nothing to read.
  const { left, bare, merged } = removedOf(screening.sources);
  const kept = open.total;
  const found = kept + merged + left;
  const arriving = open.gathering ? Math.max(0, open.gathering.of - open.gathering.done) : 0;
  // In conflict is a step only where a paper can be in conflict, or one is.
  const splits = splitsIn(screening, open.counts.conflict, open.invited);
  // Its excluded papers by the reason, the most common first.
  const reasons = Object.entries(figures?.reasons ?? {}).sort((x, y) => y[1] - x[1]);
  const neutral = "bg-foreground/25";
  // `loading`: rows the figures bring, held as placeholders until they come.
  const steps: Array<{ title: string; total: number; href?: string; tone?: Result; rows: FlowRow[]; loading?: number }> = [
    { title: t("flow.found"), total: found, rows: screening.sources.map((source) => ({ key: source.id, label: source.name, value: taken(source) + leftOf(source), ...(open.canChange ? { href: settingsHref(id, "papers") } : {}), fill: neutral })) },
    {
      title: t("flow.removed"),
      total: found - kept,
      // Its sources are in its settings, which its workspace's members open: for anyone else these are counts.
      ...(open.canChange ? { href: settingsHref(id, "papers") } : {}),
      rows: [{ key: "duplicates", label: words.t("removed.merged"), value: merged }, { key: "bare", label: words.t("removed.bare"), value: bare }, { key: "unread", label: words.t("removed.unread"), value: left - bare }].flatMap((row) => (row.value ? [{ ...row, ...(open.canChange ? { href: settingsHref(id, "papers") } : {}), fill: neutral }] : [])),
    },
    {
      title: t("flow.papers"),
      total: kept,
      href: papersHref(id),
      rows: [
        { key: "exclude", label: words.result("exclude"), value: counts.exclude, href: papersHref(id, { result: "exclude" }), fill: RESULT_STYLE.exclude.bar, tone: "exclude" },
        ...reasons.map(([key, value]) => ({ key: `reason:${key}`, label: words.failed(key, reasonCriteria(screening)), reason: key, question: questionOf(key, reasonCriteria(screening), "label"), value, href: papersHref(id, { result: "exclude", reason: key }), fill: RESULT_STYLE.exclude.bar, tone: "exclude" as const, indent: true })),
        { key: "maybe", label: words.result("maybe"), value: counts.maybe, href: papersHref(id, { result: "maybe" }), fill: RESULT_STYLE.maybe.bar, tone: "maybe" },
        ...(splits ? [{ key: "conflict", label: words.result("conflict"), value: counts.conflict, href: papersHref(id, { result: "conflict" }), fill: RESULT_STYLE.conflict.bar, tone: "conflict" as const }] : []),
        { key: "waiting", label: words.result("waiting"), value: counts.waiting, href: papersHref(id, { result: "waiting" }), fill: `bg-foreground/10 ${HATCH}` },
        // Papers still on their way from its sources have nowhere to open yet.
        ...(open.gathering ? [{ key: "arriving", label: t("flow.arriving"), value: arriving, fill: `bg-foreground/10 ${HATCH}` }] : []),
      ],
    },
    {
      title: t("flow.included"),
      total: counts.include,
      tone: "include",
      href: papersHref(id, { result: "include" }),
      // Each source with an included paper is a row: until the figures say which, every source holds one.
      ...(figures === undefined && counts.include ? { loading: screening.sources.length } : {}),
      rows: screening.sources.flatMap((source) => {
        const value = figures?.included[source.id] ?? 0;
        return value ? [{ key: source.id, label: source.name, value, href: papersHref(id, { result: "include", source: source.id }), fill: RESULT_STYLE.include.bar, tone: "include" as const }] : [];
      }),
    },
  ];
  return (
    <Section
      id="flow"
      title={t("flow.title")}
      help={
        <Help title={t("flow.title")} facts={<><HelpFact>{t("flow.titleAbstract")}</HelpFact><HelpFact>{words.count("sources", screening.sources.length)}</HelpFact></>}>
          <p>{t("flow.means")}</p>
        </Help>
      }
      aside={<Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onExport("flow")}><Download />{t("flow.download")}</Button>}
    >
      {/* The excluded papers by reason arrive with the figures, after the page: the boxes slide to their height. */}
      <AutoHeight>
      <div className="grid grid-cols-1 divide-y divide-border-subtle rounded-2xl border border-border-subtle @3xl/overview:grid-cols-4 @3xl/overview:divide-x @3xl/overview:divide-y-0">
        {steps.map((step, i) => (
          <div key={step.title} className="relative min-w-0 space-y-3 p-4">
            {/* A count of none opens nothing, as in Progress. */}
            {step.href && step.total ? (
              <NextLink href={step.href} className={cn("-mx-2 -my-1 block px-2 py-1", ROW_LINK)}>
                <p className="text-xs text-muted-foreground">{step.title}</p>
                <p className={cn("text-2xl font-semibold tabular-nums tracking-tight", step.tone && step.total ? TONE[RESULT_STYLE[step.tone].tone].ink : undefined)}><AnimatedNumber value={step.total} /></p>
              </NextLink>
            ) : (
              <div className={cn(!step.total && "opacity-60")}>
                <p className="text-xs text-muted-foreground">{step.title}</p>
                <p className={cn("text-2xl font-semibold tabular-nums tracking-tight", step.tone && step.total ? TONE[RESULT_STYLE[step.tone].tone].ink : undefined)}><AnimatedNumber value={step.total} /></p>
              </div>
            )}
            {step.rows.length || step.loading ? null : <p className="text-xs text-muted-foreground">{t("flow.none")}</p>}
            <ul className="-mx-2 space-y-0.5">
              {Array.from({ length: step.loading ?? 0 }, (_, at) => (
                <li key={at} aria-hidden className="space-y-1 px-2 py-1.5"><SkeletonBar className="my-0.5 w-2/3" /><SkeletonBar className="h-1 w-full" /></li>
              ))}
              {step.rows.map((row) => {
                const inner = (
                  <>
                    <span className="flex items-baseline justify-between gap-3 text-xs"><span className={cn("line-clamp-2 min-w-0 text-muted-foreground", row.indent && "ps-3")}>{row.reason ? <Reason reason={row.reason} criteria={reasonCriteria(screening)} /> : row.label}</span><span className={cn("shrink-0 font-medium tabular-nums", row.tone && row.value ? TONE[RESULT_STYLE[row.tone].tone].ink : undefined)}>{words.num(row.value)}</span></span>
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
      </AutoHeight>
    </Section>
  );
}

/** A name that opens its papers where it has any, and stands as a name, with nothing to press, where it has none (./links.ts `reviewerHref`). */
function LinkOr({ href, className, children, ...rest }: Omit<ComponentProps<typeof NextLink>, "href"> & { href: string | null }) {
  return href ? <NextLink href={href} className={className} {...rest}>{children}</NextLink> : <span className={className}>{children}</span>;
}
