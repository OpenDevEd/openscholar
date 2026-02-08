"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface InsightsOverviewProps {
  jobId: string;
  selectedQuestionKey?: string;
  onSelectQuestion: (questionKey: string) => void;
  onRerun?: () => void;
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function InsightsOverview({
  jobId,
  selectedQuestionKey,
  onSelectQuestion,
  onRerun,
}: InsightsOverviewProps) {
  const insights = useQuery(api.extraction.queries.getJobInsights, {
    jobId: jobId as any,
  });

  if (insights === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
        Insights are unavailable for this job.
      </div>
    );
  }

  const { summary, questions, diagnostics } = insights;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">Answered</div>
          <div className="text-xl font-semibold">{pct(summary.answeredRate)}</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">Grounded</div>
          <div className="text-xl font-semibold">{pct(summary.groundedRate)}</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">Best effort</div>
          <div className="text-xl font-semibold">{pct(summary.bestEffortRate)}</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">No-content papers</div>
          <div className="text-xl font-semibold">{summary.noContentCount}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium">No-content diagnostics</div>
            <div className="text-xs text-muted-foreground">
              Papers with no usable PDF and no abstract: {summary.noContentCount}
            </div>
          </div>
          {onRerun ? (
            <Button type="button" size="sm" variant="outline" onClick={onRerun}>
              Re-run with source changes
            </Button>
          ) : null}
        </div>
        {diagnostics?.noContentPapers?.length > 0 ? (
          <div className="space-y-2">
            {diagnostics.noContentPapers.slice(0, 3).map((paper: any) => (
              <div
                key={paper.paperId}
                className="rounded border border-border/40 bg-muted/20 px-3 py-2 text-xs"
              >
                <div className="font-medium">{paper.title}</div>
                <div className="text-muted-foreground">{paper.reason}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border/50 bg-card">
        <div className="border-b border-border/50 px-4 py-3 text-sm font-medium">
          Question-level insights
        </div>
        <div className="divide-y divide-border/40">
          {questions.map((question: any) => (
            <button
              key={question.key}
              className={`w-full px-4 py-3 text-left hover:bg-muted/20 transition-colors ${
                selectedQuestionKey === question.key ? "bg-primary/5" : ""
              }`}
              onClick={() => onSelectQuestion(question.key)}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{question.question}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{pct(question.answered / Math.max(question.total, 1))} answered</Badge>
                  <Badge variant="outline">{pct(question.grounded / Math.max(question.total, 1))} grounded</Badge>
                  <Badge variant="secondary">{Math.round(question.avgConfidence * 100)}% avg conf</Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
