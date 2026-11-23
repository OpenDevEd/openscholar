"use client";

// The list of a workspace's screenings: the ones waiting on you first. It takes the place of the
// rail the screening page has today.

import { useMemo, useState } from "react";
import { MotionConfig } from "motion/react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { AiIcon, CircleCheck, CirclePause, Clock, Coins, Copy, GitCompare, ListChecks, MoreHorizontal, Move, Plus, RefreshCw, RotateCcw, Settings2, Trash2 } from "@/components/icons";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipHint } from "@/components/ui/tooltip";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { HOME, accessOf, activeReviewers, ago, day, modelsOf, personOf, standing, workspaceOf, type Screening, lookOf } from "./data";
import { MoveDialog } from "./dialogs";
import { EffectList } from "./effects";
import { MockStates } from "./mock-states";
import { ResultBar, ReviewerStack } from "./parts";
import { isReading, paperCredits, useMock } from "./store";
import { ConfirmChange } from "./team";

type Sort = "recent" | "name";
type Show = "all" | "you" | "open" | "finished";
const PAGE = 6;
const ROW = 77;

export function ScreeningsIndex() {
  const store = useMock();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [show, setShow] = useState<Show>("all");
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<Screening | null>(null);
  const [by, setBy] = useState("anyone");
  const [moving, setMoving] = useState<Screening | null>(null);
  const me = store.viewer;

  const all = useMemo(
    () =>
      store.screenings.flatMap((screening) => {
        // Someone from outside the workspace sees the ones shared with them.
        const access = accessOf(screening, me);
        if (!access) return [];
        const state = standing(screening, "abstract");
        const mine = (at: typeof state) => at.papers.filter((paper) => !at.settled[paper.id]!.final && at.votes[paper.id]!.some((one) => one.reviewer.id === me && !one.vote)).length;
        const later = screening.fullText ? standing(screening, "fullText") : null;
        const [onAbstract, onFullText] = [mine(state), later ? mine(later) : 0];
        const forYou = onAbstract + onFullText;
        const conflicts = screening.rule.resolver === me || screening.createdBy === me ? state.counts.conflict : 0;
        const reading = !screening.finishedAt && modelsOf(screening).some((model) => (screening.reached.abstract[model.id] ?? 0) < state.papers.length);
        const ahead = screening.after ? store.screenings.find((one) => one.id === screening.after) : undefined;
        const models = modelsOf(screening);
        // What its models are doing, where they still have papers to read.
        const held = !reading ? null : screening.gathered !== undefined ? ("gathering" as const) : screening.paused ? ("paused" as const) : models.every((model) => paperCredits(model.model!, "abstract") > store.wallet) ? ("credits" as const) : ahead && isReading(ahead) ? ("waiting" as const) : null;
        // What it has included: at full text where it has that stage.
        const included = later ? later.counts.include : state.counts.include;
        return [{ screening, state, included, access, firstStage: onAbstract || !onFullText ? "" : "&stage=fullText", forYou: screening.finishedAt ? 0 : forYou, conflicts: screening.finishedAt ? 0 : conflicts, reading, held, ahead }];
      }),
    [store.screenings, store.wallet, me],
  );
  const starters = [...new Set(all.map((row) => row.screening.createdBy))];
  const rows = useMemo(() => {
    const words = search.trim().toLowerCase();
    const found = all.filter((row) => (!words || row.screening.name.toLowerCase().includes(words)) && (by === "anyone" || row.screening.createdBy === by) && (show === "all" || (show === "finished" ? Boolean(row.screening.finishedAt) : show === "you" ? row.forYou + row.conflicts > 0 : !row.screening.finishedAt)));
    // What waits on you first, then what is running, then what is finished, newest first within each.
    const rank = (row: (typeof all)[number]) => (row.forYou + row.conflicts ? 0 : row.screening.finishedAt ? 2 : 1);
    return [...found].sort((a, b) => (sort === "name" ? a.screening.name.localeCompare(b.screening.name) : rank(a) - rank(b) || b.screening.createdAt - a.screening.createdAt));
  }, [all, search, show, sort, by]);
  const pager = pagerOf(rows.length, PAGE, page, setPage);
  const tally = { all: all.length, you: all.filter((row) => row.forYou + row.conflicts > 0).length, open: all.filter((row) => !row.screening.finishedAt).length, finished: all.filter((row) => row.screening.finishedAt).length };

  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        <div className={`contents ${AVATARS_FADE_IN}`}>
          <LibraryPageShell
            icon={ListChecks}
            title="Screening"
            filters={all.length ? <CommandCenterFilters sortOptions={[{ value: "recent", label: "Needs you first" }, { value: "name", label: "Name" }]} currentSort={sort} onSortChange={setSort} searchFilter={search} onSearchChange={(next) => { setPage(1); setSearch(next); }} placeholder="Find a screening" /> : undefined}
            actions={
              <Button asChild size="sm" className={BAR_ACTION}>
                <NextLink href="/screening/mock/new"><Plus /><span className={BAR_LABEL}>New screening</span></NextLink>
              </Button>
            }
          >
            {!all.length ? (
              <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary"><ListChecks className="size-6" /></span>
                <h2 className="text-lg font-semibold tracking-tight">Decide which papers belong in your review</h2>
                <p className="max-w-md text-sm text-muted-foreground">Bring papers from searches, collections or your own files, set your criteria, and screen them by hand, with your team, with AI models as extra reviewers, or all three.</p>
                <Button asChild className="mt-2"><NextLink href="/screening/mock/new"><Plus />New screening</NextLink></Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-subtle p-4 sm:px-6">
                  <Segmented
                    label="Which screenings"
                    value={show}
                    onChange={(next) => { setPage(1); setShow(next); }}
                    options={[
                      { id: "all", label: "All", detail: <span className="tabular-nums text-muted-foreground">{tally.all}</span> },
                      { id: "you", label: "Needs you", detail: <span className="tabular-nums text-muted-foreground">{tally.you}</span> },
                      { id: "open", label: "In progress", detail: <span className="tabular-nums text-muted-foreground">{tally.open}</span> },
                      { id: "finished", label: "Finished", detail: <span className="tabular-nums text-muted-foreground">{tally.finished}</span> },
                    ]}
                  />
                  {starters.length > 1 ? (
                    <Select value={by} onValueChange={(next) => { setPage(1); setBy(next); }}>
                      <SelectTrigger aria-label="Started by" className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="anyone">Started by anyone</SelectItem>
                        {starters.map((id) => <SelectItem key={id} value={id}><span className="flex items-center gap-2"><IdentityAvatar name={personOf(id)?.name ?? ""} imageUrl={personOf(id)?.imageUrl} className="size-4" />{id === me ? "Started by you" : personOf(id)?.name}</span></SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
                {/* A full page's height while there are pages, so a short last page doesn't move the pager. */}
                <ul className="divide-y divide-border-subtle" style={{ minHeight: pager.pages > 1 ? PAGE * ROW : undefined }}>
                  {rows.slice((pager.page - 1) * PAGE, pager.page * PAGE).map(({ screening, state, included, access, firstStage, forYou, conflicts, reading, held, ahead }) => {
                    const starter = personOf(screening.createdBy);
                    const workspace = workspaceOf(screening);
                    const atFullText = screening.fullText ? state.counts.include + state.counts.maybe : 0;
                    return (
                      <li key={screening.id} className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted sm:px-6 @3xl:grid-cols-[minmax(0,2.2fr)_8.5rem_minmax(7rem,1fr)_16rem_2rem]" style={{ minHeight: ROW }}>
                        {/* The whole row opens the screening; its menu sits above that link. */}
                        <NextLink href={`/screening/mock/${screening.id}`} aria-label={`Open ${screening.name}`} className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50" />
                        <span className="pointer-events-none min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-semibold">{screening.name}</span>
                            {workspace !== HOME ? <span className="flex min-w-0 @max-3xl:hidden"><WorkspaceTag size="sm" workspace={lookOf(workspace, screening.createdBy)} /></span> : null}
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <IdentityAvatar name={starter?.name ?? ""} imageUrl={starter?.imageUrl} className="size-4" />
                            <span className="truncate">{screening.createdBy === me ? "You" : (starter?.name ?? "Someone")}, {ago(screening.createdAt)}</span>
                            <Chip className="h-5 px-1.5">{state.papers.length.toLocaleString("en-GB")} papers</Chip>
                            {atFullText ? <Chip className="h-5 px-1.5 @max-3xl:hidden">{atFullText} at full text</Chip> : null}
                            {screening.living ? <Chip icon={RefreshCw} className="h-5 bg-success/12 px-1.5 ink-success">Living</Chip> : null}
                          </span>
                        </span>
                        <span className="pointer-events-none flex justify-end @3xl:justify-start"><ReviewerStack reviewers={activeReviewers(screening)} max={6} /></span>
                        <span className="relative col-span-2 @3xl:col-span-1"><ResultBar counts={state.counts} /></span>
                        <span className="pointer-events-none col-span-2 flex flex-wrap items-center justify-end gap-1.5 @3xl:col-span-1">
                          {workspace !== HOME ? <span className="me-auto flex min-w-0 @3xl:hidden"><WorkspaceTag size="sm" workspace={lookOf(workspace, screening.createdBy)} /></span> : null}
                          {forYou ? <NextLink href={`/screening/mock/${screening.id}?view=screen${firstStage}`} className="pointer-events-auto relative rounded-md outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring/50"><Chip icon={ListChecks} className="bg-primary/12 text-primary">{forYou} for you to screen</Chip></NextLink> : null}
                          {conflicts ? <NextLink href={`/screening/mock/${screening.id}?view=screen&queue=conflicts`} className="pointer-events-auto relative rounded-md outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring/50"><Chip icon={GitCompare} className="bg-info/12 text-info">{conflicts} {conflicts === 1 ? "conflict" : "conflicts"} to settle</Chip></NextLink> : null}
                          {screening.finishedAt ? <Chip icon={CircleCheck}>{included.toLocaleString("en-GB")} included, finished {ago(screening.finishedAt)}</Chip> : held === "gathering" ? <Chip>Getting its papers</Chip> : held === "paused" ? <Chip icon={CirclePause}>Models paused</Chip> : held === "credits" ? <Chip icon={Coins} className="bg-warning/12 ink-warning">Out of credits</Chip> : held === "waiting" ? <Chip icon={Clock}>Models start after {ahead?.name}</Chip> : !forYou && !conflicts ? (reading ? <Chip><AiIcon working className="size-3.5" />Models reading</Chip> : <Chip>{state.counts.waiting ? `${state.counts.waiting.toLocaleString("en-GB")} waiting for votes` : state.counts.conflict ? `${state.counts.conflict.toLocaleString("en-GB")} in conflict, for ${personOf(screening.rule.resolver)?.name.split(" ")[0] ?? "its starter"} to settle` : screening.living ? `Up to date, looks again on ${day(screening.living.next)}` : "Every paper is settled"}</Chip>) : null}
                        </span>
                        {!access.member ? <span className="@max-3xl:hidden" /> : (
                        <DropdownMenu>
                          <TooltipHint label="More">
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="relative size-8 text-muted-foreground @max-3xl:hidden" aria-label={`More for ${screening.name}`}><MoreHorizontal /></Button>
                            </DropdownMenuTrigger>
                          </TooltipHint>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onSelect={() => router.push(`/screening/mock/${screening.id}/settings`)}><Settings2 />Settings</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => router.push(`/screening/mock/new?from=${screening.id}`)}><Copy />Run again with these settings</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setMoving(screening)}><Move />Move to another workspace</DropdownMenuItem>
                            {screening.finishedAt ? (
                              <DropdownMenuItem onSelect={() => store.update(screening.id, (s) => ({ ...s, finishedAt: undefined }), { what: "Reopened the screening" })}><RotateCcw />Reopen</DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => store.update(screening.id, (s) => ({ ...s, finishedAt: Date.now() }), { what: "Marked the screening as finished" })}><CircleCheck />Mark as finished</DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(screening)}><Trash2 />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        )}
                      </li>
                    );
                  })}
                  {!rows.length ? (
                    <li className="flex flex-col items-center gap-2 px-4 py-14 text-center">
                      <p className="text-sm text-muted-foreground">{search.trim() ? "No screening by that name." : show === "you" ? "Nothing waits for you." : "No screening here."}</p>
                      <Button variant="outline" size="sm" onClick={() => { setSearch(""); setShow("all"); setBy("anyone"); }}>Show every screening</Button>
                    </li>
                  ) : null}
                </ul>
                {pager.pages > 1 ? <CommandCenterPagination className="border-t border-border-subtle p-4 sm:px-6" currentPage={pager.page} totalPages={pager.pages} onPageChange={setPage} totalItems={pager.total} itemsPerPage={PAGE} itemLabel="screenings" /> : null}
              </>
            )}
          </LibraryPageShell>
        </div>
        <ConfirmChange open={deleting !== null} title={deleting ? `Delete “${deleting.name}”?` : ""} confirm="Delete" onClose={() => setDeleting(null)} onConfirm={() => deleting && store.remove(deleting.id)}>
          <EffectList lines={["Its votes and its settings go with it", "Papers it saved to a collection stay there"]} />
        </ConfirmChange>
        {moving ? <MoveDialog open onClose={() => setMoving(null)} screening={moving} me={me} onMove={(to, what) => store.update(moving.id, (s) => ({ ...s, workspace: to }), { what })} /> : null}
        <MockStates />
      </PageWrapper>
    </MotionConfig>
  );
}
