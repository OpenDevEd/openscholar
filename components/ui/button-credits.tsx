"use client";

import { useTranslations } from "next-intl";
import { Coins } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * What pressing an AI button costs, said at its end: a coin and the credits, as the overview's Write button says it.
 * Nothing where it costs no credits: the person pays with their own key, or the figure isn't known yet.
 */
export function ButtonCredits({ credits, className }: { credits: number | undefined; className?: string }) {
  const t = useTranslations("common");
  if (!credits) return null;
  return (
    <span className={cn("flex items-center gap-1 text-xs font-normal text-muted-foreground tabular-nums", className)}>
      <Coins aria-hidden className="size-3.5" />
      {credits}
      <span className="sr-only">{t("credits")}</span>
    </span>
  );
}
