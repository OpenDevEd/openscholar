"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useAction } from "convex/react";
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
import { Loader2, AlertCircle, Import, Coins } from "lucide-react";
import { useRouter } from "next/navigation";
import { Slider } from "@/components/ui/slider";
import { useSearchOptional } from "@/lib/search";
import { useResearchStatus } from "@/lib/research/provider";
import { isRatingFilterActive } from "@/lib/utils";
import { useSearchHistoryStore } from "@/lib/store";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/toast";
import { showStyledToast } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import { MAX_SCREENING_PAPERS_PER_JOB } from "@/convex/lib/queryBounds";
import { estimateScreening } from "@/convex/screening/estimate";
import type { ScoringRule, StarThreshold } from "@/convex/screening/scoring";
import { ScoringRulesEditor } from "@/components/screening/scoring-rules-editor";
import { StarThresholdEditor } from "@/components/screening/star-threshold-editor";
import { CollectionSelector } from "@/components/screening/collection-selector";

// ---------------------------------------------------------------------------
// Default scoring config generator
// ---------------------------------------------------------------------------

function getDefaultScoringConfig(questions: { key: string; question: string }[]) {
  const rules: ScoringRule[] = questions.map((q) => ({
    questionKey: q.key,
    yesPoints: 1,
    noPoints: 0,
    nullPoints: 0,
  }));

  // Incrementing defaults so each star tier needs a distinct, higher score. The
  // old percentage formula (floor(n*pct)+1) collapsed to repeated 1s for small
  // question sets, leaving most tiers tied at >= 1.
  const starThresholds: StarThreshold[] = [
    { minScore: 1, stars: 1 },
    { minScore: 2, stars: 2 },
    { minScore: 3, stars: 3 },
    { minScore: 4, stars: 4 },
    { minScore: 5, stars: 5 },
  ];

  return { rules, starThresholds };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  const tc = useTranslations("common");
  const router = useRouter();

  // Footer screening questions (from store) — read-only, used for import
  const footerQuestions = useSearchHistoryStore(
    (state) =>
      state.searchHistory.find((item) => item.id === searchId)
        ?.screeningQuestions || []
  );

  // Local question state (independent from footer/store)
  const [localQuestions, setLocalQuestions] = useState<string[]>([]);

  // Build keyed questions for scoring engine
  const keyedQuestions = useMemo(
    () =>
      localQuestions.map((q, i) => ({
        key: `q${i}`,
        question: q,
      })),
    [localQuestions]
  );

  // Default config derived from questions
  const defaults = useMemo(
    () => getDefaultScoringConfig(keyedQuestions),
    [keyedQuestions]
  );

  // Local form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scoringRules, setScoringRules] = useState<ScoringRule[]>(
    defaults.rules
  );
  const [starThresholds, setStarThresholds] = useState<StarThreshold[]>(
    defaults.starThresholds
  );
  const [minimumScore, setMinimumScore] = useState<number | undefined>(1);
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    import("@/convex/_generated/dataModel").Id<"collections"> | undefined
  >(undefined);

  // Reset all form state when dialog opens
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setLocalQuestions([]);
      setScoringRules([]);
      setStarThresholds(getDefaultScoringConfig([]).starThresholds);
      setMinimumScore(1);
      setSelectedCollectionId(undefined);
    }
    prevOpenRef.current = open;
  }, [open]);

  // -----------------------------------------------------------------------
  // Question management handlers (local state only — no store mutations)
  // -----------------------------------------------------------------------

  const handleAddQuestion = useCallback(
    (question: string) => {
      const duplicate = localQuestions.some(
        (q) => q.toLowerCase() === question.toLowerCase()
      );
      if (duplicate) return;
      setLocalQuestions((prev) => [...prev, question]);
      // Append a default rule for the new question
      const newKey = `q${localQuestions.length}`;
      setScoringRules((prev) => [
        ...prev,
        { questionKey: newKey, yesPoints: 1, noPoints: 0, nullPoints: 0 },
      ]);
    },
    [localQuestions]
  );

  const handleRemoveQuestion = useCallback(
    (index: number) => {
      setLocalQuestions((prev) => prev.filter((_, i) => i !== index));
      // Remove the rule and re-key remaining rules
      setScoringRules((prev) => {
        const filtered = prev.filter((_, i) => i !== index);
        return filtered.map((r, i) => ({ ...r, questionKey: `q${i}` }));
      });
    },
    []
  );

  const handleEditQuestion = useCallback(
    (index: number, newQuestion: string) => {
      setLocalQuestions((prev) =>
        prev.map((q, i) => (i === index ? newQuestion : q))
      );
    },
    []
  );

  // Import questions from screening footer
  const handleImportQuestions = useCallback(() => {
    if (footerQuestions.length === 0) return;

    const existingLower = new Set(localQuestions.map((q) => q.toLowerCase()));
    const newQuestions = footerQuestions
      .map((q) => q.question)
      .filter((q) => !existingLower.has(q.toLowerCase()));

    if (newQuestions.length === 0) return;

    const allQuestions = [...localQuestions, ...newQuestions];
    setLocalQuestions(allQuestions);

    // Rebuild scoring rules for all questions
    const newRules: ScoringRule[] = allQuestions.map((_, i) => {
      // Preserve existing rules, add defaults for new ones
      const existing = scoringRules.find((r) => r.questionKey === `q${i}`);
      return existing ?? {
        questionKey: `q${i}`,
        yesPoints: 1,
        noPoints: 0,
        nullPoints: 0,
      };
    });
    setScoringRules(newRules);
  }, [footerQuestions, localQuestions, scoringRules]);

  // Paper count from search context
  const search = useSearchOptional();
  const totalCount = search?.totalCount ?? 0;
  const maxPapers = Math.min(totalCount, MAX_SCREENING_PAPERS_PER_JOB);
  const isCapped = totalCount > MAX_SCREENING_PAPERS_PER_JOB;
  const [paperRange, setPaperRange] = useState<[number, number]>([1, maxPapers]);
  const paperCount = paperRange[1] - paperRange[0] + 1;

  // Credit cost check: the balance is read once, and the estimate the assistant shows too is
  // worked out from it as the range changes, so it never waits on a query.
  const { data: account } = useProtectedQuery(api.billing.accounts.mine, open ? {} : "skip");
  const estimate = account === undefined ? undefined : estimateScreening(paperCount, account?.balance ?? 0);
  // A rating filter keeps only some of the range's papers, which the server works out; it
  // checks the credits for the papers that are left.
  const ratingFiltered = search ? isRatingFilterActive([search.params.rmin, search.params.rmax], search.params.rated) : false;
  const hasEnough = estimate ? ratingFiltered || estimate.credits <= estimate.available : false;
  // The server reads the saved search, so edits still being saved would be screened without.
  const { pending: savingEdits } = useResearchStatus();
  const affordablePapers = estimate?.affordablePapers;

  // Set initial range to the max affordable paper count
  const rangeInitialized = useRef(false);
  useEffect(() => {
    if (!open) {
      rangeInitialized.current = false;
      return;
    }
    if (rangeInitialized.current || affordablePapers === undefined || maxPapers < 1) return;
    rangeInitialized.current = true;

    const affordable = affordablePapers;
    const end = Math.max(1, Math.min(affordable, maxPapers));
    setPaperRange([1, end]);
  }, [open, affordablePapers, maxPapers]);

  // Also sync when maxPapers changes (new search) while dialog is closed
  useEffect(() => {
    if (!open) setPaperRange([1, maxPapers]);
  }, [maxPapers, open]);

  // The server reads the search's papers and starts the job.
  const screenSearch = useAction(api.screening.start.screenSearch);

  // Track dialog open
  useEffect(() => {
    if (open) {
      posthog.capture("screening_dialog_opened");
    }
  }, [open]);

  // -----------------------------------------------------------------------
  // Submit handler
  // -----------------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    if (!search) return;
    setIsSubmitting(true);
    try {
      const [first, last] = paperRange;
      await screenSearch({
        searchId,
        first,
        last,
        questions: keyedQuestions,
        scoringConfig: {
          rules: scoringRules,
          starThresholds,
          minimumScore,
        },
        targetCollectionId: selectedCollectionId,
      });

      toast.success(t("submitSuccess"), { duration: 3000 });
      onOpenChange(false);
      posthog.capture("screening_job_submitted", {
        paperCount,
        questionCount: keyedQuestions.length,
      });
    } catch (error: unknown) {
      // Check for active job error
      const msg = getErrorMessage(error, t("submitError"));
      if (
        typeof error === "object" &&
        error !== null &&
        "data" in error &&
        typeof (error as { data?: unknown }).data === "string" &&
        ((error as { data: string }).data).includes(
          "SCREENING_JOB_ALREADY_ACTIVE"
        )
      ) {
        showStyledToast("error", t("activeJobWarning"));
      } else {
        showStyledToast("error", msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    search,
    searchId,
    keyedQuestions,
    scoringRules,
    starThresholds,
    minimumScore,
    selectedCollectionId,
    paperRange,
    paperCount,
    screenSearch,
    onOpenChange,
    t,
  ]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const hasFooterQuestions = footerQuestions.length > 0;
  const allFooterImported =
    hasFooterQuestions &&
    footerQuestions.every((fq) =>
      localQuestions.some(
        (lq) => lq.toLowerCase() === fq.question.toLowerCase()
      )
    );

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
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { max: MAX_SCREENING_PAPERS_PER_JOB })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          <div className="space-y-4 py-2">
            {/* Credit usage card */}
            <div className="rounded-lg border border-border/50 bg-card px-4 py-3 space-y-3">
              {/* Paper count selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {isCapped
                      ? t("paperCountCapped", {
                          max: MAX_SCREENING_PAPERS_PER_JOB,
                          total: totalCount,
                        })
                      : t("paperCount", { count: paperCount })}
                  </p>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {paperRange[0]}–{paperRange[1]} {t("ofTotal", { total: maxPapers })}
                  </span>
                </div>
                {maxPapers > 1 && (
                  <Slider
                    min={1}
                    max={maxPapers}
                    step={1}
                    value={paperRange}
                    onValueChange={([start, end]) => setPaperRange([start, end])}
                    disabled={isSubmitting}
                    className="w-full"
                  />
                )}
              </div>

              {/* Credit summary */}
              {estimate && (
                <div className={`flex items-center justify-between rounded-md px-3 py-2 text-xs ${
                  hasEnough
                    ? "bg-muted/50"
                    : "bg-destructive/10"
                }`}>
                  <div className="flex items-center gap-3">
                    <Coins className={`h-3.5 w-3.5 ${
                      hasEnough ? "text-muted-foreground" : "text-destructive"
                    }`} />
                    <span className="tabular-nums">
                      <span className="font-semibold">~{estimate.credits.toLocaleString()}</span>
                      <span className="text-muted-foreground"> / {estimate.available.toLocaleString()}</span>
                    </span>
                  </div>
                  {!hasEnough && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 shrink-0 gap-1.5 px-2 text-[11px] font-semibold border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 transition-all"
                      onClick={() => {
                        onOpenChange(false);
                        router.push("/settings/billing#topup-section");
                      }}
                    >
                      {tc("buyCredits")}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Section 1: Questions & Scoring Rules */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("questionsTitle")} & {t("scoringTitle")}
                </p>
                {hasFooterQuestions && !allFooterImported && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleImportQuestions}
                    disabled={isSubmitting}
                    className="h-6 gap-1.5 text-xs text-muted-foreground"
                  >
                    <Import className="h-3 w-3" />
                    {t("importQuestions", { count: footerQuestions.length })}
                  </Button>
                )}
              </div>
              <ScoringRulesEditor
                questions={keyedQuestions}
                rules={scoringRules}
                onChange={setScoringRules}
                minimumScore={minimumScore}
                onMinimumScoreChange={setMinimumScore}
                onAddQuestion={handleAddQuestion}
                onRemoveQuestion={handleRemoveQuestion}
                onEditQuestion={handleEditQuestion}
                disabled={isSubmitting}
              />
            </div>

            {keyedQuestions.length > 0 && (
              <>
                <Separator />

                {/* Section 2: Star Thresholds */}
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("thresholdsTitle")}
                  </p>
                  <StarThresholdEditor
                    thresholds={starThresholds}
                    onChange={setStarThresholds}
                    rules={scoringRules}
                    minimumScore={minimumScore}
                    disabled={isSubmitting}
                  />
                </div>

                <Separator />

                {/* Section 3: Target Collection */}
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("collectionTitle")}
                  </p>
                  <CollectionSelector
                    selectedId={selectedCollectionId}
                    onSelect={setSelectedCollectionId}
                    disabled={isSubmitting}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              savingEdits > 0 ||
              localQuestions.length === 0 ||
              !hasEnough
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
