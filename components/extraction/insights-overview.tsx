"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useTranslations } from "next-intl";

interface InsightsOverviewProps {
  jobId: Id<"extractionJobs">;
  selectedQuestionKey?: string;
  onSelectQuestion: (questionKey: string) => void;
  onRerun?: () => void;
  enabled?: boolean;
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function InsightsOverview({
  jobId,
  selectedQuestionKey,
  onSelectQuestion,
  onRerun,
  enabled = true,
}: InsightsOverviewProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const insightsQuery = useProtectedQuery(
    api.extraction.queries.getJobInsights,
    enabled ? { jobId } : "skip",
  );
  const insights = insightsQuery.data;

  if (!enabled) return null;

  if (insightsQuery.isDeferred || insights === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!insights || insights.status !== "ok") {
    const message =
      insights?.status === "unauthenticated"
        ? t("signInToViewInsights")
        : insights?.status === "no_access"
          ? t("noAccessInsights")
          : t("insightsUnavailable");
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
        {message}
      </div>
    );
  }

  const { summary, questions, diagnostics } = insights;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">{tc("answered")}</div>
          <div className="text-xl font-semibold">{pct(summary.answeredRate)}</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">{tc("grounded")}</div>
          <div className="text-xl font-semibold">{pct(summary.groundedRate)}</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">{tc("bestEffort")}</div>
          <div className="text-xl font-semibold">{pct(summary.bestEffortRate)}</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">{tc("noContentPapers")}</div>
          <div className="text-xl font-semibold">{summary.noContentCount}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium">{t("noContentDiagnostics")}</div>
            <div className="text-xs text-muted-foreground">
              {t("noContentDiagnosticsDescription")}{summary.noContentCount}
            </div>
          </div>
          {onRerun ? (
            <Button type="button" size="sm" variant="outline" onClick={onRerun}>
              {t("reRunWithSourceChanges")}
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
          {t("questionLevelInsights")}
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
                  <Badge variant="outline">{pct(question.answered / Math.max(question.total, 1))} {tc("answered").toLowerCase()}</Badge>
                  <Badge variant="outline">{pct(question.grounded / Math.max(question.total, 1))} {tc("grounded").toLowerCase()}</Badge>
                  <Badge variant="secondary">{Math.round(question.avgConfidence * 100)}% {t("avgConf")}</Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
