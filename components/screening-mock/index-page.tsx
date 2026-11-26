"use client";

// The list of a workspace's screenings, as a table: the ones waiting on you first.

import { useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { AiIcon, CircleCheck, CirclePause, Copy, Download, Eye, GitCompare, Hourglass, Layers, ListChecks, MoreHorizontal, Move, Play, Plus, RefreshCw, MessagesSquare, RotateCcw, Settings2, Trash2, UserPlus, Users } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { CommandCenterFilters } from "@/components/command-center/command-center-toolbar";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { ListLoading } from "@/components/evidence-libraries/list-controls";
import { PageWrapper } from "@/components/PageWrapper";
import { Chip } from "@/components/screening/parts";
import { Segmented } from "@/components/settings/parts";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { TooltipHint } from "@/components/ui/tooltip";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { useRunBy } from "@/components/workspaces/run-by";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { plural, num, inOrder, livingSays, RESULTS, RESULT_LABEL, ago, day, firstName, growing, modelsOf, type Result, type Reviewer, lookerLabel, inQuotes } from "./data";
import { newHref, overviewHref, papersHref, screenHref, settingsHref } from "./links";
import { useScreeningOverlays } from "./overlays";
import { FilterMenu, Help, LinkChip, RESULT_ICON, RESULT_STYLE, ResultChip, ReviewerMark, TabCount, tinted, MODELS_READING, MODELS_SAY, FIGURE_LINK } from "./parts";
import { toReviewer, useOpenScreening, type Summary } from "./store";
import { ScrollArea } from "@/components/ui/scroll-area";

const PAGE = 25;
const SORTS = [
  { value: "you", label: "Needs you first" },
  { value: "active", label: "Recently active" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "name", label: "Name" },
] as const;
/** The groups the rows fall in, and past All a tab for each, under the same name: the tabs' counts add up to All's. */
const GROUPS = ["Needs you", "In progress", "Finished"] as const;
const SHOWS = ["you", "open", "finished"] as const;
/** Which screenings the list shows, kept in the address: Back from a screening returns to the list as it was left. */
const PLACE = {
  show: parseAsStringLiteral(["all", ...SHOWS] as const).withDefault("all"),
  sort: parseAsStringLiteral(SORTS.map((one) => one.value)).withDefault("you"),
  q: parseAsString.withDefault(""),
  // The page of the list, as its pager keeps it (lib/hooks/use-cursor-page.ts): named here so another tab or order starts at the first.
  page: parseAsString,
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

type What = "export" | "people" | "finish" | "move" | "delete";

export function ScreeningsIndex() {
  // Another tab, order or page is a step Back returns from. Typing in the search box changes the address in place.
  const [{ show, sort, q: search }, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  const go = (next: Parameters<typeof setPlace>[0]) => void setPlace(next);
  const [over, setOver] = useState<{ id: string; what: What } | null>(null);
  const here = useWorkspace();
  const runBy = useRunBy("screeningJobs", { label: "startedBy", compact: true });
  const words = useDebouncedValue(search.trim(), 300);
  // What waits for the person, and what is shared with them from elsewhere: read whole, since both are theirs alone and few.
  const mine = useProtectedQuery(api.screening.view.mine, inWorkspace(here, {})).data;
  const tally = useProtectedQuery(api.screening.view.tally, inWorkspace(here, {})).data;
  // "Needs you first" is the newest first with what waits for the person above them.
  const listed = useCursorPageAt("page", api.screening.view.list, inWorkspace(here, show === "you" ? "skip" : { show, sort: sort === "you" ? ("newest" as const) : sort, ...(runBy.by ? { by: runBy.by } : {}), ...(words ? { text: words } : {}) }), PAGE);

  const fits = (row: Summary) => (!words || row.name.toLowerCase().includes(words.toLowerCase())) && (!runBy.by || row.createdBy.id === runBy.by);
  const needing = (row: Summary) => row.forYou + row.conflicts + row.asked > 0;
  const needs = (mine?.page ?? []).filter((row) => needing(row) && fits(row));
  const shared = (mine?.page ?? []).filter((row) => !row.member && fits(row));
  const waiting = new Set(needs.map((row) => row.id));
  // Under the default order what waits for the person leads the first page, and the pages after it never repeat one.
  const pinned = sort === "you" && show !== "finished" && listed.page === 1 ? needs.filter((row) => show === "all" || !row.finishedAt) : [];
  const paged = show === "you" ? [] : listed.items.filter((row) => !(sort === "you" && show !== "finished" && waiting.has(row.id)));
  const rows = (show === "you" ? needs : [...pinned, ...paged, ...(show === "all" && listed.page === 1 ? shared.filter((row) => !waiting.has(row.id)) : [])]).map((row) => ({ row, group: waiting.has(row.id) ? 0 : row.finishedAt ? 2 : 1 }));
  const loading = mine === undefined || tally === undefined || (show !== "you" && listed.isLoading);
  const counts = tally && mine ? { all: tally.open + tally.finished + mine.page.filter((row) => !row.member).length, you: mine.page.filter(needing).length, open: Math.max(0, tally.open - mine.page.filter((row) => row.member && !row.finishedAt && needing(row)).length), finished: tally.finished } : undefined;
  const empty = counts !== undefined && counts.all === 0 && counts.you === 0;
  // Under the default order the rows sit in their groups, where there is more than one.
  const grouped = sort === "you" && new Set(rows.map((one) => one.group)).size > 1;
  const none = show === "you" ? `Nothing${words ? ` called ${inQuotes(words)}` : ""} needs you.` : `No ${show === "finished" ? "finished screenings" : show === "open" ? "screenings in progress" : "screenings"}${words ? ` called ${inQuotes(words)}` : ""}.`;
  const count = (value: number | undefined, tone?: "primary" | "success") => (value === undefined ? <span className="tabular-nums text-muted-foreground">&nbsp;</span> : <TabCount value={value} tone={tone} />);

  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        <div className={`contents ${AVATARS_FADE_IN}`}>
          <LibraryPageShell
            wide
            icon={ListChecks}
            title="Screening"
            filters={empty ? undefined : <CommandCenterFilters sortOptions={[...SORTS]} currentSort={sort} onSortChange={(next) => go({ sort: next, page: null })} searchFilter={search} onSearchChange={(next) => void setPlace({ q: next, page: null }, { history: "replace" })} placeholder="Find a screening" />}
            actions={
              <Button asChild size="sm" className={BAR_ACTION}>
                <NextLink href={newHref()}><Plus /><span className={BAR_LABEL}>New screening</span></NextLink>
              </Button>
            }
          >
            {empty ? (
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
                    onChange={(next) => go({ show: next, page: null })}
                    narrows={false}
                    className="h-8 w-full rounded-full px-3.5 text-xs sm:hidden"
                    choices={[
                      { value: "all" as typeof show, label: "All", icon: <Layers />, count: counts?.all },
                      { value: "you" as typeof show, label: "Needs you", icon: <ListChecks />, tone: "primary" as const, count: counts?.you },
                      { value: "open" as typeof show, label: "In progress", icon: <Hourglass />, count: counts?.open },
                      { value: "finished" as typeof show, label: "Finished", icon: <CircleCheck />, tone: "success" as const, count: counts?.finished },
                    ]}
                  />
                  <ScrollArea axis="x" shades className="max-w-full max-sm:hidden max-lg:-mx-4">
                  <div className="w-max max-lg:px-4">
                    <Segmented
                      label="Which screenings"
                      value={show}
                      onChange={(next) => go({ show: next, page: null })}
                      options={[
                        { id: "all", label: "All", detail: count(counts?.all) },
                        { id: "you", label: "Needs you", icon: SHOW_ICON.you, detail: count(counts?.you, "primary") },
                        { id: "open", label: "In progress", icon: SHOW_ICON.open, detail: count(counts?.open) },
                        { id: "finished", label: "Finished", icon: SHOW_ICON.finished, detail: count(counts?.finished, "success") },
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
                  {/* In an organization, whose screenings: the same control every list of a workspace has. */}
                  {runBy.filter}
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
                {loading && !rows.length ? (
                  <ListLoading label="Loading screenings" />
                ) : (
                <ul className={cn("divide-y divide-border-subtle", listed.isStale && "pointer-events-none opacity-60")}>
                  {rows.map(({ row, group }, i) => {
                    const id = row.id;
                    const me = row.me as string;
                    // The workspace is named wherever it isn't the one the person looking works in.
                    const elsewhere = row.workspace.id !== here;
                    const reviewers = inOrder(row.reviewers.filter((one) => one.left === undefined).map(toReviewer), me);
                    const { counts: stands, total, forYou, conflicts, asked, askedFirst, models, ahead } = row;
                    const settled = total - stands.conflict - stands.waiting;
                    const resolver = row.resolver.id === me ? "you" : firstName(row.resolver.name);
                    return (
                      <Group key={id} label={(grouped || show === "you") && (i === 0 || rows[i - 1]!.group !== group) ? GROUPS[group]! : null} note={group === 0 ? "Papers to screen, conflicts to settle and questions put to you" : undefined} count={group === 0 ? needs.length : undefined}>
                        <li className={cn("relative grid items-center gap-x-5 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted sm:px-6 @5xl:gap-y-0.5", CARD, COLUMNS)}>
                          {/* The whole row opens the screening. Its title is the link a keyboard reaches; what is pressable inside the row sits above this one. */}
                          <NextLink href={overviewHref(id)} tabIndex={-1} aria-hidden className="absolute inset-0" />
                          <TooltipHint label={row.name} onlyWhenClipped>
                            <NextLink href={overviewHref(id)} className={cn(ABOVE, "min-w-0 self-end text-sm font-semibold [grid-area:title] hover:underline line-clamp-2")}>{row.name}</NextLink>
                          </TooltipHint>
                          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 self-start text-xs text-muted-foreground [grid-area:meta]">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <IdentityAvatar name={row.createdBy.name} imageUrl={row.createdBy.imageUrl} className="size-4" />
                              <span className="truncate">{row.createdBy.id === me ? "You" : row.createdBy.name}</span>
                            </span>
                            <span className="whitespace-nowrap">started it {ago(row.createdAt)}</span>
                            {elsewhere ? <span className="flex min-w-0"><WorkspaceTag size="sm" workspace={{ kind: row.workspace.kind, name: row.workspace.name, imageUrl: row.workspace.imageUrl, colour: row.workspace.colour, workspaceId: row.workspace.id }} /></span> : null}
                            {row.living ? <Chip icon={RefreshCw} className="h-5 px-1.5">{livingSays(row.living.every)}</Chip> : null}
                            {/* A member who isn't one of its reviewers can still change it: only someone it was shared with is a viewer. */}
                            {!row.isReviewer ? <Chip icon={Eye} className="h-5 px-1.5">{lookerLabel(row.member)}</Chip> : null}
                          </span>
                          {/* On a card the faces and when it last moved share a line under the title; in the table each has its column. */}
                          <span className="flex min-w-0 items-center justify-between gap-3 [grid-area:faces] @5xl:contents">
                            <Faces id={id} reviewers={reviewers} me={me} />
                            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground @5xl:row-span-2 @5xl:[grid-area:when]"><span className="@5xl:hidden">Last activity </span>{ago(row.activeAt)}</span>
                          </span>
                          <span className="min-w-0 space-y-1.5 [grid-area:papers]">
                            <Bar id={id} counts={stands} />
                            <NextLink href={row.finishedAt ? papersHref(id, { result: "include" }) : papersHref(id)} className={cn(ABOVE, FIGURE_LINK, "block w-fit text-xs tabular-nums text-muted-foreground hover:text-foreground")}>
                              {row.finishedAt ? `${num(stands.include)} included of ${num(total)}` : `${num(settled)} of ${num(total)} settled`}
                            </NextLink>
                          </span>
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5 [grid-area:status] @5xl:row-span-2">
                            {forYou ? <LinkChip href={screenHref(id)} tone="primary" icon={ListChecks} className="relative shrink-0">{num(forYou)} for you to screen</LinkChip> : null}
                            {conflicts ? <LinkChip href={screenHref(id, { queue: "conflicts" })} tone="info" icon={GitCompare} className="relative shrink-0">{plural(conflicts, "conflict", "conflicts")} to settle</LinkChip> : null}
                            {/* It opens the paper the question is about, where it is answered. */}
                            {asked ? <LinkChip href={screenHref(id, { queue: "conflicts", paper: askedFirst })} tone="primary" icon={MessagesSquare} className="relative shrink-0">{plural(asked, "question", "questions")} for you</LinkChip> : null}
                            {/* What its models are doing shows beside your work. */}
                            {models === "reading" ? <LinkChip href={overviewHref(id)} className="relative shrink-0"><span className="flex items-center gap-1.5"><AiIcon working className="size-3.5" />{MODELS_READING}</span></LinkChip>
                              : models === "waiting" ? (ahead ? <LinkChip href={overviewHref(ahead.id)} icon={MODELS_SAY.waiting.icon} className="relative shrink-0">{MODELS_SAY.waiting.says} {ahead.name}</LinkChip> : null)
                              : models ? <LinkChip href={overviewHref(id)} tone={MODELS_SAY[models].stop ? "warning" : undefined} icon={MODELS_SAY[models].icon} className="relative shrink-0">{MODELS_SAY[models].says}</LinkChip>
                              : null}
                            {/* Where its papers stand shows where nothing waits for you. */}
                            {forYou || conflicts ? null
                              : row.finishedAt ? <LinkChip href={papersHref(id, { result: "include" })} tone="success" icon={CircleCheck} className="relative shrink-0">{num(stands.include)} included, finished {ago(row.finishedAt)}</LinkChip>
                              : models ? null
                              : stands.waiting ? <LinkChip href={papersHref(id, { result: "waiting" })} icon={Hourglass} className="relative shrink-0">{num(stands.waiting)} waiting for votes</LinkChip>
                              : stands.conflict ? <LinkChip href={papersHref(id, { result: "conflict" })} tone="info" icon={GitCompare} className="relative shrink-0">{num(stands.conflict)} in conflict, for {resolver} to settle</LinkChip>
                              : row.living ? <LinkChip href={overviewHref(id, "new-papers")} icon={RefreshCw} className="relative shrink-0">Up to date, next check {day(row.living.next)}</LinkChip>
                              : <LinkChip href={papersHref(id)} tone="success" icon={CircleCheck} className="relative shrink-0">Every paper is settled</LinkChip>}
                          </span>
                          <span className="flex justify-end [grid-area:menu] @5xl:row-span-2">
                            <RowMenu id={id} name={row.name} onOpen={(what) => setOver({ id, what })} />
                          </span>
                        </li>
                      </Group>
                    );
                  })}
                  {!rows.length ? (
                    <li className="flex flex-col items-center gap-2 px-4 py-14 text-center">
                      <p className="text-sm text-muted-foreground">{none}</p>
                      <Button variant="outline" size="sm" onClick={() => go({ q: null, show: null, page: null })}>Show every screening</Button>
                    </li>
                  ) : null}
                </ul>
                )}
                {show !== "you" && listed.hasPages ? <CommandCenterPagination className="border-t border-border-subtle p-4 sm:px-6" currentPage={listed.page} itemLabel="screenings" steps={{ canPrevious: listed.canPrevious, canNext: listed.canNext, onPrevious: listed.previous, onNext: listed.next, offset: listed.offset, shown: listed.items.length, total: words || runBy.by || !tally ? undefined : show === "open" ? tally.open : show === "finished" ? tally.finished : tally.open + tally.finished }} /> : null}
              </>
            )}
          </LibraryPageShell>
          {/* On a phone the last row can scroll clear of the assistant's button in the corner. */}
          <div aria-hidden className="h-6 lg:hidden" />
        </div>
        {over ? <RowDialogs key={`${over.id}:${over.what}`} id={over.id} start={over.what} onDone={() => setOver(null)} /> : null}
      </PageWrapper>
    </MotionConfig>
  );
}

/** A group's labelled row before its first screening on the page, under the default order. */
function Group({ label, note, count, children }: { label: string | null; /** What the group holds, where its name doesn't say: with it, a row that shows no question is a screening where nobody waits for an answer. */ note?: string; /** How many it holds, where that is known without reading every page. */ count?: number; children: ReactNode }) {
  return (
    <>
      {label ? (
        <li className="flex items-baseline gap-2 bg-inset px-4 py-2 text-xs font-medium sm:px-6">
          <span className="shrink-0">{label}</span>
          {count === undefined ? null : <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>}
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
function RowMenu({ id, name, onOpen }: { id: string; name: string; onOpen: (what: What) => void }) {
  return (
    <DropdownMenu>
      <TooltipHint label="More">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative size-8 text-muted-foreground" aria-label={`More for ${name}`}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
      </TooltipHint>
      <DropdownMenuContent align="end" className="w-auto min-w-56 [&_[role=menuitem]]:whitespace-nowrap">
        <RowMenuItems id={id} onOpen={onOpen} />
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
      <DropdownMenuItem onSelect={() => onOpen("people")}><Users />People</DropdownMenuItem>
      <DropdownMenuSeparator />
      {member ? (
        screening.finishedAt ? (
          <DropdownMenuItem onSelect={() => void open.reopen()}><RotateCcw />Reopen</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onOpen("finish")}><CircleCheck />Mark as finished</DropdownMenuItem>
        )
      ) : null}
      {member && modelsOf(screening).length && !screening.finishedAt ? (
        screening.paused ? (
          <DropdownMenuItem onSelect={() => void open.resume()}><Play />Resume models</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => void open.pause()}><CirclePause />Pause models</DropdownMenuItem>
        )
      ) : null}
      {member && growing(screening).length ? <DropdownMenuItem disabled={Boolean(screening.checking)} onSelect={() => void open.check()}><RefreshCw />Check for new papers</DropdownMenuItem> : null}
      <DropdownMenuItem asChild><NextLink href={newHref(id)}><Copy />Duplicate as a new screening</NextLink></DropdownMenuItem>
      {member ? <DropdownMenuItem onSelect={() => onOpen("move")}><Move />Move to another workspace</DropdownMenuItem> : null}
      {member && !open.isReviewer && !screening.finishedAt ? <DropdownMenuItem onSelect={() => void open.join()}><UserPlus />Join as a reviewer</DropdownMenuItem> : null}
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
  return useScreeningOverlays(useOpenScreening(id) ?? null, { start, onClosed: onDone }).overlays;
}
