"use client";

// The open screening's Screen view: your queue, the paper, and the criteria with everyone's votes.
// One paper at a time, decided with a key. Conflicts are settled in the same place.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, CircleHelp, Eye, FileText, GitCompare, Quote, Undo2, Upload, X } from "@/components/icons";
import { ANSWER, AnswerMark, Chip, ClippedChip, RequiredMark, SOURCE_ICON } from "@/components/screening/parts";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { PageStepper } from "@/components/shared/page-stepper";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { ANSWERS, type Answer } from "@/lib/screening/setup";
import { cn } from "@/lib/utils";
import { CRITERIA, DECISIONS, DECISION_LABEL, SOURCES, YOU, decide, evidence, reviewerOf, votersOf, type Criterion, type Decision, type Paper, type Vote } from "./data";
import { CriterionText, Kbd, RESULT_STYLE, ResultChip, ReviewerMark, VoteMark, canSee, type Screening } from "./parts";

export type Queue = "todo" | "done" | "conflicts";
const QUEUE_PAGE = 9;
const KEYS: Record<Decision, string> = { include: "I", maybe: "M", exclude: "E" };
const TERMS = new RegExp(`\\b(${[...new Set(CRITERIA.flatMap((c) => c.terms))].sort((a, b) => b.length - a.length).join("|")})\\b`, "gi");

export function Screen({ screening, queue, onQueue }: { screening: Screening; queue: Queue; onQueue: (queue: Queue) => void }) {
  const { papers, votes, settled, yours, toDo, conflicts, stage } = screening;
  const listed = useCallback(
    (which: Queue) => (which === "todo" ? toDo : which === "conflicts" ? conflicts : yours.filter((paper) => votes[paper.id]?.[YOU.id])).map((paper) => paper.id),
    [toDo, conflicts, yours, votes],
  );
  // The queue as it was when it was opened: a paper you decide stays in its place, with your vote on it, until you change lists.
  const [held, setHeld] = useState<{ of: string; ids: string[] }>(() => ({ of: `${stage}:${queue}`, ids: listed(queue) }));
  if (held.of !== `${stage}:${queue}`) setHeld({ of: `${stage}:${queue}`, ids: listed(queue) });
  const items = useMemo(() => held.ids.flatMap((id) => papers.find((paper) => paper.id === id) ?? []), [held, papers]);

  const [picked, setPicked] = useState<string | null>(null);
  const paper = items.find((one) => one.id === picked) ?? items[0];
  const at = paper ? items.indexOf(paper) : -1;
  const [page, setPage] = useState(1);
  const shownPage = at >= 0 && picked ? Math.floor(at / QUEUE_PAGE) + 1 : page;
  const go = (index: number) => {
    const next = items[Math.max(0, Math.min(items.length - 1, index))];
    if (next) {
      setPicked(next.id);
      setPage(Math.floor(items.indexOf(next) / QUEUE_PAGE) + 1);
      setReasonFor(null);
    }
  };

  const [advance, setAdvance] = useState(true);
  const [answers, setAnswers] = useState<Record<string, Record<string, Answer>>>({});
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [last, setLast] = useState<{ paperId: string; decision: Decision; before: Vote | null; resolved: boolean } | null>(null);
  const [shown, setShown] = useState<{ reviewer: string; criterion: string } | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);

  const resolving = queue === "conflicts";
  const mine = paper ? votes[paper.id]?.[YOU.id] : undefined;
  const visible = paper ? resolving || canSee(screening, paper.id) : false;

  const cast = (decision: Decision, reason?: string) => {
    if (!paper) return;
    const given = { ...answers[paper.id], ...(reason ? { [reason]: "no" as const } : {}) };
    if (resolving) {
      setLast({ paperId: paper.id, decision, before: null, resolved: true });
      screening.resolve(paper.id, decision);
    } else {
      setLast({ paperId: paper.id, decision, before: mine ?? null, resolved: false });
      screening.vote(paper.id, { decision, answers: given, reason, at: Date.now() });
    }
    setReasonFor(null);
    if (advance) {
      const next = items.findIndex((one, index) => index > at && (resolving ? settled[one.id]!.result === "conflict" : !votes[one.id]?.[YOU.id]));
      if (next >= 0) go(next);
    }
  };
  const press = (decision: Decision) => {
    if (!paper) return;
    // Excluding asks which criterion failed, unless your own answers already say.
    const failed = decision === "exclude" ? decide({ ...Object.fromEntries(CRITERIA.map((c) => [c.key, "yes" as Answer])), ...answers[paper.id] }).reason : undefined;
    if (decision === "exclude" && !failed && !resolving) setReasonFor(paper.id);
    else cast(decision, failed);
  };
  const undo = () => {
    if (!last) return;
    if (last.resolved) screening.resolve(last.paperId, null);
    else screening.vote(last.paperId, last.before);
    go(items.findIndex((one) => one.id === last.paperId));
    setLast(null);
  };

  // The keyboard is the outside system: one listener for the keys the buttons show.
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable], [role=radiogroup], [role=dialog]")) return;
      const key = event.key.toLowerCase();
      if (reasonFor) {
        const criterion = CRITERIA[Number(key) - 1];
        if (criterion) cast("exclude", criterion.key);
        else if (key === "escape") setReasonFor(null);
        else return;
      } else if (key === "i") press("include");
      else if (key === "m") press("maybe");
      else if (key === "e") press("exclude");
      else if (key === "z") undo();
      else if (key === "arrowright" || key === "j") go(at + 1);
      else if (key === "arrowleft" || key === "k") go(at - 1);
      else return;
      event.preventDefault();
    },
    // The handlers close over this render's state, and the listener is renewed with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reasonFor, at, items, last, answers, advance, votes, settled, queue],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const voters = paper ? votersOf(papers.indexOf(paper)) : [];
  const evidenceOf = paper && shown && visible ? { reviewer: reviewerOf(shown.reviewer), criterion: CRITERIA.find((c) => c.key === shown.criterion)! } : null;
  const hasPdf = paper ? paper.hasPdf || uploaded.includes(paper.id) : false;

  return (
    <div className="grid min-h-[34rem] grid-cols-1 max-lg:pb-44 lg:h-[calc(100dvh-var(--app-navbar-height)-var(--page-header-height,4rem)-7.25rem)] lg:grid-cols-[19rem_minmax(0,1fr)_24rem] lg:divide-x lg:divide-border-subtle">
      {/* The queue */}
      <div className="flex min-h-0 flex-col border-b border-border-subtle lg:border-b-0">
        <div className="p-3">
          <Segmented
            label="Queue"
            value={queue}
            onChange={(next) => { setPicked(null); setPage(1); setReasonFor(null); onQueue(next); }}
            fill
            options={[
              { id: "todo", label: "To do", detail: <span className="tabular-nums text-muted-foreground">{toDo.length}</span> },
              { id: "done", label: "Done", detail: <span className="tabular-nums text-muted-foreground">{yours.length - toDo.length}</span> },
              { id: "conflicts", label: "Conflicts", detail: <span className="tabular-nums text-muted-foreground">{conflicts.length}</span> },
            ]}
          />
        </div>
        <ul className="hidden min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto border-t border-border-subtle lg:block">
          {items.slice((shownPage - 1) * QUEUE_PAGE, shownPage * QUEUE_PAGE).map((one) => {
            const vote = votes[one.id]?.[YOU.id];
            return (
              <li key={one.id}>
                <button type="button" aria-current={one === paper} onClick={() => go(items.indexOf(one))} className={cn("flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-muted", one === paper && "bg-muted")}>
                  <span className="min-w-0 flex-1">
                    <span className={cn("line-clamp-2 text-sm leading-5", one === paper ? "font-semibold" : "font-medium")}>{one.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{one.authors[0]}, {one.year}</span>
                  </span>
                  {resolving ? (settled[one.id]!.result === "conflict" ? <GitCompare className="mt-0.5 size-4 shrink-0 text-primary" /> : <VoteMark vote={{ decision: settled[one.id]!.final! }} who="Final decision" />) : vote ? <VoteMark vote={vote} who="You" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {items.length > QUEUE_PAGE ? (
          <PageStepper
            className="hidden border-t border-border-subtle px-3 py-2 lg:flex"
            page={shownPage}
            pageCount={Math.ceil(items.length / QUEUE_PAGE)}
            canPrevious={shownPage > 1}
            canNext={shownPage < Math.ceil(items.length / QUEUE_PAGE)}
            onPrevious={() => { setPicked(null); setPage(shownPage - 1); }}
            onNext={() => { setPicked(null); setPage(shownPage + 1); }}
          />
        ) : null}
      </div>

      {!paper ? (
        <div className="col-span-2 flex flex-col items-center justify-center gap-2 p-10 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-success/12 ink-success"><Check className="size-5" /></span>
          <p className="text-sm font-medium">{queue === "todo" ? "Nothing left for you to screen" : queue === "conflicts" ? "No conflicts to settle" : "You haven't voted on a paper yet"}</p>
        </div>
      ) : (
        <>
          {/* The paper */}
          <div className="min-h-0 overflow-y-auto">
            <AnimatePresence mode="wait" initial={false}>
              <motion.article key={`${stage}:${paper.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: EASE }} className="mx-auto max-w-3xl space-y-4 p-5 sm:p-8">
                <div className="flex flex-wrap items-center gap-1.5">
                  <ClippedChip icon={SOURCE_ICON[SOURCES.find((s) => s.id === paper.source)!.kind === "search" ? "search" : "collection"]} className="max-w-64">{SOURCES.find((s) => s.id === paper.source)!.name}</ClippedChip>
                  <Chip>{paper.year}</Chip>
                  <ClippedChip className="max-w-72">{paper.venue}</ClippedChip>
                  <Chip icon={Quote}>{paper.cited} cited</Chip>
                </div>
                <h2 className="text-xl font-semibold leading-snug tracking-tight text-balance">{paper.title}</h2>
                <p className="text-sm text-muted-foreground">{paper.authors.join(", ")}</p>
                {stage === "abstract" ? (
                  <p className="text-[0.95rem] leading-7">
                    {paper.sentences.map((sentence, i) => (
                      <Sentence key={i} text={sentence} quoted={evidenceOf ? CRITERIA.indexOf(evidenceOf.criterion) === i : false} />
                    ))}
                  </p>
                ) : hasPdf ? (
                  <FullText paper={paper} quoted={evidenceOf ? CRITERIA.indexOf(evidenceOf.criterion) : -1} />
                ) : (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
                    <FileText className="size-6 text-muted-foreground" />
                    <p className="text-sm font-medium">No full text yet</p>
                    <p className="max-w-sm text-xs text-muted-foreground">No open-access copy was found. Add the PDF to screen this paper on its full text.</p>
                    <Button size="sm" variant="outline" onClick={() => setUploaded((ids) => [...ids, paper.id])}><Upload />Upload PDF</Button>
                  </div>
                )}
              </motion.article>
            </AnimatePresence>
          </div>

          {/* The criteria, the votes and the decision */}
          <div className="flex min-h-0 flex-col border-t border-border-subtle lg:border-t-0">
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              <section className="space-y-2">
                <div className="flex h-6 items-center justify-between">
                  <h3 className="text-xs font-medium text-muted-foreground">Criteria</h3>
                  {resolving ? <ResultChip result={settled[paper.id]!.result} /> : <span className="text-xs text-muted-foreground">Answering is optional</span>}
                </div>
                {/* Each criterion with your answer, and under it, once you may see them, what every other reviewer answered. */}
                <ul className="divide-y divide-border-subtle rounded-2xl border border-border-subtle">
                  {CRITERIA.map((criterion, i) => {
                    const given = answers[paper.id]?.[criterion.key] ?? (resolving ? undefined : mine?.answers[criterion.key]);
                    const others = voters.filter((reviewer) => !reviewer.you || resolving);
                    const said = new Set(others.flatMap((reviewer) => votes[paper.id]?.[reviewer.id]?.answers[criterion.key] ?? []));
                    const open = evidenceOf?.criterion === criterion ? evidenceOf : null;
                    return (
                      <li key={criterion.key} className="space-y-2 px-3 py-2.5">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                          <p className="min-w-0 flex-1 text-sm leading-5"><CriterionText text={criterion.text} must={criterion.must} /></p>
                          {/* Settling a split is one decision: the answers shown are the reviewers'. */}
                          <div role="radiogroup" aria-label={`Your answer to criterion ${i + 1}`} className={cn("flex shrink-0 gap-1", resolving && "hidden")}>
                            {ANSWERS.map((answer) => {
                              const Icon = ANSWER[answer].icon;
                              const on = given === answer;
                              return (
                                <button
                                  key={answer}
                                  type="button"
                                  role="radio"
                                  aria-checked={on}
                                  aria-label={answer}
                                  onClick={() => setAnswers((all) => ({ ...all, [paper.id]: { ...all[paper.id], [criterion.key]: answer } }))}
                                  className={cn("flex size-6 items-center justify-center rounded-md transition-colors", on ? ANSWER[answer].className : "text-muted-foreground/60 hover:bg-muted hover:text-foreground")}
                                >
                                  <Icon className="size-3.5" />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {visible ? (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, ease: EASE }} className="flex flex-wrap items-center gap-1.5 ps-7">
                            {others.map((reviewer) => {
                              const answer = votes[paper.id]?.[reviewer.id]?.answers[criterion.key];
                              const on = shown?.reviewer === reviewer.id && shown.criterion === criterion.key;
                              const pair = (
                                <>
                                  <ReviewerMark reviewer={reviewer} className="size-5" />
                                  {answer ? <AnswerMark answer={answer} label={`${reviewer.name}, ${criterion.short}`} /> : <span className="size-6 rounded-md border border-dashed border-border-subtle" />}
                                </>
                              );
                              // A model's answer opens the passage it read; a person's is theirs alone.
                              return reviewer.kind === "model" && answer ? (
                                <TooltipHint key={reviewer.id} label={`${reviewer.name}: show the passage`}>
                                  <button type="button" aria-pressed={on} onClick={() => setShown(on ? null : { reviewer: reviewer.id, criterion: criterion.key })} className={cn("flex items-center gap-1 rounded-lg p-0.5 transition-colors hover:bg-muted", on && "bg-muted ring-1 ring-primary/50")}>{pair}</button>
                                </TooltipHint>
                              ) : (
                                <TooltipHint key={reviewer.id} label={reviewer.name}>
                                  <span tabIndex={0} className="flex items-center gap-1 rounded-lg p-0.5">{pair}</span>
                                </TooltipHint>
                              );
                            })}
                            {said.size > 1 ? <span className="ms-1 text-xs font-medium text-primary">They differ</span> : null}
                          </motion.div>
                        ) : null}
                        <AnimatePresence initial={false}>
                          {open && votes[paper.id]?.[open.reviewer.id] ? (
                            <motion.div key="evidence" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden ps-7">
                              <Evidence paper={paper} reviewer={open.reviewer} criterion={criterion} answer={votes[paper.id]![open.reviewer.id]!.answers[criterion.key]} />
                            </motion.div>
                          ) : null}
                        </AnimatePresence>
                      </li>
                    );
                  })}
                  <li className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-inset px-3 py-2.5">
                    <span className="w-4 shrink-0" />
                    <span className="shrink-0 text-sm font-medium">Decision</span>
                    {visible ? (
                      <span className="ms-auto flex flex-wrap items-center justify-end gap-1.5">
                        {voters.map((reviewer) => (
                          <TooltipHint key={reviewer.id} label={reviewer.name}>
                            <span tabIndex={0} className="flex items-center gap-1 rounded-lg p-0.5"><ReviewerMark reviewer={reviewer} className="size-5" /><VoteMark vote={votes[paper.id]?.[reviewer.id]} who={reviewer.name} /></span>
                          </TooltipHint>
                        ))}
                      </span>
                    ) : (
                      <span className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
                        <Eye className="size-3.5 shrink-0" />Shown after you vote
                        <span className="flex gap-1">{voters.filter((reviewer) => !reviewer.you).map((reviewer) => <VoteMark key={reviewer.id} vote={votes[paper.id]?.[reviewer.id]} hidden who={reviewer.name} />)}</span>
                      </span>
                    )}
                  </li>
                </ul>
              </section>
            </div>

            {/* The decision, pinned to the foot of the column, and to the foot of the screen on a phone, where its buttons sit clear of the assistant's button in the corner. */}
            <div className="space-y-3 border-t border-border-subtle bg-card p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:space-y-2 max-lg:pb-[max(2.25rem,env(safe-area-inset-bottom))] max-lg:shadow-[0_-10px_30px_-18px_rgb(0_0_0/0.35)]">
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">{at + 1} of {items.length}</span>
                <TooltipHint label="Previous paper"><Button variant="ghost" size="icon" className="size-7" aria-label="Previous paper" disabled={at <= 0} onClick={() => go(at - 1)}><ChevronLeft /></Button></TooltipHint>
                <TooltipHint label="Next paper"><Button variant="ghost" size="icon" className="size-7" aria-label="Next paper" disabled={at >= items.length - 1} onClick={() => go(at + 1)}><ChevronRight /></Button></TooltipHint>
                <label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="max-sm:sr-only">Go to the next one</span>
                  <Switch checked={advance} onCheckedChange={setAdvance} aria-label="Go to the next paper after a decision" />
                </label>
              </div>
              {reasonFor === paper.id ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Which criterion does it fail?</p>
                  <div className="grid gap-1.5">
                    {CRITERIA.map((criterion, i) => (
                      <button key={criterion.key} type="button" onClick={() => cast("exclude", criterion.key)} className="flex h-9 items-center gap-2 rounded-lg border border-border-subtle px-2.5 text-start text-sm transition-colors hover:bg-muted">
                        <Kbd>{i + 1}</Kbd>
                        <span className="truncate">{criterion.short}</span>
                      </button>
                    ))}
                  </div>
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => setReasonFor(null)}>Back<Kbd className="ms-1">Esc</Kbd></Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {resolving ? <p className="text-xs font-medium text-muted-foreground">Final decision</p> : null}
                  <div className="grid grid-cols-3 gap-2">
                    {[...DECISIONS].reverse().map((decision) => {
                      const Icon = decision === "include" ? Check : decision === "maybe" ? CircleHelp : X;
                      const on = resolving ? settled[paper.id]!.resolvedBy && settled[paper.id]!.final === decision : mine?.decision === decision;
                      return (
                        <button
                          key={decision}
                          type="button"
                          aria-pressed={Boolean(on)}
                          onClick={() => press(decision)}
                          className={cn(
                            "flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors",
                            on ? cn(RESULT_STYLE[decision].chip, "border-transparent ring-1 ring-current") : "border-border-subtle hover:bg-muted",
                          )}
                        >
                          <Icon className="size-4" />
                          {DECISION_LABEL[decision]}
                          <Kbd className="max-lg:hidden">{KEYS[decision]}</Kbd>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* The last decision, with the way back. The row keeps its height whether or not there is one. */}
              <div className="flex h-7 items-center gap-2 pe-14 text-xs text-muted-foreground">
                {last ? (
                  <>
                    <VoteMark vote={{ decision: last.decision }} who={last.resolved ? "Final decision" : "You"} className="size-5" />
                    <span className="min-w-0 flex-1 truncate">{last.resolved ? "Settled" : "Voted"}: {papers.find((one) => one.id === last.paperId)?.title}</span>
                    <Button variant="ghost" size="xs" onClick={undo}><Undo2 />Undo<Kbd className="max-lg:hidden">Z</Kbd></Button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A sentence of the abstract, with the criteria's words marked, and the whole of it when a model quoted it. */
function Sentence({ text, quoted }: { text: string; quoted: boolean }) {
  const parts = text.split(TERMS);
  return (
    <span className={cn("rounded box-decoration-clone transition-colors duration-300", quoted && "bg-warning/20")}>
      {parts.map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-primary/15 px-0.5 text-foreground">{part}</mark> : part))}{" "}
    </span>
  );
}

/** Stands in for the PDF viewer the extraction pages use: the paper's pages, with the quoted passage marked. */
function FullText({ paper, quoted }: { paper: Paper; quoted: number }) {
  const pages = [
    { heading: "Abstract", sentences: [0, 1, 2, 3, 4] },
    { heading: "2. Methods", sentences: [0, 1, 2] },
    { heading: "4. Results", sentences: [3, 4] },
  ];
  return (
    <div className="space-y-3">
      {pages.map((page, n) => (
        <div key={page.heading} className="space-y-3 rounded-md bg-white p-8 text-neutral-900 shadow-surface ring-1 ring-black/5">
          <div className="flex items-center justify-between text-2xs text-neutral-500"><span>{paper.venue}</span><span>Page {n + 1} of {pages.length}</span></div>
          <h3 className="text-sm font-semibold">{page.heading}</h3>
          <p className="text-sm leading-6">
            {page.sentences.map((i) => (
              <span key={i} className={cn("rounded box-decoration-clone", quoted === i && n > 0 && "bg-amber-200")}>{paper.sentences[i]} </span>
            ))}
            {n > 0 ? "The full paper describes the sample, the instruments and the analysis in more detail than its abstract does." : null}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Each reviewer's answer to each criterion, and their decision: who said what. */
export function Matrix({ paper, screening, voters, shown, onShow }: { paper: Paper; screening: Screening; voters: ReturnType<typeof votersOf>; shown: { reviewer: string; criterion: string } | null; onShow: (cell: { reviewer: string; criterion: string } | null) => void }) {
  const votes = screening.votes[paper.id] ?? {};
  return (
    <div className="grid w-max min-w-full items-center gap-x-1 gap-y-1.5" style={{ gridTemplateColumns: `minmax(7rem, 1fr) repeat(${voters.length}, 1.75rem)` }}>
      <span />
      {voters.map((reviewer) => (
        <TooltipHint key={reviewer.id} label={reviewer.name}>
          <span tabIndex={0} className="flex justify-center"><ReviewerMark reviewer={reviewer} /></span>
        </TooltipHint>
      ))}
      {CRITERIA.map((criterion) => {
        const given = voters.map((reviewer) => votes[reviewer.id]?.answers[criterion.key]);
        const split = new Set(given.filter(Boolean)).size > 1;
        return (
          <div key={criterion.key} className="contents">
            <span className={cn("truncate pe-2 text-xs", split ? "font-medium text-foreground" : "text-muted-foreground")}>{criterion.short}{criterion.must ? <RequiredMark /> : null}</span>
            {voters.map((reviewer, i) => {
              const answer = given[i];
              if (!answer) return <span key={reviewer.id} className="mx-auto size-6 rounded-md border border-dashed border-border-subtle" />;
              const on = shown?.reviewer === reviewer.id && shown.criterion === criterion.key;
              // A model's answer opens the passage it read; a person's is theirs alone.
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
      {voters.map((reviewer) => (
        <span key={reviewer.id} className="flex justify-center border-t border-border-subtle pt-2"><VoteMark vote={votes[reviewer.id]} who={reviewer.name} /></span>
      ))}
    </div>
  );
}

/** The passage a model read for one answer, and what it made of it. */
export function Evidence({ paper, reviewer, criterion, answer }: { paper: Paper; reviewer: ReturnType<typeof reviewerOf>; criterion: Criterion; answer?: Answer }) {
  if (!answer) return null;
  const { quote, why } = evidence(paper, criterion, answer);
  return (
    <div className="space-y-2 rounded-2xl bg-inset p-3">
      <div className="flex items-center gap-2 text-xs">
        <ReviewerMark reviewer={reviewer} className="size-5" />
        <span className="min-w-0 flex-1 truncate font-medium">{reviewer.name}</span>
        <AnswerMark answer={answer} label={criterion.short} />
      </div>
      <p className="flex gap-2 text-sm leading-5"><Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span>{quote}</span></p>
      <p className="text-xs text-muted-foreground">{why}</p>
    </div>
  );
}
