"use client";

// What a change to a screening would do, shown before the change is made: who reads what and what
// it costs, one line each with an icon for its kind, then which results move, as counts that open
// the papers behind them.

import { useState } from "react";
import NextLink from "next/link";
import { ArrowRight, ChevronDown, Coins, Mail, Minus, RefreshCw, RotateCcw, UserPlus, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { Chip } from "@/components/screening/parts";
import { cn } from "@/lib/utils";
import { EVERY_LABEL, RESULT_LABEL, activeReviewers, defaultScoring, dealtTo, effectOf, growing, modelsOf, personOf, standing, type Move, type Screening } from "./data";
import { COLLECTIONS, COMMUNITY_COLLECTIONS } from "./form-data";
import { papersHref } from "./links";
import { ResultChip } from "./parts";
import { credits, paperCredits } from "./store";

/** The part of the settings a line is about, by its anchor there. */
export type EffectSection = "name" | "papers" | "new-papers" | "criteria" | "reviewers" | "decided" | "goes-to";
/**
 * One thing a change does. `kind` gives it its icon: what it costs, who joins, votes that stop
 * counting, the schedule, an email that goes out, or a screening that opens again. `credits` is
 * shown in a chip at the line's end, `each` when it is paid for every new paper.
 */
export type EffectLine = { text: string; kind?: "cost" | "join" | "leave" | "schedule" | "mail" | "reopen"; credits?: number; each?: boolean; section?: EffectSection };

const KIND_ICON: Record<NonNullable<EffectLine["kind"]>, AppIcon> = { cost: Coins, join: UserPlus, leave: Minus, schedule: RefreshCw, mail: Mail, reopen: RotateCcw };
const n = (count: number, one: string, many: string) => `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
const names = (list: string[]) => (list.length < 2 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);

/** Where a screening's included papers are saved, by name, or null where they stay in it. */
export function collectionName(screening: Screening) {
  const to = screening.destination;
  if (to.kind === "none") return null;
  if (to.kind === "new") return to.name || `Included in ${screening.name}`;
  return [...COLLECTIONS, ...COMMUNITY_COLLECTIONS].find((one) => one.id === to.collection)?.name ?? null;
}

/**
 * Whether someone changed the scoring itself. Points that come and go with a criterion are that
 * criterion's change, and stars nobody set follow the number of criteria by themselves.
 */
export function scoringChanged(before: Screening, after: Screening) {
  const followed = (screening: Screening) => JSON.stringify(screening.scoring.stars) === JSON.stringify(defaultScoring(screening.criteria).stars);
  const stars = JSON.stringify(before.scoring.stars) !== JSON.stringify(after.scoring.stars) && !(followed(before) && followed(after));
  return stars || before.criteria.some((criterion) => after.criteria.some((one) => one.key === criterion.key) && JSON.stringify(before.scoring.points[criterion.key]) !== JSON.stringify(after.scoring.points[criterion.key]));
}

/** Each thing a change does besides moving results, in the order a person checks them. */
export function effectItems(before: Screening, after: Screening): EffectLine[] {
  const lines: EffectLine[] = [];
  const [was, now] = [standing(before), standing(after)];
  const total = now.papers.length;
  const effect = effectOf(before, after);
  const wasIds = new Set(activeReviewers(before).map((reviewer) => reviewer.id));
  const isIds = new Set(activeReviewers(after).map((reviewer) => reviewer.id));

  // A finished screening that gets papers to vote on is open again: said first, since it changes the screening's state.
  const reopened = effect.moves.filter((move) => move.to === "conflict" || move.to === "waiting").reduce((sum, move) => sum + move.papers.length, 0) + effect.added;
  if (before.finishedAt && reopened) lines.push({ text: `It opens again: ${n(reopened, "paper needs", "papers need")} votes`, kind: "reopen" });

  const joining = activeReviewers(after).filter((reviewer) => !wasIds.has(reviewer.id));
  for (const reviewer of joining) {
    if (reviewer.kind === "model") lines.push({ text: `${reviewer.name} reads all ${n(total, "paper", "papers")} ${after.paused ? "once the models resume" : "as soon as this is saved"}`, kind: "cost", credits: total * paperCredits(reviewer.model!), section: "reviewers" });
    else if (reviewer.email) lines.push({ text: `${reviewer.name} gets an invitation by email, and papers once they join`, kind: "mail", section: "reviewers" });
    else {
      const dealt = now.papers.filter((paper, index) => dealtTo(after, paper, index).some((one) => one.id === reviewer.id)).length;
      lines.push({ text: dealt ? `${reviewer.name} is dealt ${n(dealt, "paper", "papers")} nobody has voted on yet, and is told by email` : `${reviewer.name} joins with no paper left to deal, and is told by email`, kind: "join", section: "reviewers" });
    }
  }
  if (joining.length && wasIds.size) {
    lines.push({ text: "Votes already cast stay as they are", section: "reviewers" });
    if (joining.some((reviewer) => reviewer.kind === "model") && after.rule.settle !== "one") lines.push({ text: after.rule.settle === "all" ? "A paper where it votes differently from the others becomes a conflict" : "Its vote counts with the others: a paper it tips into an even split becomes a conflict", section: "reviewers" });
  }
  for (const reviewer of activeReviewers(before)) {
    if (isIds.has(reviewer.id)) continue;
    lines.push({ text: `${reviewer.name}'s votes stay on record and stop counting`, kind: "leave", section: "reviewers" });
    if (reviewer.kind !== "person") continue;
    // The papers dealt to them that they hadn't got to, and who has them now.
    const left = was.papers.filter((paper) => was.votes[paper.id]?.some((one) => one.reviewer.id === reviewer.id && !one.vote));
    if (!left.length) continue;
    const taking = [...new Set(left.flatMap((paper) => (now.votes[paper.id] ?? []).filter((one) => one.reviewer.kind === "person" && !was.votes[paper.id]?.some((had) => had.reviewer.id === one.reviewer.id)).map((one) => one.reviewer.name)))];
    lines.push({ text: taking.length ? `${n(left.length, "paper", "papers")} ${reviewer.name} had not voted on ${left.length === 1 ? "goes" : "go"} to ${names(taking)}` : `${n(left.length, "paper", "papers")} ${reviewer.name} had not voted on ${left.length === 1 ? "is" : "are"} settled on the other votes`, section: "reviewers" });
  }

  if (before.rule.resolver !== after.rule.resolver && after.rule.settle !== "one") {
    const [from, to] = [personOf(before.rule.resolver)?.name, personOf(after.rule.resolver)?.name ?? "the person who started it"];
    lines.push({ text: from && !isIds.has(before.rule.resolver) ? `${from} settled conflicts: they go to ${to} from now on` : `Conflicts go to ${to} from now on`, section: "decided" });
  }
  const people = (screening: Screening) => activeReviewers(screening).filter((reviewer) => reviewer.kind === "person" && !reviewer.email).length;
  const eachOf = (screening: Screening) => (screening.rule.each === "all" ? people(screening) : Math.min(Number(screening.rule.each), people(screening)));
  if (before.rule.each !== after.rule.each && eachOf(before) !== eachOf(after) && people(before) === people(after)) {
    const more = eachOf(after) > eachOf(before);
    const changed = now.papers.filter((paper) => was.votes[paper.id] && (now.votes[paper.id]?.length ?? 0) !== was.votes[paper.id]!.length).length;
    const diff = Math.abs(eachOf(after) - eachOf(before));
    lines.push({ text: `Each paper goes to ${n(eachOf(after), "person", "people")}${changed ? `: ${n(changed, "paper is", "papers are")} dealt to ${diff === 1 ? "one" : diff} ${more ? "more" : "fewer"} ${diff === 1 ? "person" : "people"}` : ""}`, kind: more ? "join" : undefined, section: "decided" });
  }
  if (before.rule.blind !== after.rule.blind) lines.push({ text: after.rule.blind === "always" ? "Everyone sees every vote as it is cast" : "People see a paper's votes once they have cast theirs", section: "decided" });

  const had = new Set(before.criteria.map((criterion) => criterion.key));
  const fresh = after.criteria.filter((criterion) => !had.has(criterion.key));
  if (fresh.length) {
    const read = rereadCost(after);
    if (read > 0) lines.push({ text: `The models answer ${fresh.length === 1 ? "it" : "them"} on the papers they have read`, kind: "cost", credits: read, section: "criteria" });
    if (activeReviewers(after).some((reviewer) => reviewer.kind === "person")) lines.push({ text: `People's votes stand as they are: they were cast before ${fresh.length === 1 ? "this criterion" : "these criteria"}`, section: "criteria" });
  }
  for (const criterion of before.criteria) {
    const now = after.criteria.find((one) => one.key === criterion.key);
    if (!now) lines.push({ text: `Answers to “${criterion.short}” stop counting`, kind: "leave", section: "criteria" });
    else if (now.must !== criterion.must) lines.push({ text: now.must ? `“${now.short}” becomes must-have: a no on it excludes a paper` : `“${now.short}” becomes nice to have and stops excluding papers`, section: "criteria" });
    else if (now.text !== criterion.text) lines.push({ text: `The models answer the reworded “${now.short}” on papers they read from now on`, section: "criteria" });
  }
  if (scoringChanged(before, after)) lines.push({ text: "Included papers' points and stars are worked out again", section: "criteria" });

  if (after.living && !before.living) {
    const sources = growing(after).length;
    lines.push({ text: sources ? `It checks ${sources === 1 ? "its source" : `${sources} of its sources`} for new papers as soon as this is saved, then ${EVERY_LABEL[after.living.every].toLowerCase()}` : "It has no source that gains papers, so there is nothing to check yet", kind: "schedule", section: "new-papers" });
    const each = modelsOf(after).reduce((sum, model) => sum + paperCredits(model.model!), 0);
    lines.push(each ? { text: "The models read each new paper, then it is dealt to its reviewers", kind: "cost", credits: each, each: true, section: "new-papers" } : { text: "Each new paper is dealt to its reviewers, who are told by email", kind: "mail", section: "new-papers" });
    if (before.finishedAt && !reopened) lines.push({ text: "It is open again, and stays open to new papers", kind: "reopen", section: "new-papers" });
  } else if (before.living && !after.living) lines.push({ text: "It stops checking for new papers. The ones it has stay", kind: "schedule", section: "new-papers" });
  else if (before.living && after.living && before.living.every !== after.living.every) lines.push({ text: `It checks for new papers ${EVERY_LABEL[after.living.every].toLowerCase()} from now on`, kind: "schedule", section: "new-papers" });

  if (effect.added) lines.push({ text: `${n(effect.added, "paper joins", "papers join")} the queue`, section: "papers" });
  if (effect.removed) lines.push({ text: `${n(effect.removed, "paper leaves", "papers leave")}, with ${effect.removed === 1 ? "its" : "their"} votes kept on record`, kind: "leave", section: "papers" });

  const [from, to] = [collectionName(before), collectionName(after)];
  if (from !== to) {
    const included = was.counts.include;
    lines.push({ text: !to ? `Included papers stop being saved to a collection${from && included ? `. The ${n(included, "one", "ones")} in ${from} stay there` : ""}` : `The ${n(included, "paper", "papers")} included so far ${included === 1 ? "is" : "are"} added to ${to}${from ? `. They stay in ${from}` : ""}`, section: "goes-to" });
  }
  if (before.destination.prune !== after.destination.prune) lines.push({ text: after.destination.prune ? "Excluded papers are taken out of the collection they came from" : "Excluded papers stay in the collection they came from", section: "goes-to" });
  return lines;
}

/** The same lines as plain sentences, for a confirmation and the screening's activity. */
export const effectLines = (before: Screening, after: Screening) => effectItems(before, after).map(lineText);
/** One line as a sentence, its credits said in words. */
export const lineText = (line: EffectLine) => (line.credits ? `${line.text}, for up to ${credits(line.credits)} credits${line.each ? " each" : ""}` : line.text);

/** What it costs for the models to answer new criteria on the papers they have already read. */
export const rereadCost = (screening: Screening) => {
  const total = standing(screening).papers.length;
  return modelsOf(screening).reduce((sum, model) => sum + Math.min(screening.reached[model.id] ?? 0, total) * paperCredits(model.model!), 0);
};

/** The results a change moves: so many papers from one result to another. */
export const effectMoves = (before: Screening, after: Screening) => effectOf(before, after).moves;
/** The same, in words, for the screening's activity. */
export const movesText = (moves: Move[]) => moves.map((move) => `${move.papers.length} ${RESULT_LABEL[move.from].toLowerCase()} to ${RESULT_LABEL[move.to].toLowerCase()}`).join(", ");

const PAPERS_PAGE = 8;

/**
 * The lines of a change's effect, each on its own row, then each move of results with the papers it
 * covers. With `screening`, each paper opens on the Papers page. With `toSection`, a line opens the
 * part of the settings it is about.
 */
export function EffectList({ lines, moves = [], none = "No paper's result changes", screening, toSection }: { lines: Array<string | EffectLine>; moves?: Move[]; none?: string; screening?: string; toSection?: (section: EffectSection) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const items = (lines.length ? lines : moves.length ? [] : [none]).map((line) => (typeof line === "string" ? { text: line } : line));
  return (
    <div className="space-y-2.5">
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((line) => {
            const Icon = line.kind ? KIND_ICON[line.kind] : ArrowRight;
            const body = (
              <>
                <Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", line.kind === "leave" || line.kind === "reopen" ? "ink-warning" : line.kind === "cost" ? "text-foreground" : "text-muted-foreground")} />
                <span className={cn("min-w-0 flex-1", line.kind === "cost" && "font-medium", line.kind === "reopen" && "font-medium ink-warning")}>{line.text}</span>
                {line.credits ? <Chip icon={Coins} className="-my-0.5 font-medium text-foreground">{credits(line.credits)}{line.each ? " each" : ""}</Chip> : null}
              </>
            );
            return (
              <li key={line.text}>
                {line.section && toSection ? (
                  <a href={toSection(line.section)} className="-mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-0.5 text-sm outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/50">{body}</a>
                ) : (
                  <span className="flex items-start gap-2 text-sm">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {moves.length ? (
        <ul className="@container divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-card">
          {moves.map((move) => {
            const key = `${move.from}>${move.to}`;
            const shown = open === key;
            const pages = Math.ceil(move.papers.length / PAPERS_PAGE);
            const at = Math.min(page, pages);
            return (
              <li key={key}>
                {/* The count opens the papers it stands for, so a change is never taken on trust. */}
                <button type="button" aria-expanded={shown} onClick={() => { setOpen(shown ? null : key); setPage(1); }} className="flex w-full items-center gap-2 px-2.5 py-2 text-start transition-colors hover:bg-muted">
                  <span className="w-7 shrink-0 text-end text-sm font-semibold tabular-nums">{move.papers.length}</span>
                  {/* A move is one line, or where that doesn't fit, a column with the arrow pointing down: the arrow never ends a line with nothing after it. */}
                  <span className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 @max-[19rem]:flex-col @max-[19rem]:items-start @max-[19rem]:gap-0.5">
                    <ResultChip result={move.from} />
                    <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground @max-[19rem]:ms-2 @max-[19rem]:rotate-90" />
                    <ResultChip result={move.to} />
                  </span>
                  <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", shown && "rotate-180")} />
                </button>
                {shown ? (
                  <div className="space-y-1 border-t border-border-subtle bg-inset px-3 py-2">
                    <ul className="space-y-1">
                      {move.papers.slice((at - 1) * PAPERS_PAGE, at * PAPERS_PAGE).map((paper) => (
                        <li key={paper.id} className="flex gap-2 text-xs text-muted-foreground">
                          <span className="shrink-0 font-medium tabular-nums text-foreground">{paper.year}</span>
                          {screening ? (
                            <NextLink href={papersHref(screening, { paper: paper.id })} className="min-w-0 rounded-sm underline decoration-foreground/20 underline-offset-2 outline-none transition-colors hover:text-foreground hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/50">{paper.title}</NextLink>
                          ) : (
                            <span className="min-w-0">{paper.title}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={at} totalPages={pages} onPageChange={setPage} totalItems={move.papers.length} itemsPerPage={PAPERS_PAGE} itemLabel="papers" /> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
