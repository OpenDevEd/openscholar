"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, AlertCircle, ListChecks } from "lucide-react";
import { useSearchOptional } from "@/lib/search";
import { useSearchHistoryStore } from "@/lib/store";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/toast";
import { showStyledToast } from "@/components/ui/sonner";
import { reconstructAbstract } from "@/lib/openalex/reconstruct-abstract";
import { api } from "@/convex/_generated/api";
import { MAX_SCREENING_PAPERS_PER_JOB } from "@/convex/lib/queryBounds";
import type { Id } from "@/convex/_generated/dataModel";
import type { ScoringRule, StarThreshold } from "@/convex/screening/scoring";
import { ScoringRulesEditor } from "@/components/screening/scoring-rules-editor";
import { StarThresholdEditor } from "@/components/screening/star-threshold-editor";
import { CollectionSelector } from "@/components/screening/collection-selector";
import { ScreeningProgress } from "@/components/screening/screening-progress";
import { ScreeningJobHistory } from "@/components/screening/screening-job-history";

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

  const n = questions.length;
  const starThresholds: StarThreshold[] = [
    { minScore: 0, maxScore: 0, stars: 1 },
    { minScore: 1, maxScore: Math.floor(n * 0.25), stars: 2 },
    {
      minScore: Math.floor(n * 0.25) + 1,
      maxScore: Math.floor(n * 0.5),
      stars: 3,
    },
    {
      minScore: Math.floor(n * 0.5) + 1,
      maxScore: Math.floor(n * 0.75),
      stars: 4,
    },
    {
      minScore: Math.floor(n * 0.75) + 1,
      maxScore: n,
      stars: 5,
    },
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

  // Screening questions from search history store
  const screeningQuestions = useSearchHistoryStore(
    (state) =>
      state.searchHistory.find((item) => item.id === searchId)
        ?.screeningQuestions || []
  );

  // Build keyed questions for scoring engine
  const keyedQuestions = useMemo(
    () =>
      screeningQuestions.map((q, i) => ({
        key: `q${i}`,
        question: q.question,
      })),
    [screeningQuestions]
  );

  // Default config derived from questions
  const defaults = useMemo(
    () => getDefaultScoringConfig(keyedQuestions),
    [keyedQuestions]
  );

  // Local form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<Id<"screeningJobs"> | null>(
    null
  );
  const [scoringRules, setScoringRules] = useState<ScoringRule[]>(
    defaults.rules
  );
  const [starThresholds, setStarThresholds] = useState<StarThreshold[]>(
    defaults.starThresholds
  );
  const [minimumScore, setMinimumScore] = useState<number | undefined>(
    undefined
  );
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    Id<"collections"> | undefined
  >(undefined);

  // Reset form state when questions change
  useEffect(() => {
    setScoringRules(defaults.rules);
    setStarThresholds(defaults.starThresholds);
  }, [defaults]);

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

  // Convex mutation
  const createScreeningJob = useMutation(
    api.screening.mutations.createScreeningJob
  );

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
    if (!search?.apiUrl) return;
    setIsSubmitting(true);
    try {
      // 1. Fetch up to 200 papers from OpenAlex
      const url = new URL(search.apiUrl);
      url.searchParams.set("per_page", String(MAX_SCREENING_PAPERS_PER_JOB));
      url.searchParams.set("page", "1");
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`OpenAlex API error: ${response.status}`);
      }
      const data = await response.json();
      const works: Array<Record<string, unknown>> = data.results ?? [];

      // 2. Map to screening paper input shape
      const papers = works.map((w) => {
        const abstractIdx = w.abstract_inverted_index as
          | Record<string, number[]>
          | null
          | undefined;
        return {
          openalexId: String(w.id ?? ""),
          title: String(w.title ?? w.display_name ?? ""),
          abstract: abstractIdx
            ? reconstructAbstract(abstractIdx)
            : undefined,
          authors: Array.isArray(w.authorships)
            ? (w.authorships as Array<{ author?: { display_name?: string } }>)
                .map((a) => a.author?.display_name)
                .filter((name): name is string => !!name)
            : undefined,
          publicationYear:
            typeof w.publication_year === "number"
              ? w.publication_year
              : undefined,
          doi: typeof w.doi === "string" ? w.doi : undefined,
        };
      });

      // 3. Call createScreeningJob mutation
      const { jobId } = await createScreeningJob({
        papers,
        questions: keyedQuestions,
        scoringConfig: {
          rules: scoringRules,
          starThresholds,
          minimumScore,
        },
        targetCollectionId: selectedCollectionId,
      });

      setActiveJobId(jobId);
      toast.success(t("submitSuccess"), { duration: 3000 });
      posthog.capture("screening_job_submitted", {
        paperCount: papers.length,
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
    search?.apiUrl,
    keyedQuestions,
    scoringRules,
    starThresholds,
    minimumScore,
    selectedCollectionId,
    createScreeningJob,
    t,
  ]);

  // -----------------------------------------------------------------------
  // Reset to configure mode
  // -----------------------------------------------------------------------

  function handleNewScreening() {
    setActiveJobId(null);
    setScoringRules(defaults.rules);
    setStarThresholds(defaults.starThresholds);
    setMinimumScore(undefined);
    setSelectedCollectionId(undefined);
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const isProgressMode = activeJobId !== null;

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
        className="sm:max-w-2xl max-h-[85vh] flex flex-col"
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

        {isProgressMode ? (
          /* ============ Progress Mode ============ */
          <>
            <ScrollArea className="flex-1 overflow-y-auto pr-2">
              <div className="space-y-4 py-2">
                <ScreeningProgress jobId={activeJobId} />
                <ScreeningJobHistory
                  onSelectJob={(jobId) => setActiveJobId(jobId)}
                />
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button variant="outline" onClick={handleNewScreening}>
                {t("newScreening")}
              </Button>
              <Button onClick={() => onOpenChange(false)}>
                {t("closeDialog")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* ============ Configure Mode ============ */
          <>
            <ScrollArea className="flex-1 overflow-y-auto pr-2">
              <div className="space-y-4 py-2">
                {/* Paper count */}
                <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
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
                    className={`rounded-lg border border-border/50 p-3 space-y-1 ${
                      !balanceCheck.hasEnough
                        ? "border-destructive/50 bg-destructive/5"
                        : "bg-muted/30"
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

                {/* Questions & Scoring rules editor (merged) */}
                {keyedQuestions.length > 0 ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">
                      {t("questionsTitle")} & {t("scoringTitle")}
                    </h4>
                    <ScoringRulesEditor
                      questions={keyedQuestions}
                      rules={scoringRules}
                      onChange={setScoringRules}
                      minimumScore={minimumScore}
                      onMinimumScoreChange={setMinimumScore}
                      disabled={isSubmitting}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("noQuestions")}
                  </p>
                )}

                {/* Star threshold editor */}
                {keyedQuestions.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">
                      {t("thresholdsTitle")}
                    </h4>
                    <StarThresholdEditor
                      thresholds={starThresholds}
                      onChange={setStarThresholds}
                      rules={scoringRules}
                      minimumScore={minimumScore}
                      disabled={isSubmitting}
                    />
                  </div>
                )}

                {/* Collection selector */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">
                    {t("collectionTitle")}
                  </h4>
                  <CollectionSelector
                    selectedId={selectedCollectionId}
                    onSelect={setSelectedCollectionId}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSubmit}
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
