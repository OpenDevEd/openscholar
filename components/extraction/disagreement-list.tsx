"use client";

import { useEffect, useMemo, useState } from "react";
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
  const t = useTranslations("extraction");
  const [visibleCount, setVisibleCount] = useState(() => maxInitial);
  const [expandedAnswers, setExpandedAnswers] = useState<Record<string, boolean>>({});

  const visibleClusters = useMemo(
    () => clusters.slice(0, visibleCount),
    [clusters, visibleCount]
  );

  const isAnswerProfiles = viewMode === "answer_profiles";
  if (viewMode === "disagreement" && clusters.length <= 1) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
        {t("noDisagreementClusters")}
      </div>
    );
  }

  if (isAnswerProfiles && clusters.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
        {t("noAnswerProfiles")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {suppressedSingletonCount > 0 ? (
        <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {t("suppressedSingletonProfiles", { count: suppressedSingletonCount })}
        </div>
      ) : null}

      {visibleClusters.map((cluster, index) => {
        const key = `${cluster.normalizedAnswer}-${index}`;
        const isExpanded = Boolean(expandedAnswers[key]);
        const longAnswer = cluster.displayAnswer.length > 160;
        return (
          <div
            key={key}
            className="rounded-lg border border-border/50 bg-card p-4 space-y-3"
          >
            <div className="space-y-2">
              <div className="rounded border border-border/40 bg-muted/20 px-3 py-2 text-xs">
                <span className="break-words">
                  {isExpanded ? cluster.displayAnswer : truncateText(cluster.displayAnswer)}
                </span>
                {longAnswer ? (
                  <button
                    type="button"
                    className="ml-2 underline text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setExpandedAnswers((prev) => ({
                        ...prev,
                        [key]: !isExpanded,
                      }))
                    }
                  >
                    {isExpanded ? t("disagreementShowLess") : t("disagreementShowFull")}
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t("disagreementPapers", { count: cluster.count })}</Badge>
                <Badge variant="outline">
                  {t("disagreementAvgConfidence", { percent: Math.round(cluster.avgConfidence * 100) })}
                </Badge>
              </div>
            </div>

            <div className="space-y-2">
              {cluster.examples.slice(0, 3).map((example) => (
                <div
                  key={`${cluster.normalizedAnswer}-${example.paperId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/40 bg-muted/20 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{example.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("disagreementAnswer")}{" "}
                      {Array.isArray(example.answer)
                        ? example.answer.join("; ")
                        : String(example.answer)}
                    </div>
                  </div>
                  {onJumpToExample ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onJumpToExample(example.paperId)}
                    >
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
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((prev) => prev + maxInitial)}
          >
            {t("disagreementShowMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
