"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { summarizeRetryable } from "@/lib/extraction/retry-summary";
import { RetryConfirmDialog } from "@/components/extraction/retry-confirm-dialog";
import { PermanentFailuresCallout } from "@/components/extraction/permanent-failures-callout";

export interface RetrySummaryProps {
  jobId: Id<"extractionJobs">;
  /** Mirrors `extractionJobs.usePdfs`; drives the PDF-tier retry cost. */
  usePdfs?: boolean;
}

/**
 * Plan-05 retry summary banner.
 *
 * Reads the per-job retry classification (plan 05 B1) and renders:
 *   - "N retryable" and "M permanent" counts (exposed as data-retryable-count
 *     + data-permanent-count for behavior tests).
 *   - A primary "Retry N failed" button when `retryableCount > 0`.
 *   - A confirmation dialog on click (plan 05 B5) that reuses plan 03's
 *     `<ExtractionPreflightBanner>` for the estimate + Buy-Credits CTA.
 *   - Hidden entirely when both counts are zero (nothing to show).
 *
 * Permanent failures are rendered by a sibling callout (plan-05 B6),
 * intentionally not folded into this component so it stays focused on
 * the retryable CTA.
 */
export function RetrySummary({ jobId, usePdfs = false }: RetrySummaryProps) {
  const t = useTranslations("extraction.retry");
  const { data: failures } = useProtectedQuery(api.extraction.queries.countJobFailures, { jobId });
  const summary = failures && summarizeRetryable(failures);
  const retryFailed = useMutation(
    api.extraction.mutations.retryFailedQuestions,
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!summary) return null;
  const { retryableCount, permanentCount, permanentBreakdown } = summary;
  if (retryableCount === 0 && permanentCount === 0) return null;

  return (
    <div className="space-y-2">
      <div
        role="status"
        data-retryable-count={retryableCount}
        data-permanent-count={permanentCount}
        className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-xs"
      >
        <span className="flex flex-wrap gap-x-3 tabular-nums">
          {retryableCount > 0 ? <span>{t("summary.retryableOnly", { retryable: retryableCount })}</span> : null}
          {permanentCount > 0 ? <span>{t("summary.permanentOnly", { permanent: permanentCount })}</span> : null}
        </span>
        {retryableCount > 0 && (
          <>
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              data-action="retry"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("retryButton", { count: retryableCount })}
            </Button>
            <RetryConfirmDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              retryableCount={retryableCount}
              usePdfs={usePdfs}
              onConfirm={async () => {
                await retryFailed({ jobId });
              }}
            />
          </>
        )}
      </div>
      {permanentCount > 0 && (
        <PermanentFailuresCallout breakdown={permanentBreakdown} />
      )}
    </div>
  );
}
