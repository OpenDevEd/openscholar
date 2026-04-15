"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type CriticVerdict = "supported" | "unsupported" | "partial" | "timeout";

interface CriticVerdictBadgeProps {
  verdict: CriticVerdict | null | undefined;
  reason?: string;
  className?: string;
}

const verdictConfig = {
  supported: {
    i18nKey: "criticVerified" as const,
    classes: "ai-surface",
  },
  unsupported: {
    i18nKey: "criticUnverified" as const,
    classes:
      "bg-[oklch(0.95_0.06_27/0.15)] border-[oklch(0.6_0.15_27/0.3)] text-[oklch(0.5_0.15_27)] dark:bg-[oklch(0.3_0.08_27/0.2)] dark:border-[oklch(0.6_0.15_27/0.3)] dark:text-[oklch(0.7_0.12_27)]",
  },
  partial: {
    i18nKey: "criticPartial" as const,
    classes:
      "bg-[oklch(0.95_0.06_85/0.15)] border-[oklch(0.6_0.1_85/0.3)] text-[oklch(0.5_0.08_85)] dark:bg-[oklch(0.3_0.08_85/0.2)] dark:border-[oklch(0.6_0.1_85/0.3)] dark:text-[oklch(0.7_0.08_85)]",
  },
  timeout: {
    i18nKey: "criticTimeout" as const,
    classes: "bg-muted border-border text-muted-foreground",
  },
} as const;

export function CriticVerdictBadge({
  verdict,
  reason,
  className,
}: CriticVerdictBadgeProps) {
  const t = useTranslations("extraction");

  // Don't render if no verdict
  if (!verdict) return null;

  const config = verdictConfig[verdict];
  if (!config) return null;

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-xs font-semibold",
        config.classes,
        className,
      )}
    >
      {t(config.i18nKey)}
    </Badge>
  );

  // Wrap in tooltip if reason is available
  if (reason) {
    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs text-sm">{reason}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return badge;
}
