"use client";

import { useState } from "react";
import { useNow, useTranslations } from "next-intl";
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
import { useWorkspaceScope } from "@/lib/workspaces/url";
import type { Id } from "@/convex/_generated/dataModel";
import { ExtractionPreflightBanner } from "@/components/extraction/preflight-banner";
import { monthStart } from "@/lib/billing/month";

export interface RetryConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: Id<"extractionJobs">;
  retryableCount: number;
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
 * The figure and the balance are only queried while the dialog is open (cheap compared to
 * subscribing on every job-detail page load).
 */
export function RetryConfirmDialog({
  open,
  onOpenChange,
  jobId,
  retryableCount,
  onConfirm,
}: RetryConfirmDialogProps) {
  const t = useTranslations("extraction.retry.confirmDialog");
  const tc = useTranslations("common");

  // The most the retry costs, on the job's model: the figure the retry checks the balance against.
  const { data: credits } = useProtectedQuery(api.extraction.queries.costs.estimateRetry, open ? { jobId } : "skip");
  // The page's workspace pays (#651).
  const balanceScope = useWorkspaceScope();
  const { data: balance } = useProtectedQuery(
    api.billing.accounts.checkBalance,
    open && credits && balanceScope !== "skip" ? { ...balanceScope, requiredAmount: credits } : "skip",
  );

  // The organization can have the credits while the cap an admin set on the member whose job it is doesn't (#652): the retry is charged as theirs.
  const month = monthStart(useNow({ updateInterval: 60_000 }).getTime());
  const { data: capLeft } = useProtectedQuery(api.extraction.queries.costs.capLeftOf, open ? { jobId, month } : "skip");
  const overCap = typeof capLeft === "number" && credits !== undefined && credits > capLeft;
  const te = useTranslations("errors.body");

  const [submitting, setSubmitting] = useState(false);
  const canConfirm =
    !submitting &&
    capLeft !== undefined &&
    !overCap &&
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
          credits={credits}
          balance={balance}
          onBeforeNavigate={() => onOpenChange(false)}
        />
        {overCap ? <p role="status" className="rounded-md bg-destructive/10 px-3 py-2 text-xs">{te("member_cap")}</p> : null}
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
