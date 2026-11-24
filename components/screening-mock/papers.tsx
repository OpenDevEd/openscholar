"use client";

// The open screening's Papers view: every paper as a row, a narrow column per reviewer, and where
// the paper stands. A row opens the paper beside the table, with who said what and when.

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { ChevronLeft, ChevronRight, CircleHelp, Download, GitCompare, Quote, RefreshCw, Search, Undo2, X } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { AnimatedNumber, AnswerMark, Chip, ClippedChip, Stars } from "@/components/screening/parts";
import { EASE } from "@/components/settings/model-map";
import { Segmented, pagerOf } from "@/components/settings/parts";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/lib/hooks";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DECISIONS, DECISION_LABEL, NOW, OTHER_REASONS, RESULTS, RESULT_LABEL, day, activeReviewers, ago, personOf, failedLabel, reasonOf, scoreOf, type Decision, type Paper } from "./data";
import { RESULT_STYLE, ResultChip, ReviewerMark, ReviewerStack, Tally, VoteMark } from "./parts";
import { Evidence, Matrix } from "./screen";
import type { Open } from "./store";
import { useWorkspace } from "./workspace";

const PAGE = 20;
const ROW = 57;

/**
 * Where the table is, kept in the address: the result tab, what narrows it, its order, its page and the
 * paper open beside it. `added` is which arrival of papers is shown: all of them, the ones it started
 * with ("start"), or the ones a look brought (its time). `voted` is your own vote, as a way to find
 * papers: the result tabs count only what has settled.
 */
const PLACE = {
  result: parseAsStringLiteral(["all", ...RESULTS] as const).withDefault("all"),
  by: parseAsStringLiteral(["reviewers", "criteria"] as const).withDefault("reviewers"),
  source: parseAsString.withDefault("all"),
  voted: parseAsStringLiteral(["any", ...DECISIONS, "none"] as const).withDefault("any"),
  added: parseAsString.withDefault("all"),
  sort: parseAsStringLiteral(["added", "title", "newest", "split", "points"] as const).withDefault("added"),
  q: parseAsString.withDefault(""),
  page: parseAsInteger.withDefault(1),
  paper: parseAsString,
};

/** The Papers table as a page of the open screening. */
export function PapersPage() {
  const { open } = useWorkspace();
  return <Papers open={open} />;
}

function Papers({ open }: { open: Open }) {
  const { screening, papers, votes, settled, counts } = open;
  const reviewers = activeReviewers(screening);
  const criteria = screening.criteria;
  // Another tab, filter, order or page is a step Back returns from. Typing in the search box changes the address in place.
  const [{ result: filter, by: columns, source: from, voted: yours, added, sort, q: query, page, paper: opened }, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  /** Narrows or reorders the table, which starts again from its first page. */
  const go = (next: Parameters<typeof setPlace>[0]) => void setPlace({ page: null, ...next });
  // A paper opened from the table is a step Back closes: closing it steps back. One reached by its address closes in place.
  const openedHere = useRef(false);
  const show = (id: string) => {
    if (opened) return void setPlace({ paper: id }, { history: "replace" });
    openedHere.current = true;
    void setPlace({ paper: id });
  };
  const close = () => {
    if (!openedHere.current) return void setPlace({ paper: null }, { history: "replace" });
    openedHere.current = false;
    window.history.back();
  };
  const [picked, setPicked] = useState<string[]>([]);
  // A paper opens beside the table where there is room for both, and over the page where there isn't.
  const beside = useMediaQuery("(min-width: 1280px)");
  const top = useRef<HTMLDivElement>(null);
  // The table keeps the room it gave the paper until the paper has finished leaving, so the two never change places.
  const [made, setMade] = useState(false);

  const rows = useMemo(() => {
    const words = query.trim().toLowerCase();
    const list = papers.filter((paper) => (filter === "all" || settled[paper.id]!.result === filter) && (from === "all" || paper.source === from) && (added === "all" || (added === "start" ? paper.batch === undefined : String(paper.batch) === added)) && (yours === "any" || (yours === "none" ? votes[paper.id]!.some((one) => one.reviewer.id === open.me && !one.vote) : open.myVote(paper)?.decision === yours)) && (!words || `${paper.title} ${paper.authors.join(" ")}`.toLowerCase().includes(words)));
    const split = (paper: Paper) => new Set(votes[paper.id]!.flatMap((one) => one.vote?.decision ?? [])).size;
    if (sort === "title") return [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "newest") return [...list].sort((a, b) => b.year - a.year);
    if (sort === "split") return [...list].sort((a, b) => split(b) - split(a));
    if (sort === "points") return [...list].sort((a, b) => scoreOf(screening, votes[b.id]!).points - scoreOf(screening, votes[a.id]!).points);
    return list;
  }, [papers, settled, votes, filter, from, added, yours, query, sort, screening, open]);
  // When papers joined after the start: each check that brought some, and each source added later.
  const arrivals = [...new Set(papers.flatMap((paper) => paper.batch ?? []))].sort((a, b) => b - a);
  const newest = arrivals[0];
  const pager = pagerOf(rows.length, PAGE, page, (next) => void setPlace({ page: next }));
  const shown = rows.slice((pager.page - 1) * PAGE, pager.page * PAGE);
  const paper = papers.find((one) => one.id === opened);
  if (paper && beside && !made) setMade(true);
  const room = made && beside;
  const chosen = picked.filter((id) => papers.some((one) => one.id === id));
  const allShown = shown.length > 0 && shown.every((one) => chosen.includes(one.id));

  // Escape closes the paper beside the table. The keyboard is the outside system.
  useEffect(() => {
    if (!opened) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !(event.target as HTMLElement | null)?.closest("[role=dialog], [role=menu], [role=listbox]") && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opened]);

  const settleAll = (decision: Decision) => {
    for (const id of chosen) {
      const one = papers.find((p) => p.id === id);
      if (one && settled[id]!.result === "conflict") open.resolve(one, decision);
    }
    setPicked([]);
  };
  const exportPicked = (as: "csv" | "ris") => {
    const picks = chosen.flatMap((id) => papers.find((p) => p.id === id) ?? []);
    const lines = [["paper", "year", "result", ...reviewers.map((r) => r.name)], ...picks.map((one) => [one.title, one.year, RESULT_LABEL[settled[one.id]!.result], ...reviewers.map((r) => { const vote = votes[one.id]!.find((v) => v.reviewer.id === r.id)?.vote; return vote ? DECISION_LABEL[vote.decision] : ""; })])];
    const text = as === "csv"
      ? lines.map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n")
      : picks.map((paper) => ["TY  - JOUR", `TI  - ${paper.title}`, ...paper.authors.filter((a) => a !== "and others").map((a) => `AU  - ${a}`), `PY  - ${paper.year}`, `JO  - ${paper.venue}`, ...(paper.sentences.length ? [`AB  - ${paper.sentences.join(" ")}`] : []), "ER  - "].join("\n")).join("\n\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: as === "csv" ? "text/csv" : "application/x-research-info-systems" }));
    link.download = `selected-papers.${as}`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const conflictsPicked = chosen.filter((id) => settled[id]!.result === "conflict").length;

  if (!papers.length) return <p className="px-6 py-20 text-center text-sm text-muted-foreground">{open.gathering ? "Its papers are on their way. They show here as they arrive." : "This screening has no papers yet."}</p>;

  return (
    <div ref={top} className="@container/papers scroll-mt-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+1rem)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle p-4 sm:px-6">
        <Segmented
          label="Where the papers stand"
          value={filter}
          onChange={(next) => go({ result: next })}
          fill="labels"
          className="@6xl/papers:w-auto"
          options={[
            { id: "all" as const, label: "All", detail: <span className="tabular-nums text-muted-foreground">{papers.length}</span> },
            ...RESULTS.map((result) => ({ id: result, label: RESULT_LABEL[result], icon: RESULT_STYLE[result].icon, detail: <span className="tabular-nums text-muted-foreground"><AnimatedNumber value={counts[result]} /></span> })),
          ]}
        />
        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2 @max-2xl/papers:w-full">
          <Segmented label="Columns" className="@max-2xl/papers:hidden" value={columns} onChange={(next) => void setPlace({ by: next })} options={[{ id: "reviewers", label: "By reviewer" }, { id: "criteria", label: "By criterion" }]} />
          {screening.sources.length > 1 ? (
            <Select value={from} onValueChange={(next) => go({ source: next })}>
              <SelectTrigger aria-label="Source" className="h-8 w-44 text-xs @max-2xl/papers:hidden"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every source</SelectItem>
                {screening.sources.map((source) => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          {open.isReviewer ? (
            <Select value={yours} onValueChange={(next) => go({ voted: next as typeof yours })}>
              <SelectTrigger aria-label="Your vote" className="h-8 w-44 text-xs @max-2xl/papers:hidden"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Whatever you voted</SelectItem>
                <SelectItem value="include">You voted include</SelectItem>
                <SelectItem value="maybe">You voted maybe</SelectItem>
                <SelectItem value="exclude">You voted exclude</SelectItem>
                <SelectItem value="none">Waiting for your vote</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          {arrivals.length ? (
            <Select value={added} onValueChange={(next) => go({ added: next })}>
              <SelectTrigger aria-label="When they were added" className="h-8 w-44 text-xs @max-2xl/papers:hidden"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Added at any time</SelectItem>
                {arrivals.map((at) => <SelectItem key={at} value={String(at)}>Added {at > NOW ? "just now" : day(at)}</SelectItem>)}
                <SelectItem value="start">There from the start</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          <Select value={sort} onValueChange={(next) => go({ sort: next as typeof sort })}>
            <SelectTrigger aria-label="Order" className="h-8 w-40 text-xs @max-2xl/papers:hidden"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="added">As they were added</SelectItem>
              <SelectItem value="split">Most divided first</SelectItem>
              <SelectItem value="points">Most points first</SelectItem>
              <SelectItem value="title">Title, A to Z</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
            </SelectContent>
          </Select>
          {query.trim() || from !== "all" ? <span className="text-xs tabular-nums text-muted-foreground">{rows.length.toLocaleString("en-GB")} of {(filter === "all" ? papers.length : counts[filter]).toLocaleString("en-GB")}</span> : null}
          <div className="relative w-52 @max-2xl/papers:w-full">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => void setPlace({ q: event.target.value, page: null }, { history: "replace" })} placeholder="Find a paper" aria-label="Find a paper" className="h-8 rounded-full ps-8 text-sm" />
          </div>
          <Popover>
            <TooltipHint label="What the marks mean">
              <PopoverTrigger asChild><Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="What the marks mean"><CircleHelp /></Button></PopoverTrigger>
            </TooltipHint>
            <PopoverContent align="end" className="w-72 space-y-2 p-3 text-sm">
              {DECISIONS.map((decision) => <p key={decision} className="flex items-center gap-3"><VoteMark vote={{ decision }} who="A reviewer" />Voted {DECISION_LABEL[decision].toLowerCase()}</p>)}
              <p className="flex items-center gap-3"><VoteMark vote={{ decision: "include" }} hidden who="A reviewer" />Voted, hidden until you vote on it</p>
              <p className="flex items-center gap-3"><VoteMark who="A reviewer" />Hasn&apos;t voted yet</p>
              <p className="flex items-center gap-3"><span className="size-6 shrink-0" />Blank: the paper isn&apos;t theirs to vote on</p>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* What can be done with the chosen papers. It floats over the foot of the page, so ticking a row moves no row. */}
      <AnimatePresence>
        {chosen.length ? (
          <motion.div key="chosen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2, ease: EASE }} className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4 max-lg:bottom-24">
            <div className="flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-border-subtle bg-card px-3 py-2 shadow-lg">
              <span className="px-1 text-sm font-medium tabular-nums">{chosen.length} chosen</span>
              {conflictsPicked && open.canResolve ? (
                <>
                  <span className="text-xs text-muted-foreground">Settle the {conflictsPicked} in conflict as</span>
                  {[...DECISIONS].reverse().map((decision) => <Button key={decision} variant="outline" size="sm" className="h-7" onClick={() => settleAll(decision)}>{DECISION_LABEL[decision]}</Button>)}
                </>
              ) : null}
              <Button variant="outline" size="sm" className="h-7" onClick={() => exportPicked("ris")}><Download />RIS, for a reference manager</Button>
              <Button variant="outline" size="sm" className="h-7" onClick={() => exportPicked("csv")}><Download />CSV</Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setPicked([])}>Clear</Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* A phone has no room for the filters' menus: what narrows the list is said here, and can be dropped. */}
      {added !== "all" || yours !== "any" ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2 @2xl/papers:hidden">
          <span className="text-xs text-muted-foreground">{rows.length.toLocaleString("en-GB")} of {papers.length.toLocaleString("en-GB")} papers</span>
          {added !== "all" ? <Chip icon={RefreshCw}>{added === "start" ? "There from the start" : `Added ${Number(added) > NOW ? "just now" : day(Number(added))}`}</Chip> : null}
          {yours !== "any" ? <Chip>{yours === "none" ? "Waiting for your vote" : `You voted ${yours}`}</Chip> : null}
          <Button variant="ghost" size="sm" className="ms-auto h-7 text-xs" onClick={() => go({ voted: null, added: null })}>Show every paper</Button>
        </div>
      ) : null}
      <div className={cn("grid", room && "grid-cols-[minmax(0,1fr)_30rem]")}>
        <div className="min-w-0">
          {/* A full page's height while there are pages, so a short last page doesn't move the pager. */}
          <div className="overflow-x-auto" style={{ minHeight: pager.pages > 1 ? (PAGE + 1) * ROW : undefined }}>
            {shown.length ? (
              <>
                <ul className="divide-y divide-border-subtle @2xl/papers:hidden">
                  {shown.map((one) => {
                    const visible = open.canSee(one);
                    return (
                      <li key={one.id}>
                        <button type="button" aria-expanded={opened === one.id} onClick={() => (opened === one.id ? close() : show(one.id))} className={cn("block w-full space-y-2 px-4 py-3 text-start transition-colors hover:bg-muted", opened === one.id && "bg-muted")}>
                          <span className="line-clamp-2 text-sm font-medium">{one.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{one.authors.join(", ")}, {one.year}</span>
                          <span className="flex items-center gap-1">
                            {votes[one.id]!.map(({ reviewer, vote }) => <VoteMark key={reviewer.id} vote={vote} hidden={!visible && reviewer.id !== open.me} who={reviewer.name} />)}
                            <ResultChip result={settled[one.id]!.result} className="ms-auto" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <Table className="table-fixed @max-2xl/papers:hidden" style={{ minWidth: columns === "criteria" ? `${(room ? 26 : 36) + criteria.length * 6}rem` : `${(room ? 28 : 40) + reviewers.length * 2.75}rem` }}>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-10 ps-4 sm:ps-6">
                        <Checkbox checked={allShown} onCheckedChange={() => setPicked(allShown ? chosen.filter((id) => !shown.some((one) => one.id === id)) : [...new Set([...chosen, ...shown.map((one) => one.id)])])} aria-label="Choose every paper on this page" />
                      </TableHead>
                      <TableHead>Paper</TableHead>
                      {columns === "reviewers"
                        ? reviewers.map((reviewer) => (
                            <TableHead key={reviewer.id} className="w-11 px-0 text-center">
                              <TooltipHint label={reviewer.name}>
                                <span tabIndex={0} className="inline-flex align-middle"><ReviewerMark reviewer={reviewer} /></span>
                              </TooltipHint>
                            </TableHead>
                          ))
                        : criteria.map((criterion) => (
                            <TableHead key={criterion.key} className="h-auto w-24 px-1 py-2 text-center align-bottom whitespace-normal">
                              <TooltipHint label={criterion.text}>
                                <span tabIndex={0} className="line-clamp-2 text-xs leading-4">{criterion.short}</span>
                              </TooltipHint>
                            </TableHead>
                          ))}
                      <TableHead className={cn("w-52 ps-6", room || columns === "criteria" ? "hidden" : "@max-5xl/papers:hidden")}>Why</TableHead>
                      <TableHead className={cn("pe-4 text-end sm:pe-6", room ? "w-40" : "w-48")}>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((one) => {
                      const visible = open.canSee(one);
                      const cast = votes[one.id]!;
                      return (
                        <TableRow key={one.id} data-state={opened === one.id ? "selected" : undefined} className="cursor-pointer" style={{ height: ROW }} onClick={() => (opened === one.id ? close() : show(one.id))}>
                          <TableCell className="ps-4 sm:ps-6" onClick={(event) => event.stopPropagation()}>
                            <Checkbox checked={chosen.includes(one.id)} onCheckedChange={() => setPicked(chosen.includes(one.id) ? chosen.filter((id) => id !== one.id) : [...chosen, one.id])} aria-label={`Choose ${one.title}`} />
                          </TableCell>
                          <TableCell className="py-2">
                            <button type="button" aria-expanded={opened === one.id} className="block w-full min-w-0 text-start outline-none focus-visible:underline">
                              <span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium">{one.title}</span>{one.batch !== undefined && one.batch === newest ? <span className="shrink-0 rounded-full bg-success/12 px-1.5 text-2xs font-medium leading-5 ink-success">New</span> : null}</span>
                              <span className="block truncate text-xs text-muted-foreground">{one.authors.join(", ")}, {one.year}, {one.venue}</span>
                            </button>
                          </TableCell>
                          {columns === "reviewers"
                            ? reviewers.map((reviewer) => {
                                const theirs = cast.find((entry) => entry.reviewer.id === reviewer.id);
                                return <TableCell key={reviewer.id} className="px-0 text-center">{theirs ? <VoteMark vote={theirs.vote} failed={theirs.failed} hidden={!visible && reviewer.id !== open.me} who={reviewer.name} className="align-middle" /> : null}</TableCell>;
                              })
                            : criteria.map((criterion) => {
                                const given = visible ? [...new Set(cast.flatMap((entry) => entry.vote?.answers[criterion.key] ?? []))] : [];
                                return (
                                  <TableCell key={criterion.key} className="px-1 text-center">
                                    {given.length === 1 ? (
                                      <span className="inline-flex align-middle"><AnswerMark answer={given[0]!} label={criterion.short} /></span>
                                    ) : given.length > 1 ? (
                                      <TooltipHint label="The reviewers answered this differently">
                                        <span tabIndex={0} className="inline-flex size-6 items-center justify-center rounded-md bg-primary/12 align-middle text-primary"><GitCompare className="size-3.5" /></span>
                                      </TooltipHint>
                                    ) : null}
                                  </TableCell>
                                );
                              })}
                          <TableCell className={cn("ps-6", room || columns === "criteria" ? "hidden" : "@max-5xl/papers:hidden")}><Why paper={one} open={open} visible={visible} /></TableCell>
                          <TableCell className="pe-4 text-end sm:pe-6">
                            <span className="inline-flex items-center gap-1.5">
                              {/* A result a person settled, against the votes, carries their face. */}
                              {settled[one.id]!.resolvedBy ? (
                                <TooltipHint label={`Settled by ${personOf(settled[one.id]!.resolvedBy!)?.name ?? "a reviewer"} after a conflict`}>
                                  <span tabIndex={0} className="flex rounded-full"><IdentityAvatar name={personOf(settled[one.id]!.resolvedBy!)?.name ?? ""} imageUrl={personOf(settled[one.id]!.resolvedBy!)?.imageUrl} className="size-5" /></span>
                                </TooltipHint>
                              ) : null}
                              <ResultChip result={settled[one.id]!.result} />
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
                <p className="text-sm text-muted-foreground">No paper here matches.</p>
                <Button variant="outline" size="sm" onClick={() => go({ q: null, source: null, voted: null, result: null, added: null })}>Show every paper</Button>
              </div>
            )}
          </div>
          {pager.pages > 1 ? <CommandCenterPagination className="border-t border-border-subtle p-4 sm:px-6" currentPage={pager.page} totalPages={pager.pages} onPageChange={(next) => { pager.setPage(next); top.current?.scrollIntoView({ block: "start" }); }} totalItems={pager.total} itemsPerPage={PAGE} itemLabel="papers" /> : null}
        </div>

        <AnimatePresence initial={false} onExitComplete={() => setMade(false)}>
          {paper && beside ? (
            <motion.aside key="panel" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.25, ease: EASE }} className="min-w-0 border-s border-border-subtle">
              <PaperPanel key={paper.id} paper={paper} open={open} onClose={close} place={{ at: shown.indexOf(paper), of: shown.length }} onStep={(by) => { const next = shown[shown.indexOf(paper) + by]; if (next) show(next.id); }} />
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>
      <Sheet open={Boolean(paper) && !beside} onOpenChange={(next) => !next && close()}>
        <SheetContent showCloseButton={false} className={`w-full gap-0 overflow-y-auto p-0 sm:max-w-lg ${AVATARS_FADE_IN}`}>
          <SheetTitle className="sr-only">{paper?.title ?? "Paper"}</SheetTitle>
          <SheetDescription className="sr-only">Its abstract, its votes and its result</SheetDescription>
          {paper ? <PaperPanel key={paper.id} paper={paper} open={open} onClose={close} place={{ at: shown.indexOf(paper), of: shown.length }} onStep={(by) => { const next = shown[shown.indexOf(paper) + by]; if (next) show(next.id); }} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** What put a paper where it stands: the criterion it failed, how its reviewers split, or whose vote it waits for. */
function Why({ paper, open, visible }: { paper: Paper; open: Open; visible: boolean }) {
  const state = open.settled[paper.id]!;
  const entries = open.votes[paper.id]!;
  const cast = entries.flatMap((one) => one.vote ?? []);
  if (state.result === "waiting") {
    const missing = entries.filter((one) => !one.vote && !one.failed).map((one) => one.reviewer);
    return missing.length ? <span className="flex items-center gap-2 text-xs text-muted-foreground">Waiting on<ReviewerStack reviewers={missing} max={5} /></span> : <span className="text-xs text-muted-foreground">Nobody reads it yet</span>;
  }
  if (!visible) return null;
  if (state.result === "conflict" || state.resolvedBy) {
    return <Tally votes={cast} />;
  }
  if (state.result === "exclude") {
    const reason = reasonOf(entries, state);
    return reason ? <span className="block truncate text-xs text-muted-foreground">{failedLabel(reason, open.screening.criteria)}</span> : null;
  }
  const unclear = state.result === "maybe" ? open.screening.criteria.find((criterion) => criterion.must && cast.some((vote) => vote.answers[criterion.key] === "unclear")) : undefined;
  if (unclear) return <span className="block truncate text-xs text-muted-foreground">Unclear: {unclear.short}</span>;
  // An included paper carries the stars its answers earn, as it is saved with them.
  const score = state.result === "include" && open.screening.criteria.length ? scoreOf(open.screening, entries) : null;
  return score ? (
    <TooltipHint label={`${score.points} of ${score.of} points from its reviewers' answers`}>
      <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-md text-xs tabular-nums text-muted-foreground"><Stars count={score.stars} />{score.points} of {score.of} points</span>
    </TooltipHint>
  ) : null;
}

/** One paper beside the table: what it says, who voted what on each criterion and when, your own vote where it is yours to give, and the final decision when they disagree. */
function PaperPanel({ paper, open, onClose, onStep, place }: { paper: Paper; open: Open; onClose: () => void; onStep: (by: 1 | -1) => void; place: { at: number; of: number } }) {
  const { screening, settled, votes } = open;
  const [shown, setShown] = useState<{ reviewer: string; criterion: string } | null>(null);
  // What is being decided in the panel: your own vote, or the paper's result. Excluding asks for the reason first.
  const [deciding, setDeciding] = useState<"vote" | "result" | null>(null);
  const [reasonFor, setReasonFor] = useState<"vote" | "result" | null>(null);
  const [note, setNote] = useState("");
  const state = settled[paper.id]!;
  const visible = open.canSee(paper);
  const cast = votes[paper.id]!;
  const mine = open.myVote(paper);
  const isMine = cast.some((one) => one.reviewer.id === open.me);
  const quoted = shown && visible ? screening.criteria.findIndex((c) => c.key === shown.criterion) : -1;
  const quoting = shown ? cast.find((one) => one.reviewer.id === shown.reviewer) : undefined;
  const source = screening.sources.find((one) => one.id === paper.source);
  const reasons = [...screening.criteria.map((criterion) => ({ key: criterion.key, label: `Not met: ${criterion.short.endsWith("…") ? criterion.text.replace(/\?$/, "") : criterion.short}` })), ...OTHER_REASONS];
  const settle = (kind: "vote" | "result", decision: Decision, reason?: string) => {
    if (kind === "vote") open.vote(paper, { decision, answers: { ...mine?.answers, ...(reason && screening.criteria.some((c) => c.key === reason) ? { [reason]: "no" as const } : {}) }, reason, note: note.trim() || undefined, at: Date.now() });
    else open.resolve(paper, decision, note.trim() || undefined, reason);
    setDeciding(null);
    setReasonFor(null);
    setNote("");
  };
  const buttons = (kind: "vote" | "result") =>
    reasonFor === kind ? (
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Why is it excluded?</p>
        {/* A reason no criterion covers is written in the note before it is saved. */}
        <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="A note with it. Needed for “Another reason”" aria-label="Note" className="h-8 text-sm" />
        {reasons.map((reason) => <button key={reason.key} type="button" disabled={reason.key === "other" && !note.trim()} onClick={() => settle(kind, "exclude", reason.key)} className="flex min-h-9 w-full items-center rounded-lg border border-border-subtle px-2.5 py-1.5 text-start text-sm transition-colors hover:border-foreground/30 disabled:opacity-50"><span className="line-clamp-2">{reason.label}</span></button>)}
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setReasonFor(null)}>Back</Button>
      </div>
    ) : (
      <div className="space-y-2">
        <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={kind === "vote" ? "A note for the others (optional)" : "Why, for the record (optional)"} aria-label="Note" className="h-8 text-sm" />
        <div className="grid grid-cols-3 gap-2">
          {[...DECISIONS].reverse().map((decision) => {
            const Icon = RESULT_STYLE[decision].icon;
            const on = kind === "vote" && mine?.decision === decision;
            return (
              <button key={decision} type="button" aria-pressed={on} onClick={() => (decision === "exclude" ? setReasonFor(kind) : settle(kind, decision))} className={cn("flex h-10 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors", on ? cn(RESULT_STYLE[decision].chip, "border-transparent ring-1 ring-current") : "border-border-subtle hover:bg-muted")}>
                <Icon className={cn("size-4", !on && (decision === "include" ? "ink-success" : decision === "maybe" ? "ink-warning" : "text-muted-foreground"))} />{DECISION_LABEL[decision]}
              </button>
            );
          })}
        </div>
      </div>
    );
  return (
    <div className="space-y-5 p-4 sm:p-6 xl:sticky xl:top-[calc(var(--app-navbar-height)+var(--page-header-height,4rem))] xl:max-h-[calc(100dvh-var(--app-navbar-height)-var(--page-header-height,4rem))] xl:overflow-y-auto">
      <div className="flex items-center gap-1">
        <span className="me-auto text-xs tabular-nums text-muted-foreground">{place.at + 1} of {place.of} on this page</span>
        <TooltipHint label="Previous paper"><Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Previous paper" disabled={place.at <= 0} onClick={() => onStep(-1)}><ChevronLeft /></Button></TooltipHint>
        <TooltipHint label="Next paper"><Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Next paper" disabled={place.at >= place.of - 1} onClick={() => onStep(1)}><ChevronRight /></Button></TooltipHint>
        <TooltipHint label="Close"><Button variant="ghost" size="icon" className="-me-2 size-7 text-muted-foreground" aria-label="Close" onClick={onClose}><X /></Button></TooltipHint>
      </div>
      <h2 className="text-base font-semibold leading-snug">{paper.title}</h2>
      <p className="text-sm text-muted-foreground">{paper.authors.join(", ")}. <span className="italic">{paper.venue}</span>, {paper.year}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <ResultChip result={state.result} />
        {state.result === "include" && visible && screening.criteria.length ? <Chip><Stars count={scoreOf(screening, cast).stars} />{scoreOf(screening, cast).points} of {scoreOf(screening, cast).of} points</Chip> : null}
        <Chip icon={Quote}>{paper.cited} cited</Chip>
        {paper.batch !== undefined ? <Chip icon={RefreshCw}>Added {paper.batch > NOW ? "just now" : day(paper.batch)}</Chip> : null}
        {source ? <ClippedChip className="max-w-56">{source.name}</ClippedChip> : null}
      </div>
      {paper.sentences.length ? (
        <p className="text-sm leading-6">{paper.sentences.map((sentence, i) => <span key={i} className={cn("rounded-sm box-decoration-clone transition-colors duration-300", quoted === i && "bg-warning/20")}>{sentence} </span>)}</p>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">This paper came without an abstract.</p>
      )}

      {/* Your own vote, where the paper is yours to vote on. */}
      {isMine && open.isReviewer ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">{mine ? "Your vote" : "This paper waits for your vote"}</h3>
          {mine && deciding !== "vote" ? (
            <div className="flex items-center gap-2 text-sm">
              <VoteMark vote={mine} who="You" />
              <span className="min-w-0 flex-1">{DECISION_LABEL[mine.decision]}{mine.reason ? `, ${failedLabel(mine.reason, screening.criteria)}` : ""}</span>
              <Button variant="ghost" size="xs" onClick={() => setDeciding("vote")}>Change it</Button>
            </div>
          ) : (
            buttons("vote")
          )}
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Votes</h3>
        {visible ? (
          <div className="overflow-x-auto rounded-2xl border border-border-subtle p-3"><Matrix criteria={screening.criteria} cast={cast} me={open.me} shown={shown} onShow={setShown} /></div>
        ) : (
          <p className="rounded-2xl border border-border-subtle bg-inset px-3 py-3 text-sm text-muted-foreground">The other votes show once you have cast yours, above.</p>
        )}
        {quoting?.vote && shown && visible ? <Evidence paper={paper} reviewer={quoting.reviewer} criterion={screening.criteria.find((c) => c.key === shown.criterion)!} criteria={screening.criteria} answer={quoting.vote.answers[shown.criterion]} /> : null}
        {visible ? (
          <ul className="space-y-1.5 pt-1">
            {cast.filter((one) => one.failed).map(({ reviewer }) => (
              <li key={reviewer.id} className="flex items-start gap-2 text-xs">
                <ReviewerMark reviewer={reviewer} className="size-5" />
                <span className="min-w-0 flex-1"><span className="font-medium">{reviewer.name}</span> <span className="text-muted-foreground">couldn&apos;t read this paper, so it has no say in it. It can be sent back to it from the Overview.</span></span>
              </li>
            ))}
            {cast.filter((one) => one.vote).map(({ reviewer, vote }) => (
              <li key={reviewer.id} className="flex items-start gap-2 text-xs">
                <ReviewerMark reviewer={reviewer} className="size-5" />
                <span className="min-w-0 flex-1"><span className="font-medium">{reviewer.name}</span>{reviewer.kind === "model" ? <span className="text-muted-foreground"> (AI model)</span> : null} <span className="text-muted-foreground">{DECISION_LABEL[vote!.decision].toLowerCase()}{vote!.reason ? `, ${failedLabel(vote!.reason, screening.criteria)}` : ""}, {ago(vote!.at)}</span>{vote!.note ? <span className="block text-muted-foreground">“{vote!.note}”</span> : null}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* The paper's result: settled by a person where its reviewers disagree, and open to change after that. */}
      {state.resolvedBy ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IdentityAvatar name={personOf(state.resolvedBy)?.name ?? ""} imageUrl={personOf(state.resolvedBy)?.imageUrl} className="size-5" />
          <span className="min-w-0 flex-1">Settled by {personOf(state.resolvedBy)?.name ?? "a reviewer"}{state.reason ? `, ${failedLabel(state.reason, screening.criteria)}` : ""}{state.note ? `: “${state.note}”` : ""}</span>
          {open.canResolve ? <Button variant="ghost" size="xs" onClick={() => open.resolve(paper, null)}><Undo2 />Reopen</Button> : null}
        </div>
      ) : !open.canResolve ? (
        state.result === "conflict" ? <p className="text-xs text-muted-foreground">{personOf(screening.rule.resolver)?.name ?? "The person named in the settings"} settles conflicts on this screening.</p> : null
      ) : state.result === "conflict" || deciding === "result" ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">{state.result === "conflict" ? "Final decision" : "Decide it yourself, whatever the votes say"}</h3>
          {buttons("result")}
        </section>
      ) : visible ? (
        <Button variant="outline" size="sm" onClick={() => setDeciding("result")}>{state.result === "waiting" ? "Decide it without waiting" : "Change the result"}</Button>
      ) : null}
    </div>
  );
}
