"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, AlertCircle, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ConfidenceBadgeProps {
  confidence: "high" | "medium" | "low";
  className?: string;
}

const confidenceConfig = {
  high: {
    i18nKey: "confidenceHigh" as const,
    icon: CheckCircle2,
    classes:
      "bg-[oklch(0.95_0.08_145/0.15)] border-[oklch(0.55_0.15_145/0.3)] text-[oklch(0.4_0.12_145)] dark:bg-[oklch(0.3_0.08_145/0.2)] dark:border-[oklch(0.55_0.15_145/0.3)] dark:text-[oklch(0.7_0.12_145)]",
  },
  medium: {
    i18nKey: "confidenceMedium" as const,
    icon: AlertCircle,
    classes:
      "bg-[oklch(0.95_0.08_85/0.15)] border-[oklch(0.6_0.12_85/0.3)] text-[oklch(0.45_0.1_85)] dark:bg-[oklch(0.3_0.08_85/0.2)] dark:border-[oklch(0.6_0.12_85/0.3)] dark:text-[oklch(0.7_0.1_85)]",
  },
  low: {
    i18nKey: "confidenceLow" as const,
    icon: MinusCircle,
    classes: "bg-muted border-border text-muted-foreground",
  },
} as const;

export function ConfidenceBadge({
  confidence,
  className,
}: ConfidenceBadgeProps) {
  const t = useTranslations("extraction");
  const config = confidenceConfig[confidence];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-xs font-semibold gap-1",
        config.classes,
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(config.i18nKey)}
    </Badge>
  );
}
