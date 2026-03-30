"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Loader2, BarChart3, MessageSquareWarning } from "lucide-react";
import { DisagreementList } from "@/components/extraction/disagreement-list";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useTranslations } from "next-intl";
import { BarVisualization } from "@/components/extraction/bar-visualization";
import { buildSynonymMap, groupAnswersBySynonym, mergeDisagreementClusters } from "@/lib/extraction/answer-grouping";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import {
  pct,
  CONFIDENCE_BAR_COLORS,
  CITATION_BAR_COLORS,
} from "@/lib/extraction/card-thresholds";
import { cardEntrance, cardEntranceTransition } from "@/lib/animation-config";

interface InsightsQuestionPanelProps {
  jobId: Id<"extractionJobs">;
  questionKey?: string;
  onJumpToPaper?: (paperId: string) => void;
  enabled?: boolean;
}

function MiniBar({ value, color, label }: { value: number; color?: string; label: string }) {
  const pctValue = Math.max(2, Math.round(value * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-1.5 w-full rounded-full bg-muted/60 dark:bg-muted/30 overflow-hidden"
    >
      <div className={`h-full rounded-full transition-all ${color || "bg-primary"}`} style={{ width: `${pctValue}%` }} />
    </div>
  );
}

export function InsightsQuestionPanel({
  jobId,
  questionKey,
  onJumpToPaper,
  enabled = true,
}: InsightsQuestionPanelProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t: any = useTranslations("extraction");
  const tc = useTranslations("common");
  const pdfEnabled = useFeatureFlag("extraction.pdf");
  const questionInsightsQuery = useProtectedQuery(
    api.extraction.queries.getQuestionInsights,
    enabled && questionKey ? { jobId, questionKey } : "skip",
  );
  const disagreementQuery = useProtectedQuery(
    api.extraction.queries.getQuestionDisagreements,
    enabled && questionKey ? { jobId, questionKey } : "skip",
  );
  const questionInsights = questionInsightsQuery.data;
  const disagreementData = disagreementQuery.data;
  const [arrayView, setArrayView] = useState<"entities" | "raw">("entities");

  if (!enabled) return null;

  if (!questionKey) {
    return (
      <div className="rounded-xl border border-border/50 bg-muted/10 dark:bg-muted/5 p-8 text-center">
        <p className="text-sm text-muted-foreground">{t("selectQuestionToInspect")}</p>
      </div>
    );
  }

  if (questionInsightsQuery.isDeferred || disagreementQuery.isDeferred || questionInsights === undefined || disagreementData === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!questionInsights || questionInsights.status !== "ok") {
    const message =
      questionInsights?.status === "not_found" ? t("questionInsightsUnavailable")
        : questionInsights?.status === "unauthenticated" ? t("signInToViewQuestionInsights")
        : questionInsights?.status === "no_access" ? t("noAccessQuestionInsights")
        : t("questionInsightsGenericUnavailable");
    return (
      <div className="rounded-xl border border-border/50 bg-muted/10 dark:bg-muted/5 p-6 text-sm text-muted-foreground">{message}</div>
    );
  }

  const total = Math.max(questionInsights.total, 1);
  const rawAnswerDistribution = questionInsights.rawAnswerDistribution || questionInsights.topAnswers || [];
  const entityDistribution = questionInsights.entityDistribution || [];
  const isArrayMode = questionInsights.insightMode === "array";
  const effectiveArrayView = isArrayMode ? arrayView : "raw";
  const synonymMap = buildSynonymMap();
  const disagreementTitle = disagreementData?.status === "ok" && disagreementData.viewMode === "answer_profiles" ? t("answerProfiles") : t("disagreementFinder");

  // Pre-compute answer distribution data (avoid IIFEs in JSX)
  const entityBarData = entityDistribution.map((entity) => {
    const groundedCount = Math.round(entity.count * (entity.groundedRate || 0));
    return {
      answer: entity.entity + (entity.generic ? ` ${t("genericSuffix")}` : ""),
      count: entity.count,
      citationStatusMix: { grounded: groundedCount, best_effort: entity.count - groundedCount, insufficient_evidence: 0, extraction_error: 0 },
    };
  });
  const entityMaxCount = Math.max(...entityDistribution.map((e) => e.count), 1);

  const groupedAnswers = groupAnswersBySynonym(rawAnswerDistribution, synonymMap);
  const rawDisplayAnswers = groupedAnswers.map((group) => ({
    answer: group.groupRepresentative,
    count: group.count,
    citationStatusMix: group.citationStatusMix,
  }));
  const rawMaxCount = Math.max(...rawDisplayAnswers.map((a) => a.count), 1);

  const rawClusters = disagreementData?.status === "ok" ? disagreementData.clusters || [] : [];
  const mergedClusters = mergeDisagreementClusters(rawClusters, synonymMap);

  return (
    <div className="space-y-5">
      {/* Question Info Card */}
      <motion.div {...cardEntrance} transition={cardEntranceTransition(0)} className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 bg-transparent">
          <h3 className="text-lg font-semibold text-foreground tracking-tight leading-snug">{questionInsights.question.question}</h3>
          <p className="text-xs text-muted-foreground mt-1">{questionInsights.question.type} {t("questionSuffix")}</p>
        </div>

        <div className="px-5 py-4 flex flex-wrap gap-2">
          <Badge variant="outline" className="font-mono tabular-nums">{pct(questionInsights.answered / total)} {tc("answered").toLowerCase()}</Badge>
          {pdfEnabled && (
            <Badge variant="outline" className="font-mono tabular-nums">{pct(questionInsights.grounded / total)} {tc("grounded").toLowerCase()}</Badge>
          )}
          <Badge variant="secondary" className="font-mono tabular-nums" title={t("rawConfidenceTooltip", { confidence: t("confidence"), value: Math.round((questionInsights.avgConfidence || 0) * 100) })}>
            {Math.round((questionInsights.avgEffectiveConfidence ?? questionInsights.avgConfidence) * 100)}% {t("effectiveConf")}
          </Badge>
        </div>

        {/* Confidence & Citation Distribution */}
        <div className={`grid gap-px ${pdfEnabled ? "md:grid-cols-2" : "md:grid-cols-1"} border-t border-border/40 bg-border/30`}>
          <div className="bg-card p-5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">{t("confidenceDistribution")}</h4>
            <div className="space-y-3">
              {(["high", "medium", "low", "unknown"] as const).map((bucket) => {
                const count = questionInsights.confidenceBuckets[bucket];
                const bucketLabels: Record<string, string> = { high: tc("high"), medium: tc("medium"), low: tc("low"), unknown: tc("unknown") };
                return (
                  <div key={bucket} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground/80">{bucketLabels[bucket]}</span>
                      <span className="font-mono tabular-nums text-muted-foreground text-xs">{count}</span>
                    </div>
                    <MiniBar value={count / total} color={CONFIDENCE_BAR_COLORS[bucket]} label={`${bucketLabels[bucket]}: ${count}`} />
                  </div>
                );
              })}
            </div>
          </div>
          {pdfEnabled && (
            <div className="bg-card p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">{t("citationStatusMix")}</h4>
              <div className="space-y-3">
                {(["grounded", "best_effort", "insufficient_evidence", "extraction_error"] as const).map((status) => {
                  const count = questionInsights.citationStatusMix[status];
                  const citationLabels: Record<string, string> = { grounded: tc("grounded"), best_effort: (tc as any)("bestEffort"), insufficient_evidence: (tc as any)("insufficientEvidence"), extraction_error: (tc as any)("extractionError") };
                  return (
                    <div key={status} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-foreground/80">{citationLabels[status]}</span>
                        <span className="font-mono tabular-nums text-muted-foreground text-xs">{count}</span>
                      </div>
                      <MiniBar value={count / total} color={CITATION_BAR_COLORS[status]} label={`${citationLabels[status]}: ${count}`} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Answer Distribution */}
      <motion.div {...cardEntrance} transition={cardEntranceTransition(0.08)} className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border/40 bg-transparent">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground tracking-tight">{isArrayMode && effectiveArrayView === "entities" ? t("topEntities") : t("answerDistribution")}</h3>
          </div>
          {isArrayMode ? (
            <div role="tablist" aria-label={t("answerDistribution")} className="flex items-center gap-1.5 rounded-lg bg-muted/40 dark:bg-muted/20 p-1">
              <button
                type="button"
                role="tab"
                aria-selected={effectiveArrayView === "entities"}
                className={`px-3 py-2 text-xs font-medium rounded-md transition-all ${effectiveArrayView === "entities" ? "bg-background dark:bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setArrayView("entities")}
              >
                {t("topEntities")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={effectiveArrayView === "raw"}
                className={`px-3 py-2 text-xs font-medium rounded-md transition-all ${effectiveArrayView === "raw" ? "bg-background dark:bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setArrayView("raw")}
              >
                {t("rawAnswers")}
              </button>
            </div>
          ) : null}
        </div>
        <div className="p-5">
          {isArrayMode && effectiveArrayView === "entities" ? (
            entityDistribution.length === 0
              ? <div className="text-sm text-muted-foreground text-center py-6">{t("noEntityValues")}</div>
              : <BarVisualization answers={entityBarData} maxCount={entityMaxCount} />
          ) : rawAnswerDistribution.length === 0
            ? <div className="text-sm text-muted-foreground text-center py-6">{t("noAnswerValues")}</div>
            : <BarVisualization answers={rawDisplayAnswers} maxCount={rawMaxCount} />
          }
        </div>
      </motion.div>

      {/* Disagreement / Answer Profiles */}
      <motion.div {...cardEntrance} transition={cardEntranceTransition(0.16)} className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/40 bg-transparent">
          <MessageSquareWarning className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground tracking-tight">{disagreementTitle}</h3>
        </div>
        <div className="p-5">
          <DisagreementList
            key={`${mergedClusters.length}-${disagreementData?.status === "ok" ? disagreementData.viewMode : ""}`}
            viewMode={disagreementData?.status === "ok" ? disagreementData.viewMode : undefined}
            suppressedSingletonCount={disagreementData?.status === "ok" ? disagreementData.suppressedSingletonCount || 0 : 0}
            clusters={mergedClusters}
            maxInitial={10}
            onJumpToExample={(paperId) => onJumpToPaper?.(paperId)}
          />
        </div>
      </motion.div>
    </div>
  );
}
