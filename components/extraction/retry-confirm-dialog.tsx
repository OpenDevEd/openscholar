"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { estimateRetryCredits } from "@/lib/extraction/cost-estimate";
import { ExtractionPreflightBanner } from "@/components/extraction/preflight-banner";

export interface RetryConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  retryableCount: number;
  /** Mirrors `extractionJobs.usePdfs`; drives the PDF-tier cost. */
  usePdfs: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Plan-05 retry confirmation dialog.
 *
 * Shows "Retry N failures?" with a reused `<ExtractionPreflightBanner>`
 * (plan 03) so the user sees the estimated retry cost + their current
 * balance + the Buy Credits CTA if short. The Continue button is
 * disabled until the preflight banner reports `hasEnough`.
 *
 * Balance is only queried while the dialog is open (cheap compared to
 * subscribing on every job-detail page load).
 */
export function RetryConfirmDialog({
  open,
  onOpenChange,
  retryableCount,
  usePdfs,
  onConfirm,
}: RetryConfirmDialogProps) {
  const t = useTranslations("extraction.retry.confirmDialog");
  const tc = useTranslations("common");

  const estimate = estimateRetryCredits({
    retryableCount,
    usePdfs,
    avgPaperKind: usePdfs ? "pdf" : "abstract",
  });

  const { data: balance } = useProtectedQuery(
    api.credits.queries.checkBalance,
    open && estimate.high > 0 ? { requiredAmount: estimate.high } : "skip",
  );

  const [submitting, setSubmitting] = useState(false);
  const canConfirm =
    !submitting &&
    (balance === null || balance === undefined
      ? false
      : balance.hasEnough);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-retry-confirm="true">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("title", { count: retryableCount })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <ExtractionPreflightBanner
          estimate={estimate}
          balance={balance}
          onBeforeNavigate={() => onOpenChange(false)}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!canConfirm}
            data-action="confirm"
          >
            {t("continue")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
