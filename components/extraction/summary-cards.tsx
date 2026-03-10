"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { getCardColor, BORDER_COLOR_CLASSES } from "@/lib/extraction/card-thresholds";
import { ConfidenceBadge } from "@/components/extraction/confidence-badge";

export interface SummaryCardsProps {
  answeredRate: number;
  groundedRate: number;
  bestEffortRate: number;
  noContentCount: number;
  totalPapers: number;
  abstractOnlyCount: number;
  averageConfidence: number;
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function SummaryCards({
  answeredRate,
  groundedRate,
  bestEffortRate,
  noContentCount,
  totalPapers,
  abstractOnlyCount,
  averageConfidence,
}: SummaryCardsProps) {
  const tc = useTranslations("common");
  const te = useTranslations("extraction");

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1. Answered card — always visible */}
      <div
        className={cn(
          "rounded-lg border border-border/50 bg-card p-4",
          BORDER_COLOR_CLASSES[getCardColor("completion", answeredRate)]
        )}
      >
        <div className="text-xs text-muted-foreground">{tc("answered")}</div>
        <div className="text-xl font-semibold">{pct(answeredRate)}</div>
      </div>

      {/* 2. Grounded card — always visible */}
      <div
        className={cn(
          "rounded-lg border border-border/50 bg-card p-4",
          BORDER_COLOR_CLASSES[getCardColor("quality", groundedRate)]
        )}
      >
        <div className="text-xs text-muted-foreground">{tc("grounded")}</div>
        <div className="text-xl font-semibold">{pct(groundedRate)}</div>
      </div>

      {/* 3. Best effort card — hidden when bestEffortRate=0 */}
      {bestEffortRate > 0 ? (
        <div
          className={cn(
            "rounded-lg border border-border/50 bg-card p-4",
            BORDER_COLOR_CLASSES["yellow"]
          )}
        >
          <div className="text-xs text-muted-foreground">{te("bestEffort")}</div>
          <div className="text-xl font-semibold">{pct(bestEffortRate)}</div>
        </div>
      ) : null}

      {/* 4. No content card — hidden when noContentCount=0 */}
      {noContentCount > 0 ? (
        <div
          className={cn(
            "rounded-lg border border-border/50 bg-card p-4",
            BORDER_COLOR_CLASSES["red"]
          )}
        >
          <div className="text-xs text-muted-foreground">{te("noContentPapers")}</div>
          <div className="text-xl font-semibold">{noContentCount}</div>
        </div>
      ) : null}

      {/* 5. Confidence badge area — always visible */}
      <div
        className="rounded-lg border border-border/50 bg-card p-4"
        data-testid="confidence-area"
      >
        <div className="text-xs text-muted-foreground">{te("confidence")}</div>
        <div className="mt-2">
          <ConfidenceBadge
            value={averageConfidence}
            abstractOnlyCount={abstractOnlyCount}
            noContentCount={noContentCount}
            totalPapers={totalPapers}
          />
        </div>
      </div>
    </div>
  );
}
