"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

type DisagreementCluster = {
  normalizedAnswer: string;
  displayAnswer: string;
  count: number;
  avgConfidence: number;
  examples: Array<{
    paperId: string;
    title: string;
    openalexId: string;
    answer: string | boolean | number | string[] | null | undefined;
    confidence?: number;
  }>;
};

interface DisagreementListProps {
  clusters: DisagreementCluster[];
  viewMode?: "disagreement" | "answer_profiles";
  suppressedSingletonCount?: number;
  maxInitial?: number;
  onJumpToExample?: (paperId: string) => void;
}

function truncateText(value: string, limit = 160) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
}

export function DisagreementList({
  clusters,
  viewMode = "disagreement",
  suppressedSingletonCount = 0,
  maxInitial = 10,
  onJumpToExample,
}: DisagreementListProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t: any = useTranslations("extraction");
  const [visibleCount, setVisibleCount] = useState(() => maxInitial);
  const [expandedAnswers, setExpandedAnswers] = useState<Record<string, boolean>>({});

  const visibleClusters = useMemo(
    () => clusters.slice(0, visibleCount),
    [clusters, visibleCount]
  );

  const isAnswerProfiles = viewMode === "answer_profiles";
  if (viewMode === "disagreement" && clusters.length <= 1) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/10 dark:bg-muted/5 p-5 text-sm text-muted-foreground text-center">
        {t("noDisagreementClusters")}
      </div>
    );
  }

  if (isAnswerProfiles && clusters.length === 0) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/10 dark:bg-muted/5 p-5 text-sm text-muted-foreground text-center">
        {t("noAnswerProfiles")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {suppressedSingletonCount > 0 ? (
        <div className="rounded-lg border border-border/40 bg-muted/10 dark:bg-muted/5 px-4 py-2.5 text-xs text-muted-foreground">
          {t("suppressedSingletonProfiles", { count: suppressedSingletonCount })}
        </div>
      ) : null}

      {visibleClusters.map((cluster, index) => {
        const key = `${cluster.normalizedAnswer}-${index}`;
        const isExpanded = Boolean(expandedAnswers[key]);
        const longAnswer = cluster.displayAnswer.length > 160;
        return (
          <div key={key} className="rounded-xl border border-border/50 bg-card p-5 space-y-4 shadow-sm">
            <div className="space-y-3">
              <div className="text-sm leading-relaxed">
                <span className="break-words text-foreground/90">
                  {isExpanded ? cluster.displayAnswer : truncateText(cluster.displayAnswer)}
                </span>
                {longAnswer ? (
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    className="ml-2 text-xs text-primary hover:text-primary/80 font-medium transition-colors px-1 py-1 -my-1 rounded"
                    onClick={() => setExpandedAnswers((prev) => ({ ...prev, [key]: !isExpanded }))}
                  >
                    {isExpanded ? t("disagreementShowLess") : t("disagreementShowFull")}
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-medium">{t("disagreementPapers", { count: cluster.count })}</Badge>
                <Badge variant="outline" className="font-mono tabular-nums">{t("disagreementAvgConfidence", { percent: Math.round(cluster.avgConfidence * 100) })}</Badge>
              </div>
            </div>

            <div className="divide-y divide-border/30">
              {cluster.examples.slice(0, 3).map((example) => (
                <div
                  key={`${cluster.normalizedAnswer}-${example.paperId}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-sm transition-colors hover:bg-muted/20 dark:hover:bg-muted/10"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground truncate">{example.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t("disagreementAnswer")}{" "}
                      <span className="text-foreground/70">
                        {Array.isArray(example.answer) ? example.answer.join("; ") : String(example.answer)}
                      </span>
                    </div>
                  </div>
                  {onJumpToExample ? (
                    <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onJumpToExample(example.paperId)}>
                      {t("disagreementOpenPaper")}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {clusters.length > visibleCount ? (
        <div className="flex justify-center pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setVisibleCount((prev) => prev + maxInitial)}>
            {t("disagreementShowMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
