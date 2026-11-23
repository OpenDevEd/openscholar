"use client";

// What a change to a screening would do, in plain lines, shown before the change is made.

import { ArrowRight } from "@/components/icons";
import { activeReviewers, dealtTo, effectOf, modelsOf, standing, type Screening } from "./data";
import { credits, paperCredits } from "./store";

/** Each thing a change does: who reads what, what it costs, and which results move. Empty when nothing changes. */
export function effectLines(before: Screening, after: Screening): string[] {
  const lines: string[] = [];
  const now = standing(after, "abstract");
  const total = now.papers.length;
  const was = new Set(activeReviewers(before).map((reviewer) => reviewer.id));
  const is = new Set(activeReviewers(after).map((reviewer) => reviewer.id));
  for (const reviewer of activeReviewers(after)) {
    if (was.has(reviewer.id)) continue;
    if (reviewer.kind === "model") lines.push(`${reviewer.name} reads all ${total.toLocaleString("en-GB")} papers, for up to ${credits(total * paperCredits(reviewer.model!, "abstract"))} credits`);
    else if (reviewer.email) lines.push(`${reviewer.name} gets an invitation, and papers once they join`);
    else {
      const dealt = now.papers.filter((paper, index) => dealtTo(after, "abstract", paper, index).some((one) => one.id === reviewer.id)).length;
      lines.push(dealt ? `${reviewer.name} is dealt ${dealt.toLocaleString("en-GB")} papers nobody has voted on yet` : `${reviewer.name} joins, with no paper left to deal`);
    }
  }
  for (const reviewer of activeReviewers(before)) if (!is.has(reviewer.id)) lines.push(`${reviewer.name}'s votes stay on record and stop counting`);

  const had = new Set(before.criteria.map((criterion) => criterion.key));
  const fresh = after.criteria.filter((criterion) => !had.has(criterion.key));
  if (fresh.length) {
    const read = modelsOf(after).reduce((sum, model) => sum + Math.min(after.reached.abstract[model.id] ?? 0, total) * paperCredits(model.model!, "abstract"), 0);
    if (read > 0) lines.push(`The models answer ${fresh.length === 1 ? "it" : "them"} on the papers they have read, for up to ${credits(read)} credits`);
    if (activeReviewers(after).some((reviewer) => reviewer.kind === "person")) lines.push("People's votes stand as they are");
  }

  const effect = effectOf(before, after);
  if (effect.added) lines.push(`${effect.added.toLocaleString("en-GB")} ${effect.added === 1 ? "paper joins" : "papers join"} the queue`);
  if (effect.removed) lines.push(`${effect.removed.toLocaleString("en-GB")} ${effect.removed === 1 ? "paper leaves" : "papers leave"}, with ${effect.removed === 1 ? "its" : "their"} votes kept on record`);
  if (effect.reopened) lines.push(`${effect.reopened.toLocaleString("en-GB")} settled ${effect.reopened === 1 ? "paper opens" : "papers open"} again`);
  if (effect.moved) lines.push(`${effect.moved.toLocaleString("en-GB")} settled ${effect.moved === 1 ? "paper changes" : "papers change"} result`);
  if (effect.settled) lines.push(`${effect.settled.toLocaleString("en-GB")} ${effect.settled === 1 ? "paper becomes" : "papers become"} settled`);
  return lines;
}

/** The lines of a change's effect, each on its own row. */
export function EffectList({ lines, none = "No paper's result changes" }: { lines: string[]; none?: string }) {
  return (
    <ul className="space-y-1.5">
      {(lines.length ? lines : [none]).map((line) => (
        <li key={line} className="flex items-start gap-2 text-sm">
          <ArrowRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}
