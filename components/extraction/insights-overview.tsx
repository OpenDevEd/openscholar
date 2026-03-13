"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useTranslations } from "next-intl";
import { SummaryCards } from "./summary-cards";
import { QuestionListItem } from "./question-list-item";
import { extractionFeatureFlags } from "@/lib/extraction/feature-flags";
import { cardEntrance, cardEntranceTransition } from "@/lib/animation-config";

interface InsightsOverviewProps {
  jobId: Id<"extractionJobs">;
  selectedQuestionKey?: string;
  onSelectQuestion: (questionKey: string) => void;
  onRerun?: () => void;
  enabled?: boolean;
}

export function InsightsOverview({
  jobId,
  selectedQuestionKey,
  onSelectQuestion,
  onRerun,
  enabled = true,
}: InsightsOverviewProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t: any = useTranslations("extraction");
  const insightsQuery = useProtectedQuery(
    api.extraction.queries.getJobInsights,
    enabled ? { jobId } : "skip",
  );
  const insights = insightsQuery.data;

  if (!enabled) return null;

  if (insightsQuery.isDeferred || insights === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
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
      <div className="rounded-xl border border-border/50 bg-muted/10 dark:bg-muted/5 p-6 text-sm text-muted-foreground">
        {message}
      </div>
    );
  }

  const { summary, questions, diagnostics } = insights;

  return (
    <div className="space-y-6">
      <SummaryCards
        answeredRate={summary.answeredRate}
        groundedRate={summary.groundedRate}
        bestEffortRate={summary.bestEffortRate}
        averageConfidence={summary.averageConfidence}
        noContentCount={summary.noContentCount}
        abstractOnlyCount={summary.abstractOnlyCount}
        totalPapers={questions.length > 0 ? questions[0].total : summary.noContentCount + summary.abstractOnlyCount}
      />

      {extractionFeatureFlags.pdf && (
        <motion.div
          {...cardEntrance}
          transition={cardEntranceTransition(0.1)}
          className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden"
        >
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/40">
            <div>
              <h3 className="text-sm font-semibold text-foreground tracking-tight">{t("noContentDiagnostics")}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{t("noContentDiagnosticsDescription")}{summary.noContentCount}</p>
            </div>
            {onRerun ? (
              <Button type="button" size="sm" variant="outline" onClick={onRerun}>{t("reRunWithSourceChanges")}</Button>
            ) : null}
          </div>
          {diagnostics?.noContentPapers?.length > 0 ? (
            <div className="p-4 space-y-2">
              {diagnostics.noContentPapers.slice(0, 3).map((paper) => (
                <div key={paper.paperId} className="rounded-lg border border-border/40 bg-muted/10 dark:bg-muted/5 px-4 py-3">
                  <div className="text-sm font-medium text-foreground">{paper.title}</div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {paper.reason}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </motion.div>
      )}

      <motion.div
        {...cardEntrance}
        transition={cardEntranceTransition(0.15)}
        className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-border/40">
          <h3 className="text-sm font-semibold text-foreground tracking-tight">{t("questionLevelInsights")}</h3>
        </div>
        <div className="divide-y divide-border/30">
          {questions.map((question, idx) => (
            <motion.div
              key={question.key}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={cardEntranceTransition(0.2 + idx * 0.04)}
            >
              <QuestionListItem
                questionKey={question.key}
                question={question.question}
                answered={question.answered}
                total={question.total}
                isSelected={selectedQuestionKey === question.key}
                onClick={() => onSelectQuestion(question.key)}
              />
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
