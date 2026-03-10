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

export interface ConfidenceBadgeProps {
  value: number; // 0–1
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
  const t = useTranslations("extraction");
  const color = getConfidenceColor(value);
  const tooltipKey = getConfidenceTooltipKey(abstractOnlyCount, noContentCount, totalPapers);
  const colorClasses = BADGE_COLOR_CLASSES[color];
  const percentage = Math.round(value * 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          className={`${colorClasses} cursor-help inline-flex items-center gap-1.5 border px-2.5 py-1`}
        >
          <span className="text-sm font-semibold">{percentage}%</span>
          <HelpCircle className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
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
