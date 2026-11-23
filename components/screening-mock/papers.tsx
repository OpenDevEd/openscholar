"use client";

// The open screening's Papers view: every paper as a row, a narrow column per reviewer, and where
// the paper stands. A row opens the paper beside the table, with who said what and when.

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, CircleHelp, Download, FileText, GitCompare, Quote, Search, Undo2, Upload, X } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { AnimatedNumber, AnswerMark, Chip, ClippedChip, Stars } from "@/components/screening/parts";
import { EASE } from "@/components/settings/model-map";
import { Segmented, pagerOf } from "@/components/settings/parts";
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
import { DECISIONS, DECISION_LABEL, OTHER_REASONS, RESULTS, RESULT_LABEL, activeReviewers, ago, personOf, reasonLabel, reasonOf, scoreOf, type Decision, type Paper, type Result } from "./data";
import { RESULT_STYLE, ResultChip, ReviewerMark, ReviewerStack, Tally, VoteMark } from "./parts";
import { Evidence, Matrix } from "./screen";
import type { Open } from "./store";

export type PapersFilter = Result | "all";
type Sort = "added" | "title" | "newest" | "split" | "points";
const PAGE = 20;
const ROW = 57;

export function Papers({ open, filter, onFilter }: { open: Open; filter: PapersFilter; onFilter: (filter: PapersFilter) => void }) {
  const { screening, papers, votes, settled, counts } = open;
  const reviewers = activeReviewers(screening);
  const criteria = screening.criteria;
  const [query, setQuery] = useState("");
  const [columns, setColumns] = useState<"reviewers" | "criteria">("reviewers");
  const [sort, setSort] = useState<Sort>("added");
  const [from, setFrom] = useState("all");
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  // A paper opens beside the table where there is room for both, and over the page where there isn't.
  const beside = useMediaQuery("(min-width: 1280px)");

  const rows = useMemo(() => {
    const words = query.trim().toLowerCase();
    const list = papers.filter((paper) => (filter === "all" || settled[paper.id]!.result === filter) && (from === "all" || paper.source === from) && (!words || `${paper.title} ${paper.authors.join(" ")}`.toLowerCase().includes(words)));
    const split = (paper: Paper) => new Set(votes[paper.id]!.flatMap((one) => one.vote?.decision ?? [])).size;
    if (sort === "title") return [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "newest") return [...list].sort((a, b) => b.year - a.year);
    if (sort === "split") return [...list].sort((a, b) => split(b) - split(a));
    if (sort === "points") return [...list].sort((a, b) => scoreOf(screening, votes[b.id]!).points - scoreOf(screening, votes[a.id]!).points);
    return list;
  }, [papers, settled, votes, filter, from, query, sort, screening]);
  const pager = pagerOf(rows.length, PAGE, page, setPage);
  const shown = rows.slice((pager.page - 1) * PAGE, pager.page * PAGE);
  const paper = papers.find((one) => one.id === opened);
  const chosen = picked.filter((id) => papers.some((one) => one.id === id));
  const allShown = shown.length > 0 && shown.every((one) => chosen.includes(one.id));

  // Escape closes the paper beside the table. The keyboard is the outside system.
  useEffect(() => {
    if (!opened) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !(event.target as HTMLElement | null)?.closest("[role=dialog], [role=menu], [role=listbox]") && setOpened(null);
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
  const exportPicked = () => {
    const lines = [["paper", "year", "result", ...reviewers.map((r) => r.name)], ...chosen.flatMap((id) => {
      const one = papers.find((p) => p.id === id);
      return one ? [[one.title, one.year, RESULT_LABEL[settled[id]!.result], ...reviewers.map((r) => { const vote = votes[id]!.find((v) => v.reviewer.id === r.id)?.vote; return vote ? DECISION_LABEL[vote.decision] : ""; })]] : [];
    })];
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([lines.map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" }));
    link.download = "selected-papers.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const conflictsPicked = chosen.filter((id) => settled[id]!.result === "conflict").length;

  if (!papers.length) return <p className="px-6 py-20 text-center text-sm text-muted-foreground">No paper has reached this stage yet.</p>;

  return (
    <div className="@container/papers">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle p-4 sm:px-6">
        <Segmented
          label="Where the papers stand"
          value={filter}
          onChange={(next) => { setPage(1); onFilter(next); }}
          fill="labels"
          className="@6xl/papers:w-auto"
          options={[
            { id: "all" as const, label: "All", detail: <span className="tabular-nums text-muted-foreground">{papers.length}</span> },
            ...RESULTS.map((result) => ({ id: result, label: RESULT_LABEL[result], icon: RESULT_STYLE[result].icon, detail: <span className="tabular-nums text-muted-foreground"><AnimatedNumber value={counts[result]} /></span> })),
          ]}
        />
        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2 @max-2xl/papers:w-full">
          <Segmented label="Columns" className="@max-2xl/papers:hidden" value={columns} onChange={setColumns} options={[{ id: "reviewers", label: "By reviewer" }, { id: "criteria", label: "By criterion" }]} />
          {screening.sources.length > 1 ? (
            <Select value={from} onValueChange={(next) => { setPage(1); setFrom(next); }}>
              <SelectTrigger aria-label="Source" className="h-8 w-44 text-xs @max-2xl/papers:hidden"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every source</SelectItem>
                {screening.sources.map((source) => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <Select value={sort} onValueChange={(next) => { setPage(1); setSort(next as Sort); }}>
            <SelectTrigger aria-label="Order" className="h-8 w-40 text-xs @max-2xl/papers:hidden"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="added">As they were added</SelectItem>
              <SelectItem value="split">Most divided first</SelectItem>
              <SelectItem value="points">Most points first</SelectItem>
              <SelectItem value="title">Title, A to Z</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
            </SelectContent>
          </Select>
          {query.trim() || from !== "all" ? <span className="text-xs tabular-nums text-muted-foreground">{rows.length.toLocaleString()} of {(filter === "all" ? papers.length : counts[filter]).toLocaleString()}</span> : null}
          <div className="relative w-52 @max-2xl/papers:w-full">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Find a paper" aria-label="Find a paper" className="h-8 rounded-full ps-8 text-sm" />
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

      {/* What can be done with the chosen papers. The row opens only while some are chosen. */}
      <AnimatePresence initial={false}>
        {chosen.length ? (
          <motion.div key="chosen" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-primary/5 px-4 py-2 sm:px-6">
              <span className="text-sm font-medium tabular-nums">{chosen.length} chosen</span>
              {conflictsPicked && open.canResolve ? (
                <>
                  <span className="ms-2 text-xs text-muted-foreground">Settle the {conflictsPicked} in conflict as</span>
                  {[...DECISIONS].reverse().map((decision) => <Button key={decision} variant="outline" size="sm" className="h-7" onClick={() => settleAll(decision)}>{DECISION_LABEL[decision]}</Button>)}
                </>
              ) : null}
              <Button variant="outline" size="sm" className="ms-auto h-7" onClick={exportPicked}><Download />Download as CSV</Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setPicked([])}>Clear</Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className={cn("grid", paper && beside && "grid-cols-[minmax(0,1fr)_30rem]")}>
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
                        <button type="button" aria-expanded={opened === one.id} onClick={() => setOpened(opened === one.id ? null : one.id)} className={cn("block w-full space-y-2 px-4 py-3 text-start transition-colors hover:bg-muted", opened === one.id && "bg-muted")}>
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
                <Table className="table-fixed @max-2xl/papers:hidden" style={{ minWidth: columns === "criteria" ? `${(paper ? 26 : 36) + criteria.length * 6}rem` : `${(paper ? 28 : 40) + reviewers.length * 2.75}rem` }}>
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
                      {open.stage === "fullText" ? <TableHead className="w-20 px-1 text-center">Full text</TableHead> : null}
                      <TableHead className={cn("w-52 ps-6", paper || columns === "criteria" ? "hidden" : "@max-5xl/papers:hidden")}>Why</TableHead>
                      <TableHead className={cn("pe-4 text-end sm:pe-6", paper ? "w-40" : "w-48")}>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((one) => {
                      const visible = open.canSee(one);
                      const cast = votes[one.id]!;
                      return (
                        <TableRow key={one.id} data-state={opened === one.id ? "selected" : undefined} className="cursor-pointer" style={{ height: ROW }} onClick={() => setOpened(opened === one.id ? null : one.id)}>
                          <TableCell className="ps-4 sm:ps-6" onClick={(event) => event.stopPropagation()}>
                            <Checkbox checked={chosen.includes(one.id)} onCheckedChange={() => setPicked(chosen.includes(one.id) ? chosen.filter((id) => id !== one.id) : [...chosen, one.id])} aria-label={`Choose ${one.title}`} />
                          </TableCell>
                          <TableCell className="py-2">
                            <button type="button" aria-expanded={opened === one.id} className="block w-full min-w-0 text-start outline-none focus-visible:underline">
                              <span className="block truncate text-sm font-medium">{one.title}</span>
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
                          {open.stage === "fullText" ? (
                            <TableCell className="px-1 text-center">
                              {open.hasFullText(one) ? <FileText role="img" aria-label="Full text to hand" className="inline size-4 ink-success" /> : <span className="text-xs text-muted-foreground">{screening.fullTexts[one.id] === "missing" ? "Not got" : "Missing"}</span>}
                            </TableCell>
                          ) : null}
                          <TableCell className={cn("ps-6", paper || columns === "criteria" ? "hidden" : "@max-5xl/papers:hidden")}><Why paper={one} open={open} visible={visible} /></TableCell>
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
                <Button variant="outline" size="sm" onClick={() => { setQuery(""); setFrom("all"); onFilter("all"); }}>Show every paper</Button>
              </div>
            )}
          </div>
          {pager.pages > 1 ? <CommandCenterPagination className="border-t border-border-subtle p-4 sm:px-6" currentPage={pager.page} totalPages={pager.pages} onPageChange={setPage} totalItems={pager.total} itemsPerPage={PAGE} itemLabel="papers" /> : null}
        </div>

        <AnimatePresence initial={false}>
          {paper && beside ? (
            <motion.aside key="panel" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.25, ease: EASE }} className="min-w-0 border-s border-border-subtle">
              <PaperPanel key={paper.id} paper={paper} open={open} onClose={() => setOpened(null)} place={{ at: shown.indexOf(paper), of: shown.length }} onStep={(by) => { const next = shown[shown.indexOf(paper) + by]; if (next) setOpened(next.id); }} />
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>
      <Sheet open={Boolean(paper) && !beside} onOpenChange={(next) => !next && setOpened(null)}>
        <SheetContent showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
          <SheetTitle className="sr-only">{paper?.title ?? "Paper"}</SheetTitle>
          <SheetDescription className="sr-only">Its abstract, its votes and its result</SheetDescription>
          {paper ? <PaperPanel key={paper.id} paper={paper} open={open} onClose={() => setOpened(null)} place={{ at: shown.indexOf(paper), of: shown.length }} onStep={(by) => { const next = shown[shown.indexOf(paper) + by]; if (next) setOpened(next.id); }} /> : null}
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
    return reason ? <span className="block truncate text-xs text-muted-foreground">{reasonLabel(reason, open.screening.criteria)}</span> : null;
  }
  const unclear = state.result === "maybe" ? open.screening.criteria.find((criterion) => criterion.must && cast.some((vote) => vote.answers[criterion.key] === "unclear")) : undefined;
  if (unclear) return <span className="block truncate text-xs text-muted-foreground">Unclear: {unclear.short}</span>;
  // An included paper carries the stars its answers earn, as it is saved with them.
  const score = state.result === "include" && open.screening.criteria.length ? scoreOf(open.screening, entries) : null;
  return score ? (
    <TooltipHint label={`${score.points} of ${score.of} points from its reviewers' answers`}>
      <span tabIndex={0} className="inline-flex rounded-md"><Stars count={score.stars} /></span>
    </TooltipHint>
  ) : null;
}

/** One paper beside the table: what it says, who voted what on each criterion and when, your own vote where it is yours to give, and the final decision when they disagree. */
function PaperPanel({ paper, open, onClose, onStep, place }: { paper: Paper; open: Open; onClose: () => void; onStep: (by: 1 | -1) => void; place: { at: number; of: number } }) {
  const { screening, settled, votes, stage } = open;
  const [shown, setShown] = useState<{ reviewer: string; criterion: string } | null>(null);
  // What is being decided in the panel: your own vote, or the paper's result. Excluding asks for the reason first.
  const [deciding, setDeciding] = useState<"vote" | "result" | null>(null);
  const [reasonFor, setReasonFor] = useState<"vote" | "result" | null>(null);
  const [note, setNote] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const state = settled[paper.id]!;
  const visible = open.canSee(paper);
  const cast = votes[paper.id]!;
  const mine = open.myVote(paper);
  const isMine = cast.some((one) => one.reviewer.id === open.me);
  const quoted = shown && visible ? screening.criteria.findIndex((c) => c.key === shown.criterion) : -1;
  const quoting = shown ? cast.find((one) => one.reviewer.id === shown.reviewer) : undefined;
  const source = screening.sources.find((one) => one.id === paper.source);
  const reasons = [...screening.criteria.map((criterion) => ({ key: criterion.key, label: criterion.short })), ...OTHER_REASONS[stage]];
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
        {reasons.map((reason) => <button key={reason.key} type="button" onClick={() => settle(kind, "exclude", reason.key)} className="flex h-9 w-full items-center rounded-lg border border-border-subtle px-2.5 text-start text-sm transition-colors hover:bg-muted"><span className="truncate">{reason.label}</span></button>)}
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
        {source ? <ClippedChip className="max-w-56">{source.name}</ClippedChip> : null}
      </div>
      {paper.sentences.length ? (
        <p className="text-sm leading-6">{paper.sentences.map((sentence, i) => <span key={i} className={cn("rounded-sm box-decoration-clone transition-colors duration-300", quoted === i && "bg-warning/20")}>{sentence} </span>)}</p>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">This paper came without an abstract.</p>
      )}

      {stage === "fullText" ? (
        <div className="flex items-center gap-3 rounded-2xl border border-border-subtle px-3 py-2.5">
          <FileText className={cn("size-4 shrink-0", open.hasFullText(paper) ? "ink-success" : "text-muted-foreground")} />
          <p className="min-w-0 flex-1 text-sm">{open.hasFullText(paper) ? (screening.fullTexts[paper.id] === "added" ? "Full text added by hand" : "Open-access full text found") : screening.fullTexts[paper.id] === "missing" ? "Marked as not retrieved" : "No full text yet"}</p>
          {!open.hasFullText(paper) ? (
            <>
              <input ref={file} type="file" accept="application/pdf" className="sr-only" aria-label="PDF of this paper" onChange={(event) => event.target.files?.length && open.setFullText(paper, "added")} />
              <Button variant="outline" size="sm" onClick={() => file.current?.click()}><Upload />Upload its PDF</Button>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Your own vote, where the paper is yours to vote on. */}
      {isMine && open.isReviewer ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">{mine ? "Your vote" : "This paper waits for your vote"}</h3>
          {mine && deciding !== "vote" ? (
            <div className="flex items-center gap-2 text-sm">
              <VoteMark vote={mine} who="You" />
              <span className="min-w-0 flex-1">{DECISION_LABEL[mine.decision]}{mine.reason ? `, ${reasonLabel(mine.reason, screening.criteria).toLowerCase()}` : ""}</span>
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
          <div className="overflow-x-auto rounded-2xl border border-border-subtle p-3"><Matrix criteria={screening.criteria} cast={cast} shown={shown} onShow={setShown} /></div>
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
                <span className="min-w-0 flex-1"><span className="font-medium">{reviewer.name}</span> <span className="text-muted-foreground">{DECISION_LABEL[vote!.decision].toLowerCase()}{vote!.reason ? `, ${reasonLabel(vote!.reason, screening.criteria).toLowerCase()}` : ""}, {ago(vote!.at)}</span>{vote!.note ? <span className="block text-muted-foreground">“{vote!.note}”</span> : null}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* The paper's result: settled by a person where its reviewers disagree, and open to change after that. */}
      {state.resolvedBy ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IdentityAvatar name={personOf(state.resolvedBy)?.name ?? ""} imageUrl={personOf(state.resolvedBy)?.imageUrl} className="size-5" />
          <span className="min-w-0 flex-1">Settled by {personOf(state.resolvedBy)?.name ?? "a reviewer"}{state.reason ? `, ${reasonLabel(state.reason, screening.criteria).toLowerCase()}` : ""}{state.note ? `: “${state.note}”` : ""}</span>
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
