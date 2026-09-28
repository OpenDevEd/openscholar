"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Loader2, AlertCircle, Import, Coins } from "lucide-react";
import { useRouter } from "next/navigation";
import { Slider } from "@/components/ui/slider";
import { useSearchOptional } from "@/lib/search";
import { effectiveSort } from "@/lib/search-params";
import { useSearchHistoryStore } from "@/lib/store";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/toast";
import { showStyledToast } from "@/components/ui/sonner";
import { reconstructAbstract } from "@/lib/openalex/reconstruct-abstract";
import { api } from "@/convex/_generated/api";
import { MAX_SCREENING_PAPERS_PER_JOB } from "@/convex/lib/queryBounds";
import { ESTIMATED_CREDITS_PER_PAPER } from "@/convex/lib/constants";
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

  // Credit cost check
  const estimatedCredits = Math.ceil(paperCount * ESTIMATED_CREDITS_PER_PAPER);
  const { data: balanceCheck } = useProtectedQuery(
    api.credits.queries.checkBalance,
    open ? { requiredAmount: estimatedCredits } : "skip"
  );

  // Set initial range to the max affordable paper count
  const rangeInitialized = useRef(false);
  useEffect(() => {
    if (!open) {
      rangeInitialized.current = false;
      return;
    }
    if (rangeInitialized.current || !balanceCheck || maxPapers < 1) return;
    rangeInitialized.current = true;

    const affordable = Math.floor(balanceCheck.total / ESTIMATED_CREDITS_PER_PAPER);
    const end = Math.max(1, Math.min(affordable, maxPapers));
    setPaperRange([1, end]);
  }, [open, balanceCheck, maxPapers]);

  // Also sync when maxPapers changes (new search) while dialog is closed
  useEffect(() => {
    if (!open) setPaperRange([1, maxPapers]);
  }, [maxPapers, open]);

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
    if (!search?.apiUrl && !search?.oql) return;
    setIsSubmitting(true);
    try {
      // 1. Fetch papers from OpenAlex, then slice to the user-selected range.
      //    OpenAlex hard-caps per_page at 200, so page through (basic paging is
      //    good to 10k results) until we've covered the range or run out.
      const [rangeStart, rangeEnd] = paperRange;
      const PER_PAGE = 200;
      // An OQL search is POSTed to the API root: it outgrows a URL.
      const oql = search.oql;
      const url = new URL(oql ? "https://api.openalex.org/" : search.apiUrl);
      if (oql) url.searchParams.set("sort", effectiveSort(search.params));
      // apiUrl is the SDK's meta.url, which carries `cursor=*`. We paginate with
      // `page`, and OpenAlex rejects `cursor` + `page` together ("Cannot use page
      // parameter with cursor"), so drop the cursor before paging.
      url.searchParams.delete("cursor");
      url.searchParams.set("per_page", String(PER_PAGE));
      const collected: Array<Record<string, unknown>> = [];
      const pagesNeeded = Math.ceil(rangeEnd / PER_PAGE);
      for (let page = 1; page <= pagesNeeded; page++) {
        url.searchParams.set("page", String(page));
        const response = await fetch(
          url.toString(),
          oql
            ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oql }) }
            : undefined,
        );
        if (!response.ok) {
          throw new Error(`OpenAlex API error: ${response.status}`);
        }
        const data = await response.json();
        const pageResults: Array<Record<string, unknown>> = data.results ?? [];
        collected.push(...pageResults);
        // Short page → OpenAlex has no more results, stop early.
        if (pageResults.length < PER_PAGE) break;
      }
      const works: Array<Record<string, unknown>> = collected.slice(rangeStart - 1, rangeEnd);

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
      await createScreeningJob({
        papers,
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
    search?.oql,
    search?.params,
    keyedQuestions,
    scoringRules,
    starThresholds,
    minimumScore,
    selectedCollectionId,
    createScreeningJob,
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
              {balanceCheck && (
                <div className={`flex items-center justify-between rounded-md px-3 py-2 text-xs ${
                  balanceCheck.hasEnough
                    ? "bg-muted/50"
                    : "bg-destructive/10"
                }`}>
                  <div className="flex items-center gap-3">
                    <Coins className={`h-3.5 w-3.5 ${
                      balanceCheck.hasEnough ? "text-muted-foreground" : "text-destructive"
                    }`} />
                    <span className="tabular-nums">
                      <span className="font-semibold">~{estimatedCredits.toLocaleString()}</span>
                      <span className="text-muted-foreground"> / {balanceCheck.total.toLocaleString()}</span>
                    </span>
                  </div>
                  {!balanceCheck.hasEnough && (
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
              localQuestions.length === 0 ||
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
