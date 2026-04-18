"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import {
  getCardColor,
  BORDER_COLOR_CLASSES,
  CARD_TINT_CLASSES,
  ICON_COLOR_CLASSES,
  pct,
} from "@/lib/extraction/card-thresholds";
import { cardEntrance, cardEntranceTransition } from "@/lib/animation-config";
import { ConfidenceBadge } from "@/components/extraction/confidence-badge";
import { CheckCircle2, ShieldCheck, AlertTriangle, FileX, Gauge } from "lucide-react";
import { useFeatureFlag } from "@/lib/feature-flags/hook";

export interface SummaryCardsProps {
  answeredRate: number;
  groundedRate: number;
  bestEffortRate: number;
  noContentCount: number;
  totalPapers: number;
  abstractOnlyCount: number;
  averageConfidence: number;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const te: any = useTranslations("extraction");

  const answeredColor = getCardColor("completion", answeredRate);
  const groundedColor = getCardColor("quality", groundedRate);
  const pdfEnabled = useFeatureFlag("extraction.pdf");

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <motion.div
        {...cardEntrance}
        transition={cardEntranceTransition(0)}
        data-card="answered"
        data-color-role={answeredColor}
        className={cn(
          "rounded-xl border border-border/60 p-5 shadow-sm motion-safe:transition-shadow hover:shadow-md",
          BORDER_COLOR_CLASSES[answeredColor],
          CARD_TINT_CLASSES[answeredColor],
        )}
      >
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 className={cn("h-5 w-5", ICON_COLOR_CLASSES[answeredColor])} />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {tc("answered")}
          </span>
        </div>
        <div className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
          {pct(answeredRate)}
        </div>
      </motion.div>

      {pdfEnabled && (
        <motion.div
          {...cardEntrance}
          transition={cardEntranceTransition(0.06)}
          data-card="grounded"
          data-color-role={groundedColor}
          className={cn(
            "rounded-xl border border-border/60 p-5 shadow-sm motion-safe:transition-shadow hover:shadow-md",
            BORDER_COLOR_CLASSES[groundedColor],
            CARD_TINT_CLASSES[groundedColor],
          )}
        >
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className={cn("h-5 w-5", ICON_COLOR_CLASSES[groundedColor])} />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {tc("grounded")}
            </span>
          </div>
          <div className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
            {pct(groundedRate)}
          </div>
        </motion.div>
      )}

      {pdfEnabled && bestEffortRate > 0 ? (
        <motion.div
          {...cardEntrance}
          transition={cardEntranceTransition(0.12)}
          data-card="bestEffort"
          data-color-role="yellow"
          className={cn(
            "rounded-xl border border-border/60 p-5 shadow-sm motion-safe:transition-shadow hover:shadow-md",
            BORDER_COLOR_CLASSES["yellow"],
            CARD_TINT_CLASSES["yellow"],
          )}
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className={cn("h-5 w-5", ICON_COLOR_CLASSES["yellow"])} />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {te("bestEffort")}
            </span>
          </div>
          <div className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
            {pct(bestEffortRate)}
          </div>
        </motion.div>
      ) : null}

      {pdfEnabled && noContentCount > 0 ? (
        <motion.div
          {...cardEntrance}
          transition={cardEntranceTransition(0.18)}
          data-card="noContent"
          data-color-role="red"
          className={cn(
            "rounded-xl border border-border/60 p-5 shadow-sm motion-safe:transition-shadow hover:shadow-md",
            BORDER_COLOR_CLASSES["red"],
            CARD_TINT_CLASSES["red"],
          )}
        >
          <div className="flex items-center gap-2 mb-2">
            <FileX className={cn("h-5 w-5", ICON_COLOR_CLASSES["red"])} />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {te("noContentPapers")}
            </span>
          </div>
          <div className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
            {noContentCount}
          </div>
        </motion.div>
      ) : null}

      <motion.div
        {...cardEntrance}
        transition={cardEntranceTransition(pdfEnabled ? 0.24 : 0.06)}
        className="rounded-xl border border-border/60 bg-card p-5 shadow-sm motion-safe:transition-shadow hover:shadow-md"
        data-testid="confidence-area"
      >
        <div className="flex items-center gap-2 mb-2">
          <Gauge className="h-5 w-5 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {te("confidence")}
          </span>
        </div>
        <div className="mt-1">
          <ConfidenceBadge
            value={averageConfidence}
            abstractOnlyCount={abstractOnlyCount}
            noContentCount={noContentCount}
            totalPapers={totalPapers}
          />
        </div>
      </motion.div>
    </div>
  );
}
