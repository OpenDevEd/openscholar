"use client";

import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BADGE_COLOR_CLASSES, getConfidenceColor } from "@/lib/extraction/card-thresholds";
import { getConfidenceTooltipKey } from "@/lib/extraction/confidence-messages";
import { useFeatureFlag } from "@/lib/feature-flags/hook";

export interface ConfidenceBadgeProps {
  value: number;
  abstractOnlyCount: number;
  noContentCount: number;
  totalPapers: number;
}

export function ConfidenceBadge({
  value,
  abstractOnlyCount,
  noContentCount,
  totalPapers,
}: ConfidenceBadgeProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t: any = useTranslations("extraction");
  const pdfEnabled = useFeatureFlag("extraction.pdf");
  const color = getConfidenceColor(value);
  const tooltipKey = getConfidenceTooltipKey(abstractOnlyCount, noContentCount, totalPapers, pdfEnabled);
  const colorClasses = BADGE_COLOR_CLASSES[color];
  const percentage = Math.round(value * 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          tabIndex={0}
          className={`${colorClasses} cursor-help inline-flex items-center gap-1.5 border px-3 py-1.5 rounded-lg`}
        >
          <span className="text-sm font-bold tabular-nums">{percentage}%</span>
          <HelpCircle className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
          <span className="sr-only">
            {tooltipKey === "confidenceAbstractOnly"
              ? `${t("confidenceAbstractOnly")}. ${t("confidenceCapExplained")}`
              : tooltipKey === "confidenceNoContent"
                ? t("confidenceNoContent")
                : t("confidenceCapExplained")}
          </span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {tooltipKey === "confidenceAbstractOnly" ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("confidenceAbstractOnly")}</p>
            <p className="text-xs text-muted-foreground">{t("confidenceCapExplained")}</p>
          </div>
        ) : tooltipKey === "confidenceNoContent" ? (
          <p className="text-sm font-medium">{t("confidenceNoContent")}</p>
        ) : (
          <p className="text-sm">{t("confidenceCapExplained")}</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
