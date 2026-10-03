"use client";

import { useEffect, useRef, useState, useMemo, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { parseAsInteger, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Layers,
  FileText,
  Zap,
  CircleCheck,
  ChevronRight,
  ExtractionIcon,
} from "@/components/icons";
import { useExtractionStore, type JobMode } from "@/lib/store/extraction";
import { useBucketStore } from "@/lib/store/bucket";
import { bucketItemToServerInput } from "@/lib/bucket/to-server-input";
import { QuestionBuilder } from "./question-builder";
import { SourceSelector } from "./source-selector";
import { SourceSummary } from "./source-summary";
import { BucketIndicator } from "./bucket/bucket-indicator";
import { BucketDrawer } from "./bucket/bucket-drawer";
import { ModeSelector } from "./mode-selector";
import { PdfToggle } from "./pdf-toggle";
import { AbstractMissingBanner } from "./chat/abstract-missing-banner";
import { ChatStartReview } from "./chat/chat-start-review";
import { ExtractionPreflightBanner } from "./preflight-banner";
import { estimateExtractionCredits } from "@/lib/extraction/cost-estimate";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { useAppToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { useIsMobile } from "@/lib/hooks";
import { readyBucketPaperCount } from "@/lib/bucket/paper-count";

const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 50 : -50,
    opacity: 0,
    scale: 0.95,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 50 : -50,
    opacity: 0,
    scale: 0.95,
  }),
};

export function JobCreator({ paperLimit }: { paperLimit: number }) {
  const router = useRouter();
  const toast = useAppToast();
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const [stepRaw, setStepRaw] = useQueryState(
    "step",
    parseAsInteger.withDefault(1).withOptions({ history: "replace" }),
  );
  const [direction, setDirection] = useState(0);
  const [isPending, startTransition] = useTransition();
  // ai-chatbot pattern: a sticky success flag covers the seam between the transition ending and the route unmount, so the spinner never blinks back to the resting button.
  const [hasSucceeded, setHasSucceeded] = useState(false);
  const isSubmitting = isPending || hasSucceeded;
  const [bucketOpen, setBucketOpen] = useState(false);
  const bucketIndicatorRef = useRef<HTMLButtonElement>(null);
  // Cleared on unmount post-submit so a Zustand mutation can't force a blocking re-render against the wizard's other-mode step-3 branch.
  const shouldClearOnExit = useRef(false);
  const isMobile = useIsMobile();

  const validStep = Math.min(3, Math.max(1, stepRaw)) as 1 | 2 | 3;

  const {
    draftJob,
    setDraftJobName,
    setMode,
    setUsePdfs,
    clearDraftJob,
  } = useExtractionStore();
  const bucketOrder = useBucketStore((s) => s.order);
  const bucketItemsMap = useBucketStore((s) => s.items);
  const clearBucket = useBucketStore((s) => s.clear);
  const startJob = useMutation(api.extraction.mutations.startJob);
  const pdfCapabilityEnabled = useFeatureFlag("extraction.pdf");
  const chatFlagEnabled = useFeatureFlag("extraction.chat");

  useEffect(() => () => {
    if (shouldClearOnExit.current) {
      clearDraftJob();
      clearBucket();
    }
  }, [clearDraftJob, clearBucket]);

  // Persisted `mode: "chat"` would strand a user behind a hidden selector if the flag flipped off after they picked it.
  const effectiveMode: JobMode = chatFlagEnabled ? draftJob.mode : "extraction";

  const steps = useMemo(() => [
    { id: 1, title: t("modeAndDetails"), icon: Layers, description: t("pickModeAndName") },
    { id: 2, title: t("selectPapers"), icon: FileText, description: t("chooseFromHistory") },
    {
      id: 3,
      title: effectiveMode === "chat" ? t("chatStartReviewTitle") : t("defineQuestions"),
      icon: Zap,
      description:
        effectiveMode === "chat" ? t("chatReviewStepDescription") : t("whatToExtract"),
    },
  ], [t, effectiveMode]);

  const handleNext = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (validStep < 3 && canProceed()) {
      setDirection(1);
      setStepRaw((prev) => Math.min(prev + 1, 3));
    }
  };

  const handleBack = () => {
    if (validStep > 1) {
      setDirection(-1);
      setStepRaw((prev) => Math.max(prev - 1, 1));
    } else {
      router.push("/extraction");
    }
  };

  const readyBucketItems = useMemo(
    () =>
      bucketOrder
        .map((k) => bucketItemsMap[k])
        .filter((i) => i && i.status === "ready"),
    [bucketOrder, bucketItemsMap],
  );

  // Plan-03: live preflight estimate + balance check. Mirrors the
  // screening-dialog balance row (components/screening/screening-dialog.tsx:210-215).
  const preflightEstimate = useMemo(
    () => {
      const paperCount = readyBucketPaperCount(readyBucketItems);
      return estimateExtractionCredits({
        papers: paperCount,
        questions: draftJob.questions.length,
        usePdfs: draftJob.usePdfs,
        avgPaperKind: draftJob.usePdfs ? "pdf" : "abstract",
      });
    },
    [readyBucketItems, draftJob.questions.length, draftJob.usePdfs],
  );
  const { data: preflightBalance } = useProtectedQuery(
    api.billing.accounts.checkBalance,
    effectiveMode === "extraction" && preflightEstimate.high > 0
      ? { requiredAmount: preflightEstimate.high }
      : "skip",
  );
  const preflightBlocked =
    effectiveMode === "extraction" &&
    preflightEstimate.high > 0 &&
    preflightBalance !== undefined &&
    (preflightBalance === null || !preflightBalance.hasEnough);

  const handleSubmit = () => {
    if (readyBucketItems.length === 0) {
      toast.validation.failed(t("pleaseSelectSource"));
      return;
    }
    if (effectiveMode === "extraction" && draftJob.questions.length === 0) {
      toast.validation.failed(t("pleaseCompleteSteps"));
      return;
    }

    startTransition(async () => {
      try {
        const bucketItems = readyBucketItems.map(
          (item) => bucketItemToServerInput(item) as never,
        );
        const result =
          effectiveMode === "extraction"
            ? await startJob({
                name: draftJob.name || t("untitledJob"),
                mode: "extraction",
                bucketItems,
                questions: draftJob.questions.map((q, i) => ({
                  key: q.key || `q_${i}`,
                  question: q.question,
                  type: q.type,
                  description: q.description,
                })),
                usePdfs: draftJob.usePdfs,
              })
            : await startJob({
                name: draftJob.name || t("untitledJob"),
                mode: "chat",
                bucketItems,
                chatModelId: draftJob.chatModelId ?? undefined,
              });

        setHasSucceeded(true);
        shouldClearOnExit.current = true;
        router.push(
          effectiveMode === "chat"
            ? `/extraction/${result.jobId}?mode=chat`
            : `/extraction/${result.jobId}`,
        );
      } catch (error) {
        toast.job.createFailed(error);
      }
    });
  };

  const canProceed = () => {
    switch (validStep) {
      case 1:
        if (draftJob.name.trim().length === 0) return false;
        return true;
      case 2:
        return readyBucketItems.length > 0;
      case 3:
        if (effectiveMode === "chat") return true;
        if (draftJob.questions.length === 0) return false;
        // Plan-03: disable submit on step 3 when the user cannot cover
        // the estimate. Server preflight still runs and is the source
        // of truth; this is a UX courtesy.
        if (preflightBlocked) return false;
        return true;
      default:
        return false;
    }
  };

  return (
    <LibraryPageShell
      icon={ExtractionIcon}
      title={t("newJobTitle")}
      backHref="/extraction"
      backLabel={tc("cancel")}
      allowOverflow
      tabs={
        <JobSteps
          steps={steps}
          current={validStep}
          disabled={isSubmitting}
          onSelect={(step) => {
            setDirection(-1);
            void setStepRaw(step);
          }}
        />
      }
      actions={isMobile ? (
        <BucketIndicator
          ref={bucketIndicatorRef}
          onClick={() => setBucketOpen(true)}
          paperLimit={paperLimit}
        />
      ) : null}
    >
    <div className="w-full px-4 pt-6 md:px-6 md:pt-8">
      {isMobile && (
        <BucketDrawer
          open={bucketOpen}
          onOpenChange={setBucketOpen}
          onClearReturnFocus={() => bucketIndicatorRef.current?.focus()}
          paperLimit={paperLimit}
        />
      )}

      {/* Content Area with Spring Physics */}
      <div className="min-h-[400px]">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={validStep}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: "spring", stiffness: 300, damping: 30 },
              opacity: { duration: 0.2 },
              scale: { duration: 0.2 },
            }}
            className="h-full"
          >
            {validStep === 1 && (
              <form onSubmit={handleNext} className="max-w-lg mx-auto">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-center mb-8"
                >
                  <h2 className="text-2xl font-bold text-foreground mb-2">
                    {t("modeAndDetails")}
                  </h2>
                  <p className="text-muted-foreground">
                    {t("pickModeAndName")}
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="space-y-6"
                >
                  {chatFlagEnabled && (
                    <ModeSelector
                      value={draftJob.mode}
                      onChange={setMode}
                      disabled={isSubmitting}
                    />
                  )}

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="name">
                      {t("jobName")}
                    </Label>
                    <Input
                      id="name"
                      placeholder={t("jobNamePlaceholder")}
                      value={draftJob.name}
                      onChange={(e) => setDraftJobName(e.target.value)}
                      className="h-14 text-lg"
                      autoFocus
                    />
                  </div>

                  {effectiveMode === "extraction" && pdfCapabilityEnabled && (
                    <PdfToggle
                      value={draftJob.usePdfs}
                      onChange={setUsePdfs}
                      disabled={isSubmitting}
                    />
                  )}

                </motion.div>
              </form>
            )}

            {validStep === 2 && (
              <div className="h-full">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mb-6"
                >
                  <h2 className="text-2xl font-bold text-foreground mb-2">
                    {t("selectPapers")}
                  </h2>
                 <p className="text-muted-foreground">
                   {t("combineSources")}
                 </p>
                 <SourceSummary />
                </motion.div>

                 {effectiveMode === "chat" && <AbstractMissingBanner />}
                  <SourceSelector paperLimit={paperLimit} />
              </div>
            )}

            {validStep === 3 && effectiveMode === "extraction" && (
              <div className="h-full">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mb-6"
                >
                  <h2 className="text-2xl font-bold text-foreground mb-2">
                    {t("defineQuestions")}
                  </h2>
                  <p className="text-muted-foreground">
                    {t("whatDataPoints")}
                  </p>
                </motion.div>

                <QuestionBuilder />

                {draftJob.questions.length > 0 && (
                  <div className="mt-6">
                    <ExtractionPreflightBanner
                      estimate={preflightEstimate}
                      balance={preflightBalance}
                    />
                  </div>
                )}
              </div>
            )}

            {validStep === 3 && effectiveMode === "chat" && <ChatStartReview />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer Actions — sticky to viewport bottom; releases at end of container */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="sticky bottom-0 z-20 mt-12 -mx-4 md:-mx-6 rounded-b-2xl border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 md:px-6 py-4 flex justify-between items-center"
      >
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={isSubmitting}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {validStep === 1 ? tc("cancel") : tc("back")}
        </Button>

        <Button
          onClick={validStep === 3 ? handleSubmit : handleNext}
          disabled={!canProceed() || isSubmitting}
          size="lg"
          className="min-w-[160px] font-semibold"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {tc("starting")}
            </>
          ) : validStep === 3 ? (
            <>
              {effectiveMode === "chat" ? t("startChat") : t("startExtraction")}
              <Zap className="ml-2 h-4 w-4" />
            </>
          ) : (
            <>
              {tc("continue")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </motion.div>
    </div>
    </LibraryPageShell>
  );
}

/**
 * The three steps as a compact switcher in the page bar's tab slot. A finished
 * step shows a check and can be clicked to go back; later steps wait their turn.
 */
function JobSteps({ steps, current, disabled, onSelect }: {
  steps: { id: number; title: string; icon: typeof Layers }[];
  current: number;
  disabled: boolean;
  onSelect: (step: 1 | 2 | 3) => void;
}) {
  return (
    <ol className="flex items-center gap-1">
      {steps.map((step, index) => {
        const done = step.id < current;
        const isCurrent = step.id === current;
        const Icon = done ? CircleCheck : step.icon;
        return (
          <li key={step.id} className="flex items-center gap-1">
            {index > 0 ? <ChevronRight aria-hidden className="size-3.5 text-muted-foreground/60" /> : null}
            <button
              type="button"
              disabled={!done || disabled}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onSelect(step.id as 1 | 2 | 3)}
              className={cn(
                "inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm transition-colors",
                isCurrent ? "bg-muted font-medium text-foreground" : done ? "text-foreground hover:bg-muted/60" : "text-muted-foreground",
              )}
            >
              <Icon aria-hidden className={cn("size-3.5", done && "ink-success")} />
              {/* On a narrow page only the current step keeps its name; the others keep their icon. */}
              <span className={cn(!isCurrent && "@max-md:sr-only")}>{step.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
