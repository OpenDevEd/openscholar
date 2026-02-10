"use client";

import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { DisagreementList } from "@/components/extraction/disagreement-list";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

interface InsightsQuestionPanelProps {
  jobId: string;
  questionKey?: string;
  onJumpToPaper?: (paperId: string) => void;
  enabled?: boolean;
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function Bar({ value }: { value: number }) {
  const width = Math.max(2, Math.round(value * 100));
  return (
    <div className="h-2 w-full rounded bg-muted">
      <div className="h-2 rounded bg-primary" style={{ width: `${width}%` }} />
    </div>
  );
}

export function InsightsQuestionPanel({
  jobId,
  questionKey,
  onJumpToPaper,
  enabled = true,
}: InsightsQuestionPanelProps) {
  const [arrayView, setArrayView] = useState<"entities" | "raw">("entities");
  const questionInsightsQuery = useProtectedQuery(
    api.extraction.queries.getQuestionInsights,
    enabled && questionKey ? ({ jobId: jobId as any, questionKey } as any) : "skip",
  );
  const disagreementQuery = useProtectedQuery(
    api.extraction.queries.getQuestionDisagreements,
    enabled && questionKey ? ({ jobId: jobId as any, questionKey } as any) : "skip",
  );
  const questionInsights = questionInsightsQuery.data;
  const disagreementData = disagreementQuery.data;

  if (!enabled) return null;

  useEffect(() => {
    if (questionInsights?.status !== "ok") {
      setArrayView("raw");
      return;
    }
    if (questionInsights.insightMode === "array") {
      setArrayView("entities");
    } else {
      setArrayView("raw");
    }
  }, [questionInsights, questionKey]);

  if (!questionKey) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
        Select a question to inspect answer distributions and disagreements.
      </div>
    );
  }

  if (
    questionInsightsQuery.isDeferred ||
    disagreementQuery.isDeferred ||
    questionInsights === undefined ||
    disagreementData === undefined
  ) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!questionInsights || questionInsights.status !== "ok") {
    const message =
      questionInsights?.status === "not_found"
        ? "Question insights are not available for that question."
        : questionInsights?.status === "unauthenticated"
          ? "Sign in to view question insights."
          : questionInsights?.status === "no_access"
            ? "You do not have access to these question insights."
            : "Question insights are unavailable.";
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
        {message}
      </div>
    );
  }

  const total = Math.max(questionInsights.total, 1);
  const rawAnswerDistribution =
    questionInsights.rawAnswerDistribution || questionInsights.topAnswers || [];
  const entityDistribution = questionInsights.entityDistribution || [];
  const isArrayMode = questionInsights.insightMode === "array";
  const disagreementTitle =
    disagreementData?.status === "ok" && disagreementData.viewMode === "answer_profiles"
      ? "Answer profiles"
      : "Disagreement finder";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium">{questionInsights.question.question}</div>
            <div className="text-xs text-muted-foreground">
              {questionInsights.question.type} question
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">
              {pct(questionInsights.answered / total)} answered
            </Badge>
            <Badge variant="outline">
              {pct(questionInsights.grounded / total)} grounded
            </Badge>
            <Badge
              variant="secondary"
              title={`Raw confidence: ${Math.round(
                (questionInsights.avgConfidence || 0) * 100
              )}%`}
            >
              {Math.round(
                (questionInsights.avgEffectiveConfidence ?? questionInsights.avgConfidence) *
                  100
              )}
              % effective conf
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded border border-border/40 p-3">
            <div className="text-xs font-medium mb-2">Confidence distribution</div>
            <div className="space-y-2 text-xs">
              {(["high", "medium", "low", "unknown"] as const).map((bucket) => {
                const count = questionInsights.confidenceBuckets[bucket];
                return (
                  <div key={bucket} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="capitalize">{bucket}</span>
                      <span>{count}</span>
                    </div>
                    <Bar value={count / total} />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded border border-border/40 p-3">
            <div className="text-xs font-medium mb-2">Citation status mix</div>
            <div className="space-y-2 text-xs">
              {(
                [
                  "grounded",
                  "best_effort",
                  "insufficient_evidence",
                  "extraction_error",
                ] as const
              ).map((status) => {
                const count = questionInsights.citationStatusMix[status];
                return (
                  <div key={status} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span>{status.replace("_", " ")}</span>
                      <span>{count}</span>
                    </div>
                    <Bar value={count / total} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium">
            {isArrayMode && arrayView === "entities"
              ? "Top entities"
              : "Answer distribution"}
          </div>
          {isArrayMode ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={arrayView === "entities" ? "default" : "outline"}
                onClick={() => setArrayView("entities")}
              >
                Top entities
              </Button>
              <Button
                type="button"
                size="sm"
                variant={arrayView === "raw" ? "default" : "outline"}
                onClick={() => setArrayView("raw")}
              >
                Raw answers
              </Button>
            </div>
          ) : null}
        </div>

        {isArrayMode && arrayView === "entities" ? (
          entityDistribution.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No entity-level values are available for this question yet.
            </div>
          ) : (
            <div className="space-y-3">
              {entityDistribution.map((entity: any) => (
                <div key={entity.entity} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">
                      {entity.entity}
                      {entity.generic ? " (generic)" : ""}
                    </span>
                    <span className="text-muted-foreground">{entity.count}</span>
                  </div>
                  <Bar value={entity.count / total} />
                  <div className="text-[11px] text-muted-foreground">
                    grounded {pct(entity.groundedRate || 0)} · avg conf{" "}
                    {Math.round((entity.avgConfidence || 0) * 100)}%
                  </div>
                </div>
              ))}
            </div>
          )
        ) : rawAnswerDistribution.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No answer values available for this question yet.
          </div>
        ) : (
          <div className="space-y-3">
            {rawAnswerDistribution.map((answer: any) => (
              <div key={answer.normalized} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{answer.display}</span>
                  <span className="text-muted-foreground">{answer.count}</span>
                </div>
                <Bar value={answer.count / total} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
        <div className="text-sm font-medium">{disagreementTitle}</div>
        <DisagreementList
          viewMode={disagreementData?.status === "ok" ? disagreementData.viewMode : undefined}
          suppressedSingletonCount={
            disagreementData?.status === "ok" ? disagreementData.suppressedSingletonCount || 0 : 0
          }
          clusters={disagreementData?.status === "ok" ? disagreementData.clusters || [] : []}
          maxInitial={10}
          onJumpToExample={(paperId) => onJumpToPaper?.(paperId)}
        />
      </div>
    </div>
  );
}
