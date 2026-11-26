"use client";

// The list of a workspace's screenings, as a table: the ones waiting on you first. It takes the place
// of the rail the screening page has today.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import NextLink from "next/link";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { AiIcon, CircleCheck, CirclePause, Copy, Download, Eye, GitCompare, Hourglass, Layers, ListChecks, MoreHorizontal, Move, Play, Plus, RefreshCw, MessagesSquare, RotateCcw, Settings2, Share2, Trash2, UserPlus, Users } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { CommandCenterFilters } from "@/components/command-center/command-center-toolbar";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { Chip } from "@/components/screening/parts";
import { Segmented, pagerOf } from "@/components/settings/parts";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { TooltipHint } from "@/components/ui/tooltip";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { cn } from "@/lib/utils";
import { plural, num, inOrder, resolves, livingSays, HOME, RESULTS, RESULT_LABEL, waitingQuestions, accessOf, activeReviewers, ago, day, growing, modelsOf, personOf, standing, workspaceOf, type Result, type Reviewer, type Screening, lookOf, whoIs, lookerLabel, inQuotes } from "./data";
import { newHref, overviewHref, papersHref, screenHref, settingsHref } from "./links";
import { MockStates } from "./mock-states";
import { useScreeningOverlays } from "./overlays";
import { FilterMenu, Help, LinkChip, RESULT_ICON, RESULT_STYLE, ResultChip, ReviewerMark, TabCount, tinted, MODELS_READING, MODELS_SAY, FIGURE_LINK } from "./parts";
import { modelsState, useMock, useOpenScreening } from "./store";
import { ScrollArea } from "@/components/ui/scroll-area";

const PAGE = 25;
const SORTS = [
  { value: "you", label: "Needs you first" },
  { value: "active", label: "Recently active" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "name", label: "Name" },
] as const;
type Sort = (typeof SORTS)[number]["value"];
/** The groups the rows fall in, and past All a tab for each, under the same name: the tabs' counts add up to All's. */
const GROUPS = ["Needs you", "In progress", "Finished"] as const;
const SHOWS = ["you", "open", "finished"] as const;
/** Which screenings the list shows, kept in the address: Back from a screening returns to the list as it was left. */
const PLACE = {
  show: parseAsStringLiteral(["all", ...SHOWS] as const).withDefault("all"),
  sort: parseAsStringLiteral(SORTS.map((one) => one.value)).withDefault("you"),
  by: parseAsString.withDefault("anyone"),
  q: parseAsString.withDefault(""),
  page: parseAsInteger.withDefault(1),
};

/** Each tab in the colour its rows' status chips have: what waits for you is primary, a finished screening is green. */
const SHOW_ICON = { you: tinted(ListChecks, "primary"), open: tinted(Hourglass, "neutral"), finished: tinted(CircleCheck, "success") };
/**
 * The table's columns, from a laptop's width up: Screening, Reviewers, Papers, Status, Last activity
 * and the menu. Narrower, each row is a card: the title and its menu, the facts under it, the faces
 * and when it last moved on one line, the bar, then the status.
 */
const COLUMNS = "@5xl:grid-cols-[minmax(14rem,1.75fr)_9rem_minmax(8rem,1fr)_minmax(15rem,2fr)_6rem_2rem]";
const CARD = "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'title_menu'_'meta_meta'_'faces_faces'_'papers_papers'_'status_status'] @5xl:[grid-template-areas:'title_faces_papers_status_when_menu'_'meta_faces_papers_status_when_menu']";
/** A link inside a row sits above the link the whole row is, and shows that it is one. */
const ABOVE = "relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

type What = "export" | "share" | "finish" | "move" | "delete";

export function ScreeningsIndex() {
  const store = useMock();
  // Another tab, order, starter or page is a step Back returns from. Typing in the search box changes the address in place.
  const [{ show, sort, by, q: search, page }, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  /** Narrows or reorders the list, which starts again from its first page. */
  const go = (next: Parameters<typeof setPlace>[0]) => void setPlace({ page: null, ...next });
  const [over, setOver] = useState<{ id: string; what: What } | null>(null);
  const me = store.viewer;
  const guest = Boolean(personOf(me)?.guest);

  // A check for new papers started from the list goes on while the list is up, and so does a question put to a made-up colleague, who answers a few seconds later whichever page is open: the timer is the outside system.
  const checking = store.screenings.filter((one) => one.checking || Object.values(one.threads ?? {}).some((said) => waitingQuestions(said).some((question) => question.to !== me))).map((one) => one.id).join(" ");
  const { tick } = store;
  useEffect(() => {
    if (!checking) return;
    const timer = setInterval(() => checking.split(" ").forEach(tick), 1000);
    return () => clearInterval(timer);
  }, [checking, tick]);

  const all = useMemo(
    () =>
      store.screenings.flatMap((screening) => {
        // Someone from outside the workspace sees the ones shared with them.
        const access = accessOf(screening, me);
        if (!access) return [];
        const state = standing(screening);
        const forYou = state.papers.filter((paper) => !state.settled[paper.id]!.final && state.votes[paper.id]!.some((one) => one.reviewer.id === me && !one.vote)).length;
        const conflicts = resolves(screening, me) ? state.counts.conflict : 0;
        const ahead = screening.after ? store.screenings.find((one) => one.id === screening.after) : undefined;
        // What its models are doing: the same answer the open screening's own pages give.
        const held = modelsState(screening, store.screenings, store);
        // The last time anything happened in it: a vote, a change, a check, or its start.
        const votes = Object.values(state.votes).flatMap((cast) => cast.flatMap((one) => one.vote?.at ?? []));
        const active = Math.max(screening.createdAt, screening.finishedAt ?? 0, ...screening.changes.map((change) => change.at), ...(screening.updates ?? []).map((update) => update.at), ...votes);
        // A reviewer asked the person looking about a paper, and waits for the answer.
        const asked = Object.entries(screening.threads ?? {}).filter(([, said]) => waitingQuestions(said).some((question) => question.to === me)).map(([paper]) => paper);
        const open = screening.finishedAt ? { forYou: 0, conflicts: 0 } : { forYou, conflicts };
        const group = open.forYou + open.conflicts + asked.length ? 0 : screening.finishedAt ? 2 : 1;
        return [{ screening, state, access, ...open, asked, models: held, ahead, active, group }];
      }),
    [store.screenings, store.wallet, store.away, me],
  );
  type Row = (typeof all)[number];
  const starters = [...new Set(all.map((row) => row.screening.createdBy))];
  // What the search and the starter leave: the tabs count these, and show one group of them.
  const narrowed = useMemo(() => {
    const words = search.trim().toLowerCase();
    return all.filter((row) => (!words || row.screening.name.toLowerCase().includes(words)) && (by === "anyone" || row.screening.createdBy === by));
  }, [all, search, by]);
  const rows = useMemo(() => {
    const found = show === "all" ? narrowed : narrowed.filter((row) => row.group === SHOWS.indexOf(show));
    const order: Record<Sort, (a: Row, b: Row) => number> = {
      // What waits on you first, the one with the most waiting at the top. Then what is running, then what is finished, newest first within each.
      you: (a, b) => a.group - b.group || b.forYou + b.conflicts - (a.forYou + a.conflicts) || b.screening.createdAt - a.screening.createdAt,
      active: (a, b) => b.active - a.active,
      newest: (a, b) => b.screening.createdAt - a.screening.createdAt,
      oldest: (a, b) => a.screening.createdAt - b.screening.createdAt,
      name: (a, b) => a.screening.name.localeCompare(b.screening.name),
    };
    return [...found].sort(order[sort]);
  }, [narrowed, show, sort]);
  const pager = pagerOf(rows.length, PAGE, page, (next) => void setPlace({ page: next }));
  const inGroup = (show: (typeof SHOWS)[number]) => narrowed.filter((row) => row.group === SHOWS.indexOf(show)).length;
  const tally = { all: narrowed.length, you: inGroup("you"), open: inGroup("open"), finished: inGroup("finished") };
  const shown = rows.slice((pager.page - 1) * PAGE, pager.page * PAGE);
  // Under the default order the rows sit in their groups, where there is more than one.
  const grouped = sort === "you" && new Set(rows.map((row) => row.group)).size > 1;
  const byName = by === "anyone" ? null : by === me ? "you" : personOf(by)?.name;
  const words = search.trim();
  const none = show === "you"
    ? `Nothing${byName ? ` started by ${byName}` : ""}${words ? ` called ${inQuotes(words)}` : ""} needs you.`
    : `No ${show === "finished" ? "finished screenings" : show === "open" ? "screenings in progress" : "screenings"}${byName ? ` started by ${byName}` : ""}${words ? ` called ${inQuotes(words)}` : ""}.`;

  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        <div className={`contents ${AVATARS_FADE_IN}`}>
          <LibraryPageShell
            wide
            icon={ListChecks}
            title="Screening"
            filters={all.length ? <CommandCenterFilters sortOptions={[...SORTS]} currentSort={sort} onSortChange={(next) => go({ sort: next })} searchFilter={search} onSearchChange={(next) => void setPlace({ q: next, page: null }, { history: "replace" })} placeholder="Find a screening" /> : undefined}
            actions={
              <Button asChild size="sm" className={BAR_ACTION}>
                <NextLink href={newHref()}><Plus /><span className={BAR_LABEL}>New screening</span></NextLink>
              </Button>
            }
          >
            {!all.length ? (
              <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary"><ListChecks className="size-6" /></span>
                <h2 className="text-lg font-semibold tracking-tight">Decide which papers belong in your review</h2>
                <p className="max-w-md text-sm text-muted-foreground">Bring papers from searches, collections or your own files, set your criteria, and screen them by hand, with your team, with AI models as extra reviewers, or all three.</p>
                <Button asChild className="mt-2"><NextLink href={newHref()}><Plus />New screening</NextLink></Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3 border-b border-border-subtle p-4 sm:px-6">
                  {/* Four tabs don't fit a phone's width, and a row of tabs never runs off the screen: there they are one menu, with the same signs and counts. */}
                  <FilterMenu
                    name="Show"
                    value={show}
                    onChange={(next) => go({ show: next })}
                    narrows={false}
                    className="h-8 w-full rounded-full px-3.5 text-xs sm:hidden"
                    choices={[
                      { value: "all" as typeof show, label: "All", icon: <Layers />, count: tally.all },
                      { value: "you" as typeof show, label: "Needs you", icon: <ListChecks />, tone: "primary" as const, count: tally.you },
                      { value: "open" as typeof show, label: "In progress", icon: <Hourglass />, count: tally.open },
                      { value: "finished" as typeof show, label: "Finished", icon: <CircleCheck />, tone: "success" as const, count: tally.finished },
                    ]}
                  />
                  <ScrollArea axis="x" shades className="max-w-full max-sm:hidden max-lg:-mx-4">
                  <div className="w-max max-lg:px-4">
                    <Segmented
                      label="Which screenings"
                      value={show}
                      onChange={(next) => go({ show: next })}
                      options={[
                        { id: "all", label: "All", detail: <span className="tabular-nums text-muted-foreground">{tally.all}</span> },
                        { id: "you", label: "Needs you", icon: SHOW_ICON.you, detail: <TabCount value={tally.you} tone="primary" /> },
                        { id: "open", label: "In progress", icon: SHOW_ICON.open, detail: <TabCount value={tally.open} /> },
                        { id: "finished", label: "Finished", icon: SHOW_ICON.finished, detail: <TabCount value={tally.finished} tone="success" /> },
                      ]}
                    />
                  </div>
                  </ScrollArea>
                  {/* What the bars' colours mean and what "settled" counts: beside the tabs where the row has the room, and on a line of its own under them where it hasn't. */}
                  <span role="group" aria-label="What the colours of a bar mean" className="order-last flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground @7xl:order-none @7xl:basis-auto">
                    {([["Settled", ["include", "maybe", "exclude"]], ["Not yet", ["conflict", "waiting"]]] as const).map(([name, results]) => (
                      <span key={name} className="flex items-center gap-x-2.5">
                        <span className="font-medium text-foreground">{name}</span>
                        {results.map((result) => { const Icon = RESULT_ICON[result]; return <span key={result} className="flex items-center gap-1"><Icon aria-hidden className="size-3.5 shrink-0" />{RESULT_LABEL[result]}</span>; })}
                      </span>
                    ))}
                  </span>
                  {starters.length > 1 ? (
                    <FilterMenu
                      name="Started by"
                      value={by}
                      onChange={(next) => go({ by: next })}
                      align="end"
                      className="h-8 max-w-72 rounded-full px-3.5 text-xs max-sm:w-full max-sm:max-w-none"
                      choices={[
                        { value: "anyone", label: "Anyone", icon: <Users />, count: all.length },
                        ...starters.map((one) => ({ value: one, label: one === me ? "You" : (personOf(one)?.name ?? "Someone"), icon: <IdentityAvatar name={personOf(one)?.name ?? ""} imageUrl={personOf(one)?.imageUrl} className="size-4" />, count: all.filter((row) => row.screening.createdBy === one).length })),
                      ]}
                    />
                  ) : null}
                </div>
                {/* The column names stay under the page's bar while the list scrolls. */}
                <div className={cn("sticky top-[calc(var(--app-navbar-height)+var(--page-header-height,4rem))] z-10 hidden items-center gap-x-5 border-b border-border-subtle bg-inset px-6 py-2 text-xs font-medium text-muted-foreground @5xl:grid", COLUMNS)}>
                  <span>Screening</span>
                  <span>Reviewers</span>
                  <span className="flex items-center gap-1">
                    Papers
                    <Help title="Where the papers stand" facts={RESULTS.map((result) => <ResultChip key={result} result={result} />)}>
                      <p>Each bar splits a screening&apos;s papers by where they stand now. Press a part of the bar to see those papers.</p>
                    </Help>
                  </span>
                  <span>Status</span>
                  <span>Last activity</span>
                  <span />
                </div>
                <ul className="divide-y divide-border-subtle">
                  {shown.map((row, i) => {
                    const { screening, state, access, forYou, conflicts, asked, models, ahead, active, group } = row;
                    const id = screening.id;
                    const starter = personOf(screening.createdBy);
                    const workspace = workspaceOf(screening);
                    // The workspace is named wherever it isn't the one the person looking works in.
                    const elsewhere = guest ? !(workspace.id === "theirs" && screening.createdBy === me) : workspace !== HOME;
                    const reviewers = inOrder(activeReviewers(screening), me);
                    const total = state.papers.length;
                    const settled = total - state.counts.conflict - state.counts.waiting;
                    const resolver = whoIs(screening, screening.rule.resolver, me, true);
                    return (
                      <Group key={id} label={(grouped || show === "you") && (i === 0 || shown[i - 1]!.group !== group) ? GROUPS[group] : null} note={group === 0 ? "Papers to screen, conflicts to settle and questions put to you" : undefined} count={rows.filter((one) => one.group === group).length}>
                        <li className={cn("relative grid items-center gap-x-5 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted sm:px-6 @5xl:gap-y-0.5", CARD, COLUMNS)}>
                          {/* The whole row opens the screening. Its title is the link a keyboard reaches; what is pressable inside the row sits above this one. */}
                          <NextLink href={overviewHref(id)} tabIndex={-1} aria-hidden className="absolute inset-0" />
                          <TooltipHint label={screening.name} onlyWhenClipped>
                            <NextLink href={overviewHref(id)} className={cn(ABOVE, "min-w-0 self-end text-sm font-semibold [grid-area:title] hover:underline line-clamp-2")}>{screening.name}</NextLink>
                          </TooltipHint>
                          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 self-start text-xs text-muted-foreground [grid-area:meta]">
                            <button type="button" onClick={() => go({ by: screening.createdBy })} aria-label={`Show the screenings ${screening.createdBy === me ? "you" : starter?.name} started`} className={cn(ABOVE, "flex min-w-0 items-center gap-1.5 hover:text-foreground hover:underline")}>
                              <IdentityAvatar name={starter?.name ?? ""} imageUrl={starter?.imageUrl} className="size-4" />
                              <span className="truncate">{screening.createdBy === me ? "You" : (starter?.name ?? "Someone")}</span>
                            </button>
                            <span className="whitespace-nowrap">started it {ago(screening.createdAt)}</span>
                            {elsewhere ? <span className="flex min-w-0"><WorkspaceTag size="sm" workspace={lookOf(workspace, screening.createdBy)} /></span> : null}
                            {screening.living ? <Chip icon={RefreshCw} className="h-5 px-1.5">{livingSays(screening.living.every)}</Chip> : null}
                            {/* A member who isn't one of its reviewers can still change it: only someone it was shared with is a viewer. */}
                            {!access.reviewer ? <Chip icon={Eye} className="h-5 px-1.5">{lookerLabel(access.member)}</Chip> : null}
                          </span>
                          {/* On a card the faces and when it last moved share a line under the title; in the table each has its column. */}
                          <span className="flex min-w-0 items-center justify-between gap-3 [grid-area:faces] @5xl:contents">
                            <Faces id={id} reviewers={reviewers} me={me} />
                            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground @5xl:row-span-2 @5xl:[grid-area:when]"><span className="@5xl:hidden">Last activity </span>{ago(active)}</span>
                          </span>
                          <span className="min-w-0 space-y-1.5 [grid-area:papers]">
                            <Bar id={id} counts={state.counts} />
                            <NextLink href={screening.finishedAt ? papersHref(id, { result: "include" }) : papersHref(id)} className={cn(ABOVE, FIGURE_LINK, "block w-fit text-xs tabular-nums text-muted-foreground hover:text-foreground")}>
                              {screening.finishedAt ? `${num(state.counts.include)} included of ${num(total)}` : `${num(settled)} of ${num(total)} settled`}
                            </NextLink>
                          </span>
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5 [grid-area:status] @5xl:row-span-2">
                            {forYou ? <LinkChip href={screenHref(id)} tone="primary" icon={ListChecks} className="relative shrink-0">{num(forYou)} for you to screen</LinkChip> : null}
                            {conflicts ? <LinkChip href={screenHref(id, { queue: "conflicts" })} tone="info" icon={GitCompare} className="relative shrink-0">{plural(conflicts, "conflict", "conflicts")} to settle</LinkChip> : null}
                            {/* It opens the paper the question is about, where it is answered. */}
                            {asked.length ? <LinkChip href={screenHref(id, { queue: "conflicts", paper: asked[0] })} tone="primary" icon={MessagesSquare} className="relative shrink-0">{plural(asked.length, "question", "questions")} for you</LinkChip> : null}
                            {/* What its models are doing shows beside your work. */}
                            {models === "reading" ? <LinkChip href={overviewHref(id)} className="relative shrink-0"><span className="flex items-center gap-1.5"><AiIcon working className="size-3.5" />{MODELS_READING}</span></LinkChip>
                              : models === "waiting" ? (ahead ? <LinkChip href={overviewHref(ahead.id)} icon={MODELS_SAY.waiting.icon} className="relative shrink-0">{MODELS_SAY.waiting.says} {ahead.name}</LinkChip> : null)
                              : models ? <LinkChip href={overviewHref(id)} tone={MODELS_SAY[models].stop ? "warning" : undefined} icon={MODELS_SAY[models].icon} className="relative shrink-0">{MODELS_SAY[models].says}</LinkChip>
                              : null}
                            {/* Where its papers stand shows where nothing waits for you. */}
                            {forYou || conflicts ? null
                              : screening.finishedAt ? <LinkChip href={papersHref(id, { result: "include" })} tone="success" icon={CircleCheck} className="relative shrink-0">{num(state.counts.include)} included, finished {ago(screening.finishedAt)}</LinkChip>
                              : models ? null
                              : state.counts.waiting ? <LinkChip href={papersHref(id, { result: "waiting" })} icon={Hourglass} className="relative shrink-0">{num(state.counts.waiting)} waiting for votes</LinkChip>
                              : state.counts.conflict ? <LinkChip href={papersHref(id, { result: "conflict" })} tone="info" icon={GitCompare} className="relative shrink-0">{num(state.counts.conflict)} in conflict, for {resolver} to settle</LinkChip>
                              : screening.living ? <LinkChip href={overviewHref(id, "new-papers")} icon={RefreshCw} className="relative shrink-0">Up to date, next check {day(screening.living.next)}</LinkChip>
                              : <LinkChip href={papersHref(id)} tone="success" icon={CircleCheck} className="relative shrink-0">Every paper is settled</LinkChip>}
                          </span>
                          <span className="flex justify-end [grid-area:menu] @5xl:row-span-2">
                            <RowMenu screening={screening} onOpen={(what) => setOver({ id, what })} />
                          </span>
                        </li>
                      </Group>
                    );
                  })}
                  {!rows.length ? (
                    <li className="flex flex-col items-center gap-2 px-4 py-14 text-center">
                      <p className="text-sm text-muted-foreground">{none}</p>
                      <Button variant="outline" size="sm" onClick={() => go({ q: null, show: null, by: null })}>Show every screening</Button>
                    </li>
                  ) : null}
                </ul>
                {pager.pages > 1 ? <CommandCenterPagination className="border-t border-border-subtle p-4 sm:px-6" currentPage={pager.page} totalPages={pager.pages} onPageChange={pager.setPage} totalItems={pager.total} itemsPerPage={PAGE} itemLabel="screenings" /> : null}
              </>
            )}
          </LibraryPageShell>
          {/* On a phone the last row can scroll clear of the assistant's button in the corner. */}
          <div aria-hidden className="h-6 lg:hidden" />
        </div>
        {over ? <RowDialogs key={`${over.id}:${over.what}`} id={over.id} start={over.what} onDone={() => setOver(null)} /> : null}
        <MockStates />
      </PageWrapper>
    </MotionConfig>
  );
}

/** A group's labelled row before its first screening on the page, under the default order. */
function Group({ label, note, count, children }: { label: string | null; /** What the group holds, where its name doesn't say: with it, a row that shows no question is a screening where nobody waits for an answer. */ note?: string; count: number; children: ReactNode }) {
  return (
    <>
      {label ? (
        <li className="flex items-baseline gap-2 bg-inset px-4 py-2 text-xs font-medium sm:px-6">
          <span className="shrink-0">{label}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>
          {note ? <span className="min-w-0 ps-1 font-normal text-muted-foreground">{note}</span> : null}
        </li>
      ) : null}
      {children}
    </>
  );
}

/** Its reviewers' faces and marks, each opening the papers that reviewer voted on. */
function Faces({ id, reviewers, me, max = 6 }: { id: string; reviewers: Reviewer[]; me: string; max?: number }) {
  const more = reviewers.length - max;
  return (
    <span className="flex items-center [grid-area:faces] @5xl:row-span-2">
      {reviewers.slice(0, max).map((reviewer, i) => {
        const name = reviewer.id === me ? "Your votes" : `${reviewer.name}'s votes`;
        return (
          <TooltipHint key={reviewer.id} label={name}>
            <NextLink href={papersHref(id, { reviewer: reviewer.id })} aria-label={name} className={cn("relative flex ring-2 ring-card outline-none transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:ring-ring/50", reviewer.kind === "model" ? "rounded-md" : "rounded-full", i > 0 && "-ms-1.5")}>
              <ReviewerMark reviewer={reviewer} you={reviewer.id === me} />
            </NextLink>
          </TooltipHint>
        );
      })}
      {more > 0 ? (
        <TooltipHint label={plural(more, "more reviewer", "more reviewers")}>
          <NextLink href={overviewHref(id, "reviewers")} aria-label={plural(more, "more reviewer", "more reviewers")} className={cn(ABOVE, "ms-1.5 px-0.5 text-xs tabular-nums text-muted-foreground hover:text-foreground hover:underline")}>+{more}</NextLink>
        </TooltipHint>
      ) : null}
    </span>
  );
}

/** A screening's papers as one bar, split by where they stand: each part opens those papers. */
function Bar({ id, counts }: { id: string; counts: Record<Result, number> }) {
  const total = RESULTS.reduce((sum, result) => sum + counts[result], 0);
  return (
    <span className="flex h-2.5 w-full gap-px rounded-full">
      {total === 0 ? <span className="h-full flex-1 rounded-full bg-foreground/10" /> : null}
      {RESULTS.map((result) => {
        if (!counts[result]) return null;
        const label = `${num(counts[result])} ${RESULT_LABEL[result].toLowerCase()}`;
        return (
          <TooltipHint key={result} label={label}>
            <NextLink
              href={papersHref(id, { result })}
              aria-label={label}
              // The part's hit area runs above and below the thin bar.
              className={cn("relative h-full min-w-1.5 basis-0 outline-none transition-[flex-grow,filter] duration-500 ease-out first:rounded-s-full last:rounded-e-full after:absolute after:inset-x-0 after:-inset-y-2 hover:brightness-90 focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none", RESULT_STYLE[result].bar)}
              // Waiting is hatched, so papers still to be voted on never read as excluded ones.
              style={{ flexGrow: counts[result], ...(result === "waiting" ? { backgroundImage: "repeating-linear-gradient(-45deg, transparent 0 3px, color-mix(in oklab, var(--foreground) 14%, transparent) 3px 5px)" } : {}) }}
            />
          </TooltipHint>
        );
      })}
    </span>
  );
}

/** The row's menu: what the open screening's menu offers, under the same names and in the same order, after Settings, Export and Share. */
function RowMenu({ screening, onOpen }: { screening: Screening; onOpen: (what: What) => void }) {
  return (
    <DropdownMenu>
      <TooltipHint label="More">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative size-8 text-muted-foreground" aria-label={`More for ${screening.name}`}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
      </TooltipHint>
      <DropdownMenuContent align="end" className="w-auto min-w-56 [&_[role=menuitem]]:whitespace-nowrap">
        <RowMenuItems id={screening.id} onOpen={onOpen} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The menu's items, worked out from the screening as the person sees it once the menu opens. */
function RowMenuItems({ id, onOpen }: { id: string; onOpen: (what: What) => void }) {
  const open = useOpenScreening(id);
  if (!open) return null;
  const { screening } = open;
  // Someone it is shared with from outside can start their own from it, and change nothing.
  const member = open.canChange;
  return (
    <>
      {/* Settings are its workspace's members' to open: nobody is offered a page that would turn them away. */}
      {member ? <DropdownMenuItem asChild><NextLink href={settingsHref(id)}><Settings2 />Settings</NextLink></DropdownMenuItem> : null}
      <DropdownMenuItem onSelect={() => onOpen("export")}><Download />Export</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onOpen("share")}><Share2 />Share</DropdownMenuItem>
      <DropdownMenuSeparator />
      {member ? (
        screening.finishedAt ? (
          <DropdownMenuItem onSelect={() => open.update((s) => ({ ...s, finishedAt: undefined }), { what: "Reopened the screening" })}><RotateCcw />Reopen</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onOpen("finish")}><CircleCheck />Mark as finished</DropdownMenuItem>
        )
      ) : null}
      {member && modelsOf(screening).length && !screening.finishedAt ? (
        screening.paused ? (
          <DropdownMenuItem onSelect={() => open.update((s) => ({ ...s, paused: false }), { what: "Resumed the models" })}><Play />Resume models</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => open.update((s) => ({ ...s, paused: true }), { what: "Paused the models" })}><CirclePause />Pause models</DropdownMenuItem>
        )
      ) : null}
      {member && growing(screening).length ? <DropdownMenuItem disabled={Boolean(screening.checking)} onSelect={open.check}><RefreshCw />Check for new papers</DropdownMenuItem> : null}
      <DropdownMenuItem asChild><NextLink href={newHref(id)}><Copy />Duplicate as a new screening</NextLink></DropdownMenuItem>
      {member ? <DropdownMenuItem onSelect={() => onOpen("move")}><Move />Move to another workspace</DropdownMenuItem> : null}
      {member && !open.isReviewer && !screening.finishedAt ? <DropdownMenuItem onSelect={open.join}><UserPlus />Join as a reviewer</DropdownMenuItem> : null}
      {member ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onOpen("delete")}><Trash2 />Delete</DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

/**
 * What the row's menu opens, for one screening: the same dialogs and confirms the open screening has.
 * Sharing can lead on to making someone a reviewer or a viewer, each asked first.
 */
function RowDialogs({ id, start, onDone }: { id: string; start: What; onDone: () => void }) {
  // The same overlays the screening's own pages open, started on the one its row's menu asked for.
  return useScreeningOverlays(useOpenScreening(id), { start, onClosed: onDone }).overlays;
}
