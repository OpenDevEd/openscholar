"use client";

// What a change to a screening would do, shown before the change is made: who reads what and what
// it costs, in plain lines, then which results move, as counts that open the papers behind them.

import { useState } from "react";
import { ArrowRight, ChevronDown } from "@/components/icons";
import { cn } from "@/lib/utils";
import { EVERY_LABEL, RESULT_LABEL, activeReviewers, dealtTo, effectOf, growing, modelsOf, standing, type Move, type Screening } from "./data";
import { ResultChip } from "./parts";
import { credits, paperCredits } from "./store";

/** Each thing a change does besides moving results: who reads what, what it costs, and which papers join or leave. */
export function effectLines(before: Screening, after: Screening): string[] {
  const lines: string[] = [];
  const now = standing(after);
  const total = now.papers.length;
  const was = new Set(activeReviewers(before).map((reviewer) => reviewer.id));
  const is = new Set(activeReviewers(after).map((reviewer) => reviewer.id));
  const joining = activeReviewers(after).filter((reviewer) => !was.has(reviewer.id));
  for (const reviewer of joining) {
    if (reviewer.kind === "model") lines.push(`${reviewer.name} reads all ${total.toLocaleString("en-GB")} papers, for up to ${credits(total * paperCredits(reviewer.model!))} credits, and starts as soon as this is saved`);
    else if (reviewer.email) lines.push(`${reviewer.name} gets an invitation by email, and papers once they join`);
    else {
      const dealt = now.papers.filter((paper, index) => dealtTo(after, paper, index).some((one) => one.id === reviewer.id)).length;
      lines.push(dealt ? `${reviewer.name} is dealt ${dealt.toLocaleString("en-GB")} papers nobody has voted on yet, and is told by email` : `${reviewer.name} joins with no paper left to deal, and is told by email`);
    }
  }
  if (joining.length && was.size) {
    lines.push("Votes already cast stay as they are");
    if (joining.some((reviewer) => reviewer.kind === "model") && after.rule.settle !== "one") lines.push(after.rule.settle === "all" ? "A paper where it votes differently from the others becomes a conflict" : "Its vote counts with the others: a paper it tips into an even split becomes a conflict");
  }
  for (const reviewer of activeReviewers(before)) if (!is.has(reviewer.id)) lines.push(`${reviewer.name}'s votes stay on record and stop counting`);

  const had = new Set(before.criteria.map((criterion) => criterion.key));
  const fresh = after.criteria.filter((criterion) => !had.has(criterion.key));
  if (fresh.length) {
    const read = rereadCost(after);
    if (read > 0) lines.push(`The models answer ${fresh.length === 1 ? "it" : "them"} on the papers they have read, for up to ${credits(read)} credits`);
    if (activeReviewers(after).some((reviewer) => reviewer.kind === "person")) lines.push(`People's votes stand as they are: they were cast before ${fresh.length === 1 ? "this criterion" : "these criteria"}`);
  }

  if (after.living && !before.living) {
    const sources = growing(after).length;
    lines.push(sources ? `It looks in ${sources === 1 ? "its source" : `${sources} of its sources`} for new papers as soon as this is saved, then ${EVERY_LABEL[after.living.every].toLowerCase()}` : "It has no source that gains papers, so there is nothing for it to look in yet");
    const each = modelsOf(after).reduce((sum, model) => sum + paperCredits(model.model!), 0);
    lines.push(each ? `Each new paper costs up to ${credits(each)} credits for the models to read, and is dealt to its reviewers` : "Each new paper is dealt to its reviewers, who are told by email");
    if (before.finishedAt) lines.push("It is open again, and stays open to new papers");
  } else if (before.living && !after.living) lines.push("It stops looking for new papers. The ones it has stay");
  else if (before.living && after.living && before.living.every !== after.living.every) lines.push(`It looks for new papers ${EVERY_LABEL[after.living.every].toLowerCase()} from now on`);

  const effect = effectOf(before, after);
  if (effect.added) lines.push(`${effect.added.toLocaleString("en-GB")} ${effect.added === 1 ? "paper joins" : "papers join"} the queue`);
  if (effect.removed) lines.push(`${effect.removed.toLocaleString("en-GB")} ${effect.removed === 1 ? "paper leaves" : "papers leave"}, with ${effect.removed === 1 ? "its" : "their"} votes kept on record`);
  return lines;
}

/** What it costs for the models to answer new criteria on the papers they have already read. */
export const rereadCost = (screening: Screening) => {
  const total = standing(screening).papers.length;
  return modelsOf(screening).reduce((sum, model) => sum + Math.min(screening.reached[model.id] ?? 0, total) * paperCredits(model.model!), 0);
};

/** The results a change moves: so many papers from one result to another. */
export const effectMoves = (before: Screening, after: Screening) => effectOf(before, after).moves;
/** The same, in words, for the screening's activity. */
export const movesText = (moves: Move[]) => moves.map((move) => `${move.papers.length} ${RESULT_LABEL[move.from].toLowerCase()} to ${RESULT_LABEL[move.to].toLowerCase()}`).join(", ");

/** The lines of a change's effect, each on its own row, then each move of results with the papers it covers. */
export function EffectList({ lines, moves = [], none = "No paper's result changes" }: { lines: string[]; moves?: Move[]; none?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-2.5">
      {lines.length || !moves.length ? (
        <ul className="space-y-1.5">
          {(lines.length ? lines : [none]).map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm">
              <ArrowRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {moves.length ? (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
          {moves.map((move) => {
            const key = `${move.from}>${move.to}`;
            const shown = open === key;
            return (
              <li key={key}>
                {/* The count opens the papers it stands for, so a change is never taken on trust. */}
                <button type="button" aria-expanded={shown} onClick={() => setOpen(shown ? null : key)} className="flex w-full items-center gap-2 px-2.5 py-2 text-start transition-colors hover:bg-muted">
                  <span className="w-7 shrink-0 text-end text-sm font-semibold tabular-nums">{move.papers.length}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <ResultChip result={move.from} />
                    <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <ResultChip result={move.to} />
                  </span>
                  <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", shown && "rotate-180")} />
                </button>
                {shown ? (
                  <ul className="space-y-1 border-t border-border-subtle bg-inset px-3 py-2">
                    {move.papers.slice(0, 8).map((paper) => <li key={paper.id} className="flex gap-2 text-xs text-muted-foreground"><span className="shrink-0 font-medium tabular-nums text-foreground">{paper.year}</span><span className="min-w-0">{paper.title}</span></li>)}
                    {move.papers.length > 8 ? <li className="text-xs text-muted-foreground">and {move.papers.length - 8} more</li> : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
