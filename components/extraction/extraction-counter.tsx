"use client";

import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Self-contained extraction basket counter with a 3-state progress bar.
 *
 * Reads its own data via Zustand selector (papers.size) and Convex query
 * (getExtractionLimit). Accepts only an optional className prop.
 *
 * Visual states (per 102-UI-SPEC.md):
 * - Default (ratio < 0.8): inherits bg-primary on indicator
 * - Warning (0.8 <= ratio < 1.0): amber indicator + amber text
 * - Full (ratio >= 1.0): destructive indicator + destructive text
 */
export function ExtractionCounter({ className }: { className?: string }) {
  const t = useTranslations("extraction.counter");
  const count = useExtractionBasketStore((s) => s.papers.size);
  const limitData = useProtectedQuery(
    api.extraction.queries.getExtractionLimit,
    {},
  );
  const limit = limitData.data?.limit ?? 1000;
  const ratio = limit > 0 ? count / limit : 0;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{t("label", { count, limit })}</span>
        {ratio >= 1 && (
          <span className="text-xs text-destructive font-medium">
            {t("limitReached")}
          </span>
        )}
        {ratio >= 0.8 && ratio < 1 && (
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            {t("limitWarning")}
          </span>
        )}
      </div>
      <Progress
        value={Math.min(ratio * 100, 100)}
        className={cn(
          "h-2",
          ratio >= 1 &&
            "[&>[data-slot=progress-indicator]]:bg-destructive",
          ratio >= 0.8 &&
            ratio < 1 &&
            "[&>[data-slot=progress-indicator]]:bg-amber-500 dark:[&>[data-slot=progress-indicator]]:bg-amber-400",
        )}
      />
    </div>
  );
}
