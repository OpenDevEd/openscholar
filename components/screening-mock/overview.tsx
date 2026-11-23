"use client";

// The open screening's Overview: how far it has got, who has done what, how far the reviewers
// agree, and the counts a methods section asks for.

import { useMemo } from "react";
import { ArrowRight, Coins, GitCompare, ListChecks } from "@/components/icons";
import { AnimatedNumber, Chip, Meter } from "@/components/screening/parts";
import { LIST, Zone } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { YouTag } from "@/components/ui/identity";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CRITERIA, DECISIONS, RESULTS, RESULT_LABEL, REVIEWERS, SOURCES, STAGES, agreement, count, votersOf, type Result } from "./data";
import { RESULT_STYLE, ResultBar, ReviewerMark, type Screening } from "./parts";

export function Overview({ screening, onOpen }: { screening: Screening; onOpen: (view: "screen" | "papers", filter?: Result | "conflicts" | "todo") => void }) {
  const { papers, votes, settled, counts, toDo, conflicts } = screening;
  const rows = useMemo(
    () =>
      REVIEWERS.map((reviewer) => {
        const theirs = papers.filter((_, index) => votersOf(index).includes(reviewer));
        const cast = theirs.flatMap((paper) => votes[paper.id]?.[reviewer.id] ?? []);
        const judged = theirs.flatMap((paper) => {
          const [vote, final] = [votes[paper.id]?.[reviewer.id], settled[paper.id]!.final];
          return vote && final ? [{ vote: vote.decision, final }] : [];
        });
        return {
          reviewer,
          assigned: theirs.length,
          done: cast.length,
          split: DECISIONS.map((decision) => count(cast, (vote) => vote.decision === decision)),
          agrees: judged.length ? count(judged, (one) => one.vote === one.final) / judged.length : null,
          missed: count(judged, (one) => one.final === "include" && one.vote === "exclude"),
          included: count(judged, (one) => one.final === "include"),
        };
      }),
    [papers, votes, settled],
  );
  const matrix = useMemo(() => REVIEWERS.map((a) => REVIEWERS.map((b) => (a === b ? null : agreement(a.id, b.id, papers, votes)))), [papers, votes]);

  return (
    <div className="@container/overview space-y-7 p-4 sm:p-6">
      <Zone
        label="Progress"
        aside={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" disabled={!toDo.length} onClick={() => onOpen("screen", "todo")}>
              <ListChecks />
              Screen <AnimatedNumber value={toDo.length} /> papers
            </Button>
            <Button size="sm" variant="outline" disabled={!conflicts.length} onClick={() => onOpen("screen", "conflicts")}>
              <GitCompare />
              Resolve <AnimatedNumber value={conflicts.length} /> conflicts
            </Button>
          </div>
        }
      >
        <ResultBar counts={counts} className="h-3" />
        {/* Each count opens its papers. */}
        <div className="-mx-2 flex flex-wrap gap-x-1 gap-y-1 pt-1">
          {RESULTS.map((result) => {
            const Icon = RESULT_STYLE[result].icon;
            return (
              <button key={result} type="button" onClick={() => onOpen("papers", result)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted">
                <span className={cn("flex size-6 items-center justify-center rounded-md", RESULT_STYLE[result].chip)}><Icon className="size-3.5" /></span>
                <span className="font-semibold tabular-nums"><AnimatedNumber value={counts[result]} /></span>
                <span className="text-muted-foreground">{RESULT_LABEL[result]}</span>
              </button>
            );
          })}
        </div>
      </Zone>

      <div className="grid grid-cols-1 gap-7 @5xl/overview:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Zone label="Reviewers">
          <div className={LIST}>
            <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_5.5rem] items-center gap-4 bg-inset px-4 py-2 text-xs text-muted-foreground @max-2xl/overview:hidden">
              <span>Reviewer</span>
              <span>Papers voted on</span>
              <span>Their votes</span>
              <span className="text-end">Agrees with the result</span>
            </div>
            {rows.map(({ reviewer, assigned, done, split, agrees, missed, included }) => (
              <div key={reviewer.id} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_5.5rem] items-center gap-4 px-4 py-3 @max-2xl/overview:grid-cols-[minmax(0,1fr)_5.5rem] @max-2xl/overview:gap-y-2">
                <div className="flex min-w-0 items-center gap-3">
                  <ReviewerMark reviewer={reviewer} className="size-8 self-start" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium"><span className="truncate">{reviewer.name}</span>{reviewer.you ? <YouTag /> : null}</p>
                    {reviewer.kind === "model" ? (
                      <p className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground"><Coins className="size-3.5" />{(done * reviewer.credits!).toLocaleString()} credits</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{done === assigned ? "Done" : reviewer.here ? "Screening now" : "Last here yesterday"}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 @max-2xl/overview:col-span-2 @max-2xl/overview:row-start-2">
                  <Meter value={done} max={assigned} fill={done === assigned ? "bg-success" : "bg-primary"} />
                  <span className="w-20 shrink-0 text-end text-xs tabular-nums text-muted-foreground"><AnimatedNumber value={done} /> of {assigned}</span>
                </div>
                <TooltipHint label={`${split[0]} include, ${split[1]} maybe, ${split[2]} exclude`}>
                  <div tabIndex={0} className="flex h-2 gap-0.5 rounded-full @max-2xl/overview:hidden">
                    {DECISIONS.map((decision, i) => (split[i] ? <span key={decision} className={cn("h-full basis-0 rounded-full", RESULT_STYLE[decision].bar)} style={{ flexGrow: split[i] }} /> : null))}
                  </div>
                </TooltipHint>
                <div className="text-end @max-2xl/overview:col-start-2 @max-2xl/overview:row-start-1">
                  <p className="text-sm font-semibold tabular-nums">{agrees === null ? "" : `${Math.round(agrees * 100)}%`}</p>
                  {reviewer.kind === "model" && included ? <p className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">missed {missed} of {included}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </Zone>

        <Zone label="Agreement between reviewers" aside={<Chip>Cohen&apos;s kappa</Chip>}>
          <div className="overflow-x-auto rounded-2xl border border-border-subtle p-4">
            <div className="grid min-w-max items-center gap-1" style={{ gridTemplateColumns: `minmax(8rem, auto) repeat(${REVIEWERS.length}, minmax(2.75rem, 1fr))` }}>
              <span />
              {REVIEWERS.map((reviewer) => (
                <TooltipHint key={reviewer.id} label={reviewer.name}>
                  <span tabIndex={0} className="flex justify-center pb-1"><ReviewerMark reviewer={reviewer} /></span>
                </TooltipHint>
              ))}
              {REVIEWERS.map((a, row) => (
                <div key={a.id} className="contents">
                  <span className="flex min-w-0 items-center gap-2 pe-3 text-xs"><ReviewerMark reviewer={a} className="size-5" /><span className="truncate">{a.name}</span></span>
                  {REVIEWERS.map((b, column) => {
                    const pair = matrix[row]![column];
                    if (!pair) return <span key={b.id} className="h-11 rounded-lg bg-foreground/[0.03]" />;
                    return (
                      <TooltipHint key={b.id} label={`Same decision on ${Math.round(pair.same * 100)}% of the ${pair.papers} papers both read`}>
                        <span
                          tabIndex={0}
                          className="flex h-11 items-center justify-center rounded-lg text-xs font-medium tabular-nums"
                          // From 0.6, where agreement is called substantial, up to 1.
                          style={{ backgroundColor: `color-mix(in oklab, var(--success) ${Math.round(8 + Math.max(0, Math.min(1, (pair.kappa - 0.6) / 0.4)) * 52)}%, transparent)` }}
                        >
                          {pair.kappa.toFixed(2)}
                        </span>
                      </TooltipHint>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </Zone>
      </div>

      <Flow screening={screening} />
    </div>
  );
}

/** The counts from sources to included papers, left to right: what a flow diagram is drawn from. */
function Flow({ screening }: { screening: Screening }) {
  const abstract = STAGES.abstract;
  const kept = SOURCES.map((source) => ({ source, kept: count(abstract.papers, (paper) => paper.source === source.id) }));
  const found = kept.reduce((sum, one) => sum + one.kept + one.source.duplicates, 0);
  const duplicates = SOURCES.reduce((sum, source) => sum + source.duplicates, 0);
  // The flow always reads the first stage's results for its second column, whichever stage is open.
  const first = screening.stage === "abstract" ? screening : null;
  const excludedFor = CRITERIA.filter((c) => c.must).map((criterion) => ({
    criterion,
    papers: first ? count(first.papers, (paper) => first.settled[paper.id]!.final === "exclude" && Object.values(first.votes[paper.id] ?? {}).some((vote) => vote?.reason === criterion.key)) : 0,
  }));
  const fullText = STAGES.fullText.papers;
  const steps = [
    {
      title: "Found",
      total: found,
      rows: kept.map(({ source, kept: n }) => ({ label: source.name, value: n + source.duplicates })),
    },
    {
      title: "After duplicates",
      total: found - duplicates,
      rows: [{ label: "Duplicates merged", value: duplicates }],
    },
    {
      title: "Title and abstract",
      total: first ? first.counts.include : fullText.length,
      note: "included",
      rows: first
        ? [...excludedFor.map(({ criterion, papers }) => ({ label: `Excluded: ${criterion.short}`, value: papers })), { label: "Maybe", value: first.counts.maybe }, { label: "In conflict or waiting", value: first.counts.conflict + first.counts.waiting }]
        : [{ label: "Went on to full text", value: fullText.length }],
    },
    {
      title: "Full text",
      total: fullText.length,
      note: "to read",
      rows: [{ label: "PDF found", value: count(fullText, (paper) => paper.hasPdf) }, { label: "No full text yet", value: count(fullText, (paper) => !paper.hasPdf) }],
    },
  ];
  return (
    <Zone label="Flow" aside={<Chip>Drawn as a PRISMA diagram on export</Chip>}>
      <div className="grid grid-cols-1 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle @3xl/overview:grid-cols-4 @3xl/overview:divide-x @3xl/overview:divide-y-0">
        {steps.map((step, i) => (
          <div key={step.title} className="relative space-y-3 p-4">
            <p className="text-xs text-muted-foreground">{step.title}</p>
            <p className="flex items-baseline gap-2"><span className="text-2xl font-semibold tabular-nums tracking-tight"><AnimatedNumber value={step.total} /></span>{step.note ? <span className="text-xs text-muted-foreground">{step.note}</span> : null}</p>
            <ul className="space-y-2">
              {step.rows.map((row) => (
                <li key={row.label} className="space-y-1">
                  <p className="flex items-baseline justify-between gap-3 text-xs"><span className="truncate text-muted-foreground">{row.label}</span><span className="shrink-0 font-medium tabular-nums">{row.value}</span></p>
                  <Meter value={row.value} max={Math.max(found, 1)} fill="bg-foreground/25" className="h-1" />
                </li>
              ))}
            </ul>
            {i < steps.length - 1 ? <ArrowRight aria-hidden className="absolute -end-2 top-4 z-10 hidden size-4 rounded-full bg-card text-muted-foreground @3xl/overview:block" /> : null}
          </div>
        ))}
      </div>
    </Zone>
  );
}
