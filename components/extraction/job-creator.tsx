"use client";
"use no memo"; // try/finally in handlers

import { useRef, useState, useMemo } from "react";
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
  Check,
  Loader2,
  Layers,
  FileText,
  Zap,
} from "lucide-react";
import { useExtractionStore } from "@/lib/store/extraction";
import { useBucketStore } from "@/lib/store/bucket";
import { QuestionBuilder } from "./question-builder";
import { SourceSelector } from "./source-selector";
import { SourceSummary } from "./source-summary";
import { BucketIndicator } from "./bucket/bucket-indicator";
import { BucketDrawer } from "./bucket/bucket-drawer";
import { useAppToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

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

export function JobCreator() {
  const router = useRouter();
  const toast = useAppToast();
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const [stepRaw, setStepRaw] = useQueryState(
    "step",
    parseAsInteger.withDefault(1).withOptions({ history: "push" }),
  );
  const [direction, setDirection] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bucketOpen, setBucketOpen] = useState(false);
  const bucketIndicatorRef = useRef<HTMLButtonElement>(null);

  const validStep = Math.min(3, Math.max(1, stepRaw)) as 1 | 2 | 3;

  const { draftJob, setDraftJobName, clearDraftJob } = useExtractionStore();
  const bucketOrder = useBucketStore((s) => s.order);
  const bucketItemsMap = useBucketStore((s) => s.items);
  const clearBucket = useBucketStore((s) => s.clear);
  const startExtraction = useMutation(api.extraction.mutations.startExtraction);

  const steps = useMemo(() => [
    { id: 1, title: t("jobDetails"), icon: Layers, description: t("nameYourJob") },
    { id: 2, title: t("selectPapers"), icon: FileText, description: t("chooseFromHistory") },
    { id: 3, title: t("defineQuestions"), icon: Zap, description: t("whatToExtract") },
  ], [t]);

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

  const handleSubmit = async () => {
    if (readyBucketItems.length === 0) {
      toast.validation.failed(t("pleaseSelectSource"));
      return;
    }
    if (draftJob.questions.length === 0) {
      toast.validation.failed(t("pleaseCompleteSteps"));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await startExtraction({
        name: draftJob.name || t("untitledJob"),
        bucketItems: readyBucketItems.map((item) => {
          const meta = (item.sourceMeta ?? {}) as Record<string, unknown>;
          return {
            bucketKey: item.bucketKey,
            source: item.source,
            sourceRefId: item.sourceRefId,
            title: item.title,
            authors: item.authors,
            year: item.year,
            doi: item.doi,
            openalexId: item.openalexId,
            abstract: item.abstract,
            storageId: item.storageId,
            pdfUrl: item.pdfUrl,
            searchFilters:
              item.source === "history"
                ? (meta.searchFilters as never)
                : undefined,
            libraryType:
              item.source === "zotero"
                ? (meta.libraryType as "user" | "group" | undefined)
                : undefined,
            groupId:
              item.source === "zotero"
                ? (meta.groupId as string | undefined)
                : undefined,
            zoteroUserId:
              item.source === "zotero"
                ? (meta.zoteroUserId as string | undefined)
                : undefined,
            collectionKey:
              item.source === "zotero"
                ? (meta.collectionKey as string | undefined)
                : undefined,
          };
        }),
        questions: draftJob.questions.map((q, i) => ({
          key: q.key || `q_${i}`,
          question: q.question,
          type: q.type,
          description: q.description,
        })),
      });

      clearDraftJob();
      clearBucket();
      router.push(`/extraction/${result.jobId}`);
    } catch (error) {
      toast.job.createFailed(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceed = () => {
    switch (validStep) {
      case 1:
        return draftJob.name.trim().length > 0;
      case 2:
        return readyBucketItems.length > 0;
      case 3:
        return draftJob.questions.length > 0;
      default:
        return false;
    }
  };

  return (
    <div className="w-full p-4 md:p-6">
      {/* Header with Cancel */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/extraction")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {tc("cancel")}
        </Button>

        <div className="flex items-center gap-3">
          <BucketIndicator
            ref={bucketIndicatorRef}
            onClick={() => setBucketOpen(true)}
          />
          <div className="text-sm text-muted-foreground">
            {t("stepOfThree", { step: validStep, total: 3 })}
          </div>
        </div>
      </motion.div>

      <BucketDrawer open={bucketOpen} onOpenChange={setBucketOpen} />

      {/* Step Progress - Horizontal Timeline */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="mb-12"
      >
        <div className="flex items-center justify-between relative"
        >
          {/* Progress Line */}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-muted rounded-full">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: "0%" }}
              animate={{ width: `${((validStep - 1) / (steps.length - 1)) * 100}%` }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>

          {/* Step Indicators */}
          {steps.map((s, i) => {
            const isActive = validStep >= s.id;
            const isCurrent = validStep === s.id;

            return (
              <motion.div
                key={s.id}
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, delay: i * 0.1 }}
                className="relative z-10 flex flex-col items-center"
              >
                <motion.div
                  animate={{
                    scale: isCurrent ? 1.1 : 1,
                    backgroundColor: isActive ? "hsl(var(--primary))" : "hsl(var(--muted))",
                  }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center shadow-lg",
                    isActive ? "text-primary-foreground" : "text-muted-foreground"
                  )}
                >
                  {isActive && validStep > s.id ? (
                    <Check className="w-6 h-6 text-muted-foreground opacity-50" />
                  ) : (
                    <s.icon className="w-5 h-5 text-muted-foreground" />
                  )}
                </motion.div>
                <div className="mt-3 text-center">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      isCurrent ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {s.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.description}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

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
                    {t("nameYourJob")}
                  </h2>
                  <p className="text-muted-foreground">
                    {t("nameYourJobDescription")}
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
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

                 <SourceSelector />
              </div>
            )}

            {validStep === 3 && (
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
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer Actions */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-12 pt-6 border-t border-border flex justify-between items-center"
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
              {t("startExtraction")}
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
  );
}
