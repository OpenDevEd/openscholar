"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
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
import { Separator } from "@/components/ui/separator";
import { Loader2, AlertCircle, Coins } from "lucide-react";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { toast } from "sonner";
import { showStyledToast } from "@/components/ui/sonner";
import { resolveToastError, getToastMessageKeyForErrorCode } from "@/lib/toast/error-resolver";
import { api } from "@/convex/_generated/api";
import { QuestionBuilder } from "./question-builder";
import { TierSelector, type ModelTier } from "./tier-selector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  papers?: Array<{ openalexId: string; title: string; doi?: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ESTIMATED_CREDITS_PER_PAPER = 1;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExtractionDialog({
  open,
  onOpenChange,
  papers,
}: ExtractionDialogProps) {
  const t = useTranslations("extraction");
  const tToast = useTranslations("toast");

  // -------------------------------------------------------------------------
  // Form state
  // -------------------------------------------------------------------------

  const [localQuestions, setLocalQuestions] = useState<string[]>([]);
  const [tier, setTier] = useState<ModelTier>("auto");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset all form state when dialog opens (ref-based guard)
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setLocalQuestions([]);
      setTier("auto");
      setIsSubmitting(false);
    }
    prevOpenRef.current = open;
  }, [open]);

  // -------------------------------------------------------------------------
  // Credit balance check
  // -------------------------------------------------------------------------

  const paperCount = papers?.length ?? 0;
  const estimatedCredits = Math.ceil(paperCount * ESTIMATED_CREDITS_PER_PAPER);
  const { data: balanceCheck } = useProtectedQuery(
    api.credits.queries.checkBalance,
    open && paperCount > 0 ? { requiredAmount: estimatedCredits } : "skip"
  );

  // -------------------------------------------------------------------------
  // Question handlers (passed to QuestionBuilder)
  // -------------------------------------------------------------------------

  const handleAddQuestion = useCallback(
    (question: string) => {
      const isDuplicate = localQuestions.some(
        (q) => q.toLowerCase() === question.toLowerCase()
      );
      if (isDuplicate) return;
      setLocalQuestions((prev) => [...prev, question]);
    },
    [localQuestions]
  );

  const handleRemoveQuestion = useCallback((index: number) => {
    setLocalQuestions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleEditQuestion = useCallback(
    (index: number, newQuestion: string) => {
      setLocalQuestions((prev) =>
        prev.map((q, i) => (i === index ? newQuestion : q))
      );
    },
    []
  );

  // -------------------------------------------------------------------------
  // Submit handler
  // -------------------------------------------------------------------------

  const createJob = useMutation(api.extraction.mutations.createExtractionJob);

  const handleSubmit = useCallback(async () => {
    if (!papers || papers.length === 0 || localQuestions.length === 0) return;
    setIsSubmitting(true);
    try {
      const keyedQuestions = localQuestions.map((q, i) => ({
        key: `q_${i}`,
        question: q,
      }));
      await createJob({ papers, questions: keyedQuestions, tier });
      toast.success(t("jobCreation.success"), { duration: 3000 });
      onOpenChange(false);
      posthog.capture("extraction_job_created", {
        paperCount: papers.length,
        questionCount: localQuestions.length,
        tier,
      });
    } catch (error: unknown) {
      const resolved = resolveToastError(error, t("jobCreation.error"));
      const messageKey = getToastMessageKeyForErrorCode(resolved.code);
      showStyledToast("error", messageKey ? tToast(messageKey) : resolved.message);
    } finally {
      setIsSubmitting(false);
    }
  }, [papers, localQuestions, tier, createJob, onOpenChange, t]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const hasInsufficientBalance =
    balanceCheck !== undefined &&
    balanceCheck !== null &&
    !balanceCheck.hasEnough;
  const isSubmitDisabled =
    isSubmitting ||
    localQuestions.length === 0 ||
    paperCount === 0 ||
    hasInsufficientBalance;

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
        className="sm:max-w-xl max-h-[85vh] flex flex-col"
      >
        <DialogHeader>
          <DialogTitle>{t("jobCreation.title")}</DialogTitle>
          <DialogDescription>
            {t("jobCreation.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          <div className="space-y-4 py-2">
            {/* Section 1: Questions */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("jobCreation.addQuestion")}
              </p>
              <QuestionBuilder
                questions={localQuestions}
                onAdd={handleAddQuestion}
                onRemove={handleRemoveQuestion}
                onEdit={handleEditQuestion}
              />
              {localQuestions.length === 0 && (
                <p className="text-destructive text-xs">
                  {t("jobCreation.noQuestions")}
                </p>
              )}
            </div>

            <Separator />

            {/* Section 2: Model tier selector */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("jobCreation.modelTierLabel")}
              </p>
              <TierSelector value={tier} onChange={setTier} />
            </div>

            {/* Section 3: Cost preview */}
            <div
              className="rounded-lg border border-border/50 bg-card px-4 py-3 space-y-2"
              aria-live="polite"
            >
              <div className="flex items-center gap-2 text-sm">
                <Coins className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="tabular-nums">
                  {t("jobCreation.costPreview", {
                    credits: estimatedCredits,
                  })}
                </span>
              </div>
              {hasInsufficientBalance && (
                <div className="flex items-center gap-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{t("jobCreation.insufficientBalance")}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t("jobCreation.dismiss")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
          >
            {isSubmitting ? (
              <span role="status" className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("jobCreation.submitting")}
              </span>
            ) : (
              t("jobCreation.submit")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
