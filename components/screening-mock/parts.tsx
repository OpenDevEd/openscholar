"use client";

// Pieces the screening mock's pages share: a reviewer's face or model mark, a vote, a paper's result.

import { useMemo, useState, type ReactNode } from "react";
import { Check, CircleHelp, Eye, GitCompare, Hourglass, X, type AppIcon } from "@/components/icons";
import { RequiredMark } from "@/components/screening/parts";
import { getModelIcon } from "@/components/icons/provider-icons";
import { tintOf } from "@/components/settings/model-map";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DECISION_LABEL, RESULTS, RESULT_LABEL, STAGES, YOU, dealtTo, settle, type Decision, type Result, type Reviewer, type Stage, type Vote, type Votes } from "./data";

export const RESULT_STYLE: Record<Result, { bar: string; chip: string; icon: AppIcon }> = {
  include: { bar: "bg-success", chip: "bg-success/12 ink-success", icon: Check },
  maybe: { bar: "bg-warning", chip: "bg-warning/12 ink-warning", icon: CircleHelp },
  exclude: { bar: "bg-muted-foreground/40", chip: "bg-muted text-muted-foreground", icon: X },
  conflict: { bar: "bg-primary", chip: "bg-primary/12 text-primary", icon: GitCompare },
  waiting: { bar: "bg-foreground/10", chip: "bg-foreground/[0.06] text-muted-foreground", icon: Hourglass },
};

/** A person's photo, or a model's mark in its maker's colour: the same size and place in every list. */
export function ReviewerMark({ reviewer, className }: { reviewer: Reviewer; className?: string }) {
  if (reviewer.kind === "person") return <IdentityAvatar name={reviewer.name} imageUrl={reviewer.imageUrl} className={cn("size-6", className)} />;
  const Brand = getModelIcon(reviewer.modelId!);
  const tint = tintOf(reviewer.modelId!);
  return (
    <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", className)} style={{ backgroundColor: `color-mix(in oklab, ${tint} 20%, var(--card))`, color: tint }}>
      <Brand className="size-[58%]" />
    </span>
  );
}

/** Reviewers as overlapping marks, people first. */
export function ReviewerStack({ reviewers, max = 6 }: { reviewers: Reviewer[]; max?: number }) {
  const shown = reviewers.slice(0, max);
  return (
    <span className="flex shrink-0 items-center">
      {shown.map((reviewer, i) => (
        <TooltipHint key={reviewer.id} label={reviewer.name}>
          <span className={cn("flex rounded-full ring-2 ring-card", reviewer.kind === "model" && "rounded-md", i > 0 && "-ms-1.5")} tabIndex={0}>
            <ReviewerMark reviewer={reviewer} />
          </span>
        </TooltipHint>
      ))}
      {reviewers.length > max ? <span className="ms-1.5 text-xs tabular-nums text-muted-foreground">+{reviewers.length - max}</span> : null}
    </span>
  );
}

/** One vote as a small square with its sign. `hidden` is a vote cast but not shown yet, to someone who hasn't voted. */
export function VoteMark({ vote, hidden = false, who, className }: { vote?: Pick<Vote, "decision">; hidden?: boolean; who: string; className?: string }) {
  if (!vote) return <span role="img" aria-label={`${who}: no vote yet`} className={cn("inline-block size-6 rounded-md border border-dashed border-border-subtle", className)} />;
  if (hidden) {
    return (
      <span role="img" aria-label={`${who}: voted, hidden until you vote`} className={cn("inline-flex size-6 items-center justify-center rounded-md bg-foreground/[0.06] text-muted-foreground/60", className)}>
        <Eye aria-hidden className="size-3.5 opacity-50" />
      </span>
    );
  }
  const { icon: Icon, chip } = RESULT_STYLE[vote.decision];
  return (
    <span role="img" aria-label={`${who}: ${DECISION_LABEL[vote.decision]}`} className={cn("inline-flex size-6 items-center justify-center rounded-md", chip, className)}>
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

/** Where a paper stands, as a chip. */
export function ResultChip({ result, className }: { result: Result; className?: string }) {
  const { icon: Icon, chip } = RESULT_STYLE[result];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium", chip, className)}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {RESULT_LABEL[result]}
    </span>
  );
}

/** A screening's papers as one bar, split by where they stand. */
export function ResultBar({ counts, className }: { counts: Record<Result, number>; className?: string }) {
  return (
    <div className={cn("flex h-2.5 w-full gap-0.5", className)}>
      {RESULTS.map((result) =>
        counts[result] ? <span key={result} className={cn("h-full basis-0 rounded-full transition-[flex-grow] duration-500 ease-out motion-reduce:transition-none", RESULT_STYLE[result].bar)} style={{ flexGrow: counts[result] }} /> : null,
      )}
    </div>
  );
}

/** A criterion's words, with the must-have mark kept on the line of its last word. */
export function CriterionText({ text, must }: { text: string; must: boolean }) {
  if (!must) return <>{text}</>;
  const at = text.lastIndexOf(" ");
  return <>{text.slice(0, at + 1)}<span className="whitespace-nowrap">{text.slice(at + 1)}<RequiredMark /></span></>;
}

/** A key the button beside it answers to. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-subtle bg-card px-1 font-sans text-2xs font-medium text-muted-foreground", className)}>{children}</kbd>;
}

export type Screening = ReturnType<typeof useScreening>;

/**
 * The open screening's state at one stage: the made-up votes with yours on top, and where each paper
 * stands. Your votes and the conflicts you settle live in the page only: nothing is saved.
 */
export function useScreening(stage: Stage) {
  const [mine, setMine] = useState<Record<Stage, Record<string, Vote | null>>>({ abstract: {}, fullText: {} });
  const [resolved, setResolved] = useState<Record<Stage, Record<string, Decision | null>>>({ abstract: {}, fullText: {} });
  const base = STAGES[stage];
  const votes = useMemo<Votes>(() => {
    const out: Votes = { ...base.votes };
    for (const [paperId, vote] of Object.entries(mine[stage])) out[paperId] = { ...out[paperId], [YOU.id]: vote ?? undefined };
    return out;
  }, [base, mine, stage]);
  const settled = useMemo(() => {
    const final = { ...base.resolved };
    for (const [paperId, decision] of Object.entries(resolved[stage])) {
      if (decision) final[paperId] = decision;
      else delete final[paperId];
    }
    return settle(base.papers, votes, final);
  }, [base, votes, resolved, stage]);
  const counts = useMemo(() => {
    const out: Record<Result, number> = { include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0 };
    for (const paper of base.papers) out[settled[paper.id]!.result]++;
    return out;
  }, [base, settled]);
  /** The papers dealt to you, in order, and the ones you haven't voted on. */
  const yours = useMemo(() => base.papers.filter((_, index) => dealtTo(index).includes(YOU.id)), [base]);
  const toDo = useMemo(() => yours.filter((paper) => !votes[paper.id]?.[YOU.id]), [yours, votes]);
  const conflicts = useMemo(() => base.papers.filter((paper) => settled[paper.id]!.result === "conflict"), [base, settled]);
  return {
    stage,
    papers: base.papers,
    votes,
    settled,
    counts,
    yours,
    toDo,
    conflicts,
    vote: (paperId: string, vote: Vote | null) => setMine((all) => ({ ...all, [stage]: { ...all[stage], [paperId]: vote } })),
    resolve: (paperId: string, decision: Decision | null) => setResolved((all) => ({ ...all, [stage]: { ...all[stage], [paperId]: decision } })),
  };
}

/** Whether you may see the other votes on a paper: always on one that isn't yours, and on yours once you've voted. */
export const canSee = (screening: Screening, paperId: string) => !screening.yours.some((paper) => paper.id === paperId) || Boolean(screening.votes[paperId]?.[YOU.id]);
