"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export interface RetrySummaryProps {
  jobId: Id<"extractionJobs">;
  /**
   * When true, uses the PDF-tier per-question cost constants for the
   * preflight estimate. Mirrors `extractionJobs.usePdfs`. Used by the
   * confirm dialog (plan-05 B5) — not read here yet.
   */
  usePdfs?: boolean;
}

/**
 * Plan-05 retry summary banner.
 *
 * Reads the per-job retry classification (plan 05 B1) and renders:
 *   - "N retryable · M permanent" counts (exposed as data-retryable-count
 *     + data-permanent-count for behavior tests).
 *   - A primary "Retry N failed" button when `retryableCount > 0`.
 *   - Hidden entirely when both counts are zero (nothing to show).
 *
 * Button click currently fires `retryFailedQuestions` directly;
 * plan-05 B5 wraps this in a confirm dialog that reuses plan-03's
 * `<ExtractionPreflightBanner>` for the estimate.
 *
 * Permanent failures are rendered by a sibling callout (plan-05 B6),
 * intentionally not folded into this component so it stays focused on
 * the retryable CTA.
 */
export function RetrySummary({ jobId }: RetrySummaryProps) {
  const t = useTranslations("extraction.retry");
  const { data: summary } = useProtectedQuery(
    api.extraction.queries.retry.getRetryableSummary,
    { jobId },
  );
  const retryFailed = useMutation(
    api.extraction.mutations.retryFailedQuestions,
  );
  const [submitting, setSubmitting] = useState(false);

  if (!summary) return null;
  const { retryableCount, permanentCount } = summary;
  if (retryableCount === 0 && permanentCount === 0) return null;

  const handleRetry = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await retryFailed({ jobId });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="status"
      data-retryable-count={retryableCount}
      data-permanent-count={permanentCount}
      className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-xs"
    >
      <span className="tabular-nums">
        {retryableCount > 0 && permanentCount > 0
          ? t("summary.both", {
              retryable: retryableCount,
              permanent: permanentCount,
            })
          : retryableCount > 0
            ? t("summary.retryableOnly", { retryable: retryableCount })
            : t("summary.permanentOnly", { permanent: permanentCount })}
      </span>
      {retryableCount > 0 && (
        <Button
          size="sm"
          onClick={handleRetry}
          disabled={submitting}
          data-action="retry"
        >
          <RotateCw
            className={`h-3.5 w-3.5 ${submitting ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {t("retryButton", { count: retryableCount })}
        </Button>
      )}
    </div>
  );
}
