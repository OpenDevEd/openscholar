"use client";

// The open screening's Papers view: every paper as a row, a narrow column per reviewer, and where
// the paper stands. A row opens the paper beside the table, with who said what.

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { GitCompare, Quote, Search, Undo2, X } from "@/components/icons";
import { AnimatedNumber, AnswerMark, Chip, ClippedChip } from "@/components/screening/parts";
import { EASE } from "@/components/settings/model-map";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { Segmented, pagerOf } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CRITERIA, DECISIONS, DECISION_LABEL, RESULTS, RESULT_LABEL, REVIEWERS, YOU, reviewerOf, votersOf, type Paper, type Result } from "./data";
import { RESULT_STYLE, ResultChip, ReviewerMark, ReviewerStack, VoteMark, canSee, type Screening } from "./parts";
import { Evidence, Matrix } from "./screen";

export type PapersFilter = Result | "all";
const PAGE = 20;
const ROW = 57;

export function Papers({ screening, filter, onFilter }: { screening: Screening; filter: PapersFilter; onFilter: (filter: PapersFilter) => void }) {
  const { papers, votes, settled, counts } = screening;
  const [query, setQuery] = useState("");
  const [columns, setColumns] = useState<"reviewers" | "criteria">("reviewers");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const words = query.trim().toLowerCase();
    return papers.filter((paper) => (filter === "all" || settled[paper.id]!.result === filter) && (!words || `${paper.title} ${paper.authors.join(" ")}`.toLowerCase().includes(words)));
  }, [papers, settled, filter, query]);
  const pager = pagerOf(rows.length, PAGE, page, setPage);
  const shown = rows.slice((pager.page - 1) * PAGE, pager.page * PAGE);
  const opened = papers.find((paper) => paper.id === open);

  return (
    <div className="@container/papers">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle p-4">
        <Segmented
          label="Where the papers stand"
          value={filter}
          onChange={(next) => { setPage(1); onFilter(next); }}
          fill="labels"
          className="@5xl/papers:w-auto"
          options={[
            { id: "all" as const, label: "All", detail: <span className="tabular-nums text-muted-foreground">{papers.length}</span> },
            ...RESULTS.map((result) => ({ id: result, label: RESULT_LABEL[result], icon: RESULT_STYLE[result].icon, detail: <span className="tabular-nums text-muted-foreground"><AnimatedNumber value={counts[result]} /></span> })),
          ]}
        />
        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2 @max-2xl/papers:w-full">
          <Segmented label="Columns" className="@max-2xl/papers:hidden" value={columns} onChange={setColumns} options={[{ id: "reviewers", label: "By reviewer" }, { id: "criteria", label: "By criterion" }]} />
          <div className="relative w-56 @max-2xl/papers:w-full">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Find a paper" aria-label="Find a paper" className="h-8 rounded-full ps-8 text-sm" />
          </div>
        </div>
      </div>

      <div className={cn("grid", opened && "xl:grid-cols-[minmax(0,1fr)_30rem]")}>
        <div className="min-w-0">
          {/* A full page's height while there are pages, so a short last page doesn't move the pager. */}
          <div style={{ minHeight: pager.pages > 1 ? (PAGE + 1) * ROW : undefined }}>
            {shown.length ? (
              <>
              <ul className="divide-y divide-border-subtle @2xl/papers:hidden">
                {shown.map((paper) => {
                  const visible = canSee(screening, paper.id);
                  return (
                    <li key={paper.id}>
                      <button type="button" aria-expanded={open === paper.id} onClick={() => setOpen(open === paper.id ? null : paper.id)} className={cn("block w-full space-y-2 px-4 py-3 text-start transition-colors hover:bg-muted", open === paper.id && "bg-muted")}>
                        <span className="line-clamp-2 text-sm font-medium">{paper.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{paper.authors.join(", ")}, {paper.year}</span>
                        <span className="flex items-center gap-1">
                          {votersOf(papers.indexOf(paper)).map((reviewer) => <VoteMark key={reviewer.id} vote={votes[paper.id]?.[reviewer.id]} hidden={!visible && !reviewer.you} who={reviewer.name} />)}
                          <ResultChip result={settled[paper.id]!.result} className="ms-auto" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Table className="table-fixed @max-2xl/papers:hidden">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="ps-4 sm:ps-6">Paper</TableHead>
                    {columns === "reviewers"
                      ? REVIEWERS.map((reviewer) => (
                          <TableHead key={reviewer.id} className="w-11 px-0 text-center">
                            <TooltipHint label={reviewer.name}>
                              <span tabIndex={0} className="inline-flex align-middle"><ReviewerMark reviewer={reviewer} /></span>
                            </TooltipHint>
                          </TableHead>
                        ))
                      : CRITERIA.map((criterion) => (
                          <TableHead key={criterion.key} className="w-28 px-1 text-center @max-3xl/papers:w-11">
                            <TooltipHint label={criterion.text}>
                              <span tabIndex={0} className="block truncate">{criterion.short}</span>
                            </TooltipHint>
                          </TableHead>
                        ))}
                    <TableHead className={cn("w-60 ps-6", opened ? "hidden" : "@max-5xl/papers:hidden")}>Why</TableHead>
                    <TableHead className="w-44 pe-4 text-end sm:pe-6">Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((paper) => {
                    const index = papers.indexOf(paper);
                    const visible = canSee(screening, paper.id);
                    const voters = votersOf(index);
                    return (
                      <TableRow key={paper.id} data-state={open === paper.id ? "selected" : undefined} className="cursor-pointer" style={{ height: ROW }} onClick={() => setOpen(open === paper.id ? null : paper.id)}>
                        <TableCell className="py-2 ps-4 sm:ps-6">
                          <button type="button" aria-expanded={open === paper.id} className="block w-full min-w-0 text-start outline-none focus-visible:underline">
                            <span className="block truncate text-sm font-medium">{paper.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{paper.authors.join(", ")}, {paper.year}, {paper.venue}</span>
                          </button>
                        </TableCell>
                        {columns === "reviewers"
                          ? REVIEWERS.map((reviewer) => (
                              <TableCell key={reviewer.id} className="px-0 text-center">
                                {voters.includes(reviewer) ? <VoteMark vote={votes[paper.id]?.[reviewer.id]} hidden={!visible && !reviewer.you} who={reviewer.name} className="align-middle" /> : null}
                              </TableCell>
                            ))
                          : CRITERIA.map((criterion) => {
                              const given = visible ? [...new Set(voters.flatMap((reviewer) => votes[paper.id]?.[reviewer.id]?.answers[criterion.key] ?? []))] : [];
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
                        <TableCell className={cn("ps-6", opened ? "hidden" : "@max-5xl/papers:hidden")}><Why paper={paper} screening={screening} visible={visible} /></TableCell>
                        <TableCell className="pe-4 text-end sm:pe-6"><ResultChip result={settled[paper.id]!.result} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </>
            ) : (
              <p className="px-4 py-16 text-center text-sm text-muted-foreground">No paper here matches.</p>
            )}
          </div>
          {pager.pages > 1 ? <CommandCenterPagination className="border-t border-border-subtle p-4 sm:px-6" currentPage={pager.page} totalPages={pager.pages} onPageChange={setPage} totalItems={pager.total} itemsPerPage={PAGE} itemLabel="papers" /> : null}
        </div>

        <AnimatePresence initial={false}>
          {opened ? (
            <motion.aside key="panel" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.25, ease: EASE }} className="min-w-0 border-t border-border-subtle max-xl:order-first max-xl:border-b xl:border-s xl:border-t-0">
              <PaperPanel key={opened.id} paper={opened} screening={screening} onClose={() => setOpen(null)} />
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** What put a paper where it stands: the criterion it failed, how its reviewers split, or whose vote it waits for. */
function Why({ paper, screening, visible }: { paper: Paper; screening: Screening; visible: boolean }) {
  const { papers, votes, settled } = screening;
  const state = settled[paper.id]!;
  const voters = votersOf(papers.indexOf(paper));
  const cast = voters.flatMap((reviewer) => votes[paper.id]?.[reviewer.id] ?? []);
  if (state.result === "waiting") {
    const missing = voters.filter((reviewer) => !votes[paper.id]?.[reviewer.id]);
    return <span className="flex items-center gap-2 text-xs text-muted-foreground"><ReviewerStack reviewers={missing} />{missing.length === 1 ? "to vote" : `${missing.length} to vote`}</span>;
  }
  if (!visible) return null;
  if (state.result === "conflict" || state.resolvedBy) {
    const tally = DECISIONS.flatMap((decision) => { const n = cast.filter((vote) => vote.decision === decision).length; return n ? `${n} ${DECISION_LABEL[decision].toLowerCase()}` : []; });
    return <span className="block truncate text-xs text-muted-foreground">{tally.join(", ")}</span>;
  }
  const failed = state.result === "exclude" ? CRITERIA.find((criterion) => cast.some((vote) => vote.reason === criterion.key)) : state.result === "maybe" ? CRITERIA.find((criterion) => criterion.must && cast.some((vote) => vote.answers[criterion.key] === "unclear")) : undefined;
  return failed ? <span className="block truncate text-xs text-muted-foreground">{state.result === "exclude" ? "Not met" : "Unclear"}: {failed.short}</span> : null;
}

/** One paper beside the table: what it says, who voted what on each criterion, and the final decision when they split. */
function PaperPanel({ paper, screening, onClose }: { paper: Paper; screening: Screening; onClose: () => void }) {
  const { papers, votes, settled } = screening;
  const [shown, setShown] = useState<{ reviewer: string; criterion: string } | null>(null);
  const state = settled[paper.id]!;
  const visible = canSee(screening, paper.id);
  const voters = votersOf(papers.indexOf(paper));
  const quoted = shown && visible ? CRITERIA.findIndex((c) => c.key === shown.criterion) : -1;
  return (
    <div className="space-y-5 p-4 sm:p-6 xl:sticky xl:top-[calc(var(--app-navbar-height)+var(--page-header-height,4rem))] xl:max-h-[calc(100dvh-var(--app-navbar-height)-var(--page-header-height,4rem))] xl:overflow-y-auto">
      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug text-balance">{paper.title}</h2>
        <TooltipHint label="Close"><Button variant="ghost" size="icon" className="-me-2 -mt-1 size-8 shrink-0 text-muted-foreground" aria-label="Close" onClick={onClose}><X /></Button></TooltipHint>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ResultChip result={state.result} />
        <Chip>{paper.year}</Chip>
        <ClippedChip className="max-w-56">{paper.venue}</ClippedChip>
        <Chip icon={Quote}>{paper.cited} cited</Chip>
      </div>
      <p className="text-sm text-muted-foreground">{paper.authors.join(", ")}</p>
      <p className="text-sm leading-6">
        {paper.sentences.map((sentence, i) => <span key={i} className={cn("rounded box-decoration-clone transition-colors duration-300", quoted === i && "bg-warning/20")}>{sentence} </span>)}
      </p>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Votes</h3>
        {visible ? (
          <div className="overflow-x-auto rounded-2xl border border-border-subtle p-3"><Matrix paper={paper} screening={screening} voters={voters} shown={shown} onShow={setShown} /></div>
        ) : (
          <p className="rounded-2xl border border-border-subtle bg-inset px-3 py-3 text-sm text-muted-foreground">This paper is in your queue. The other votes show once you have voted.</p>
        )}
        {shown && visible && votes[paper.id]?.[shown.reviewer] ? <Evidence paper={paper} reviewer={reviewerOf(shown.reviewer)} criterion={CRITERIA.find((c) => c.key === shown.criterion)!} answer={votes[paper.id]![shown.reviewer]!.answers[shown.criterion]} /> : null}
      </section>

      {state.result === "conflict" ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Final decision</h3>
          <div className="grid grid-cols-3 gap-2">
            {[...DECISIONS].reverse().map((decision) => {
              const Icon = RESULT_STYLE[decision].icon;
              return (
                <button key={decision} type="button" onClick={() => screening.resolve(paper.id, decision)} className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border-subtle text-sm font-semibold transition-colors hover:bg-muted">
                  <Icon className="size-4" />{DECISION_LABEL[decision]}
                </button>
              );
            })}
          </div>
        </section>
      ) : state.resolvedBy ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ReviewerMark reviewer={YOU} className="size-5" />
          <span className="min-w-0 flex-1">Settled by {YOU.name} after a split</span>
          <Button variant="ghost" size="xs" onClick={() => screening.resolve(paper.id, null)}><Undo2 />Reopen</Button>
        </div>
      ) : null}
    </div>
  );
}
