"use client";

// Pieces the screening mock's pages share: a reviewer's face or model mark, a vote, a paper's
// result, and the worked examples that show what a rule does.

import type { ReactNode } from "react";
import { ArrowRight, Check, CircleHelp, GitCompare, Hourglass, Lock, Mail, TriangleAlert, X, type AppIcon } from "@/components/icons";
import { getModelIcon } from "@/components/icons/provider-icons";
import { RequiredMark } from "@/components/screening/parts";
import { tintOf } from "@/components/settings/model-map";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DECISION_LABEL, RESULTS, RESULT_LABEL, type Decision, type Result, type Reviewer, type Rule, type Vote } from "./data";

export const RESULT_STYLE: Record<Result, { bar: string; chip: string; icon: AppIcon }> = {
  include: { bar: "bg-success", chip: "bg-success/12 ink-success", icon: Check },
  maybe: { bar: "bg-warning", chip: "bg-warning/12 ink-warning", icon: CircleHelp },
  exclude: { bar: "bg-muted-foreground/40", chip: "bg-muted text-muted-foreground", icon: X },
  conflict: { bar: "bg-info", chip: "bg-info/12 text-info", icon: GitCompare },
  waiting: { bar: "bg-foreground/10", chip: "bg-foreground/[0.06] text-muted-foreground", icon: Hourglass },
};

/** A person's photo, an envelope for someone invited who has no account yet, or a model's mark in its maker's colour. */
export function ReviewerMark({ reviewer, you = false, className }: { reviewer: Pick<Reviewer, "kind" | "name" | "imageUrl" | "email" | "model">; /** Rings your own face, where faces stand without names. */ you?: boolean; className?: string }) {
  if (you) return <span className="flex shrink-0 rounded-full ring-2 ring-primary/70 ring-offset-1 ring-offset-card"><ReviewerMark reviewer={reviewer} className={className} /></span>;
  if (reviewer.email) {
    return (
      <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground", className)}>
        <Mail className="size-[55%]" />
      </span>
    );
  }
  if (reviewer.kind === "person") return <IdentityAvatar name={reviewer.name} imageUrl={reviewer.imageUrl} className={cn("size-6", className)} />;
  const Brand = getModelIcon(reviewer.model!.id);
  const tint = tintOf(reviewer.model!.id);
  return (
    <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-card", className)} style={{ color: tint }}>
      <Brand className="size-[62%]" />
    </span>
  );
}

/** Reviewers as overlapping marks, people first. */
export function ReviewerStack({ reviewers, max = 7, className }: { reviewers: Reviewer[]; max?: number; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center", className)}>
      {reviewers.slice(0, max).map((reviewer, i) => (
        <TooltipHint key={reviewer.id} label={reviewer.name}>
          <span className={cn("flex ring-2 ring-card", reviewer.kind === "model" ? "rounded-md" : "rounded-full", i > 0 && "-ms-1.5")} tabIndex={0}>
            <ReviewerMark reviewer={reviewer} />
          </span>
        </TooltipHint>
      ))}
      {reviewers.length > max ? <span className="ms-1.5 text-xs tabular-nums text-muted-foreground">+{reviewers.length - max}</span> : null}
    </span>
  );
}

/** One vote as a small square with its sign. `hidden` is a vote cast but not shown yet, to someone who hasn't voted. */
export function VoteMark({ vote, hidden = false, failed = false, who, className }: { vote?: Pick<Vote, "decision">; hidden?: boolean; failed?: boolean; who: string; className?: string }) {
  if (failed) {
    return (
      <TooltipHint label={`${who} couldn't read this paper, so it has no say in it`}>
        <span role="img" tabIndex={0} aria-label={`${who}: couldn't read it`} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive", className)}>
          <TriangleAlert aria-hidden className="size-3.5" />
        </span>
      </TooltipHint>
    );
  }
  if (!vote) return <span role="img" aria-label={`${who}: no vote yet`} className={cn("inline-block size-6 shrink-0 rounded-md border border-dashed border-border", className)} />;
  if (hidden) {
    return (
      <span role="img" aria-label={`${who}: voted, hidden until you vote`} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06] text-muted-foreground", className)}>
        <Lock aria-hidden className="size-3 opacity-70" />
      </span>
    );
  }
  const { icon: Icon, chip } = RESULT_STYLE[vote.decision];
  return (
    <span role="img" aria-label={`${who}: ${DECISION_LABEL[vote.decision]}`} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md", chip, className)}>
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
  const total = RESULTS.reduce((sum, result) => sum + counts[result], 0);
  const label = RESULTS.filter((result) => counts[result]).map((result) => `${counts[result].toLocaleString("en-GB")} ${RESULT_LABEL[result].toLowerCase()}`).join(", ") || "No papers yet";
  return (
    <TooltipHint label={label}>
      <div role="img" aria-label={label} tabIndex={0} className={cn("flex h-2.5 w-full gap-px overflow-hidden rounded-full", className)}>
        {total === 0 ? <span className="h-full flex-1 rounded-full bg-foreground/10" /> : null}
        {RESULTS.map((result) =>
          counts[result] ? (
            <span
              key={result}
              className={cn("h-full min-w-1.5 basis-0 transition-[flex-grow] duration-500 ease-out motion-reduce:transition-none", RESULT_STYLE[result].bar)}
              // Waiting is hatched, so papers still to be voted on never read as excluded ones.
              style={{ flexGrow: counts[result], ...(result === "waiting" ? { backgroundImage: "repeating-linear-gradient(-45deg, transparent 0 3px, color-mix(in oklab, var(--foreground) 14%, transparent) 3px 5px)" } : {}) }}
            />
          ) : null,
        )}
      </div>
    </TooltipHint>
  );
}

/** How a paper's reviewers voted, as a count beside each decision's mark. */
export function Tally({ votes, className }: { votes: Array<Pick<Vote, "decision">>; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      {(["include", "maybe", "exclude"] as const).map((decision) => {
        const n = votes.filter((vote) => vote.decision === decision).length;
        const Icon = RESULT_STYLE[decision].icon;
        return n ? (
          <span key={decision} role="img" aria-label={`${n} ${DECISION_LABEL[decision].toLowerCase()}`} className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
            <span className={cn("flex size-4 items-center justify-center rounded", RESULT_STYLE[decision].chip)}><Icon className="size-2.5" /></span>
            {n}
          </span>
        ) : null;
      })}
    </span>
  );
}

/** A key the button beside it answers to. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-subtle bg-card px-1 font-sans text-2xs font-medium text-muted-foreground", className)}>{children}</kbd>;
}

/** A criterion's words, with the must-have mark kept on the line of its last word. */
export function CriterionText({ text, must }: { text: string; must: boolean }) {
  if (!must) return <>{text}</>;
  const at = text.lastIndexOf(" ");
  return <>{text.slice(0, at + 1)}<span className="whitespace-nowrap">{text.slice(at + 1)}<RequiredMark /></span></>;
}

/**
 * What a rule does, shown on three made-up papers: the votes a paper might get, an arrow, and where
 * that leaves it. It stands in for a paragraph of explanation.
 */
export function RuleExamples({ rule, people, models }: { rule: Rule; people: number; models: number }) {
  const votes = Math.max(1, models + (rule.each === "all" ? people : Math.min(Number(rule.each), people)));
  const row = (decisions: Array<Decision | null>): Result => {
    const cast = decisions.flatMap((d) => d ?? []);
    if (rule.settle === "one") return cast[0] ?? "waiting";
    if (cast.length < decisions.length) return "waiting";
    const top = (["include", "maybe", "exclude"] as const).map((d) => ({ d, n: cast.filter((c) => c === d).length })).sort((a, b) => b.n - a.n)[0]!;
    if (rule.settle === "all") return top.n === cast.length ? top.d : "conflict";
    return top.n * 2 > cast.length ? top.d : "conflict";
  };
  const fill = (first: Decision, rest: Decision) => Array.from({ length: votes }, (_, i) => (i === 0 ? first : rest));
  const examples: Array<Array<Decision | null>> = [
    fill("include", "include"),
    votes > 1 ? fill("exclude", "include") : fill("exclude", "exclude"),
    [...fill("include", "include").slice(0, -1), null],
  ];
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {examples.map((decisions, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="flex gap-0.5">
            {decisions.slice(0, 6).map((decision, n) => <VoteMark key={n} vote={decision ? { decision } : undefined} who={`Reviewer ${n + 1}`} className="size-5" />)}
          </span>
          <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <ResultChip result={row(decisions)} />
        </div>
      ))}
    </div>
  );
}
