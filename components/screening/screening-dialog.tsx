"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import posthog from "posthog-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, ListChecks } from "lucide-react";
import { useSearchOptional } from "@/lib/search";
import { useSearchHistoryStore } from "@/lib/store";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { MAX_SCREENING_PAPERS_PER_JOB } from "@/convex/lib/queryBounds";
import type { Id } from "@/convex/_generated/dataModel";

interface ScreeningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchId: string;
}

export function ScreeningDialog({
  open,
  onOpenChange,
  searchId,
}: ScreeningDialogProps) {
  const t = useTranslations("screeningDialog");

  // Local state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<Id<"screeningJobs"> | null>(
    null
  );

  // Screening questions from search history store
  const screeningQuestions = useSearchHistoryStore(
    (state) =>
      state.searchHistory.find((item) => item.id === searchId)
        ?.screeningQuestions || []
  );

  // Paper count from search context
  const search = useSearchOptional();
  const totalCount = search?.totalCount ?? 0;
  const paperCount = Math.min(totalCount, MAX_SCREENING_PAPERS_PER_JOB);
  const isCapped = totalCount > MAX_SCREENING_PAPERS_PER_JOB;

  // Credit cost check
  const { data: balanceCheck } = useProtectedQuery(
    api.credits.queries.checkBalance,
    open ? { requiredAmount: paperCount } : "skip"
  );

  // Track dialog open
  useEffect(() => {
    if (open) {
      posthog.capture("screening_dialog_opened");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
        showCloseButton={!isSubmitting}
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {t("description", { max: MAX_SCREENING_PAPERS_PER_JOB })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Paper count */}
          <div className="rounded-lg border p-3">
            <p className="text-sm font-medium">
              {isCapped
                ? t("paperCountCapped", {
                    max: MAX_SCREENING_PAPERS_PER_JOB,
                    total: totalCount,
                  })
                : t("paperCount", { count: paperCount })}
            </p>
          </div>

          {/* Credit cost */}
          {balanceCheck && (
            <div
              className={`rounded-lg border p-3 space-y-1 ${
                !balanceCheck.hasEnough
                  ? "border-destructive/50 bg-destructive/5"
                  : ""
              }`}
            >
              <p className="text-sm font-medium">
                {t("creditCost", { count: paperCount })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("currentBalance", { balance: balanceCheck.total })}
              </p>
              {!balanceCheck.hasEnough && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {t("insufficientCredits", {
                    deficit: balanceCheck.deficit,
                  })}
                </p>
              )}
            </div>
          )}

          {/* Screening questions (read-only) */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">{t("questionsTitle")}</h4>
            {screeningQuestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("noQuestions")}
              </p>
            ) : (
              <ol className="space-y-1.5 pl-1">
                {screeningQuestions.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Badge
                      variant="outline"
                      className="mt-0.5 h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums"
                    >
                      {i + 1}
                    </Badge>
                    <span className="text-foreground/90">{q.question}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Scoring rules editor -- placeholder for Plan 02 */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">{t("scoringTitle")}</h4>
            {/* Coming in Plan 02: scoring rules editor */}
          </div>

          {/* Star threshold editor -- placeholder for Plan 02 */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">{t("thresholdsTitle")}</h4>
            {/* Coming in Plan 02: star threshold editor */}
          </div>

          {/* Collection selector -- placeholder for Plan 02 */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">{t("collectionTitle")}</h4>
            {/* Coming in Plan 02: collection selector */}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t("cancel")}
          </Button>
          <Button
            disabled={
              isSubmitting ||
              screeningQuestions.length === 0 ||
              !balanceCheck?.hasEnough
            }
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("submitting")}
              </>
            ) : (
              t("submit")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
