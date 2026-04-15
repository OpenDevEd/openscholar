"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PaperStatus =
  | "pending"
  | "parsing"
  | "extracting"
  | "completed"
  | "failed"
  | "cancelled";

interface StatusBadgeProps {
  status: PaperStatus;
  className?: string;
}

const statusConfig = {
  pending: {
    i18nKey: "progress.statusPending" as const,
    classes: "bg-muted border-border text-muted-foreground",
    pulse: false,
  },
  parsing: {
    i18nKey: "progress.statusParsing" as const,
    classes:
      "bg-[oklch(0.95_0.08_250/0.15)] border-[oklch(0.55_0.15_250/0.3)] text-[oklch(0.4_0.12_250)] dark:bg-[oklch(0.3_0.08_250/0.2)] dark:border-[oklch(0.55_0.15_250/0.3)] dark:text-[oklch(0.7_0.12_250)]",
    pulse: true,
  },
  extracting: {
    i18nKey: "progress.statusExtracting" as const,
    classes:
      "bg-[oklch(0.95_0.08_293/0.15)] border-[oklch(0.55_0.15_293/0.3)] text-[oklch(0.4_0.12_293)] dark:bg-[oklch(0.3_0.08_293/0.2)] dark:border-[oklch(0.55_0.15_293/0.3)] dark:text-[oklch(0.7_0.12_293)]",
    pulse: true,
  },
  completed: {
    i18nKey: "progress.statusCompleted" as const,
    classes:
      "bg-[oklch(0.95_0.08_145/0.15)] border-[oklch(0.55_0.15_145/0.3)] text-[oklch(0.4_0.12_145)] dark:bg-[oklch(0.3_0.08_145/0.2)] dark:border-[oklch(0.55_0.15_145/0.3)] dark:text-[oklch(0.7_0.12_145)]",
    pulse: false,
  },
  failed: {
    i18nKey: "progress.statusFailed" as const,
    classes:
      "bg-[oklch(0.95_0.06_27/0.15)] border-[oklch(0.6_0.15_27/0.3)] text-[oklch(0.5_0.15_27)] dark:bg-[oklch(0.3_0.08_27/0.2)] dark:border-[oklch(0.6_0.15_27/0.3)] dark:text-[oklch(0.7_0.12_27)]",
    pulse: false,
  },
  cancelled: {
    i18nKey: "progress.statusCancelled" as const,
    classes: "bg-muted border-border text-muted-foreground/50",
    pulse: false,
  },
} as const;

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const t = useTranslations("extraction");
  const config = statusConfig[status];

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-xs font-semibold gap-1",
        config.classes,
        config.pulse && "animate-pulse",
        className,
      )}
    >
      {t(config.i18nKey)}
    </Badge>
  );
}
