"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useMutation } from "convex/react";
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
import { Id } from "@/convex/_generated/dataModel";
import { useSearchHistoryStore } from "@/lib/store";
import { QuestionBuilder } from "./question-builder";
import { SourceSelector } from "./source-selector";
import { SourceSummary } from "./source-summary";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface JobCreatorProps {
  onCancel: () => void;
}

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

export function JobCreator({ onCancel }: JobCreatorProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [direction, setDirection] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { draftJob, setDraftJobName, clearDraftJob } = useExtractionStore();
  const startExtraction = useMutation(api.extraction.mutations.startExtraction);
  const searchHistory = useSearchHistoryStore((state) => state.searchHistory);

  const steps = [
    { id: 1, title: "Job Details", icon: Layers, description: "Name your extraction" },
    { id: 2, title: "Select Papers", icon: FileText, description: "Choose from history" },
    { id: 3, title: "Define Questions", icon: Zap, description: "What to extract" },
  ];

  const handleNext = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (step < 3 && canProceed()) {
      setDirection(1);
      setStep((prev) => (prev + 1) as 1 | 2 | 3);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setDirection(-1);
      setStep((prev) => (prev - 1) as 1 | 2 | 3);
    } else {
      onCancel();
    }
  };

  const handleSubmit = async () => {
    const hasHistory = draftJob.selectedHistoryIds.length > 0;
    const hasZotero = (draftJob.zoteroSelection?.items || []).length > 0;
    const hasManual = draftJob.manualItems.length > 0;
    if (!hasHistory && !hasZotero && !hasManual) {
      toast.error("Please select at least one source");
      return;
    }

    if (draftJob.questions.length === 0) {
      toast.error("Please complete all steps");
      return;
    }

    const historyEntries = draftJob.selectedHistoryIds
      .map((id) => searchHistory.find((h: any) => h.id === id))
      .filter(Boolean) as any[];

    if (hasHistory && historyEntries.length === 0) {
      toast.error("Selected history entries not found");
      return;
    }

    setIsSubmitting(true);

    try {
      const sourceHistoryEntries = historyEntries.map((entry) => ({
        historyId: entry.id,
        searchFilters: {
          query: entry.query,
          field: entry.field,
          yearRange: entry.yearRange,
          dateRange: entry.dateRange,
          filterType: entry.filterType,
          isYearRangeEnabled: entry.isYearRangeEnabled,
          sortBy: entry.sortBy,
          selectedRegions: entry.selectedRegions,
          selectedCountryFocus: entry.selectedCountryFocus,
          ratingRange: entry.ratingRange,
          onlyRatedPapers: entry.onlyRatedPapers,
          citesItemId: entry.citesItemId,
          citedByItemId: entry.citedByItemId,
          relatedToItemId: entry.relatedToItemId,
          reviewFilter: entry.reviewFilter,
          language: entry.language,
          searchField: entry.field,
        },
      }));

      await startExtraction({
        name: draftJob.name || "Untitled Extraction Job",
        sourceType: hasHistory && !hasZotero && !hasManual
          ? "history"
          : hasZotero && !hasHistory && !hasManual
          ? "zotero"
          : hasManual && !hasHistory && !hasZotero
          ? "manual"
          : "mixed",
        sourceHistoryEntries: sourceHistoryEntries.length > 0 ? sourceHistoryEntries : undefined,
        sourceZoteroSelection: hasZotero ? draftJob.zoteroSelection || undefined : undefined,
        sourceManualItems: hasManual
          ? draftJob.manualItems.map((item) => ({
              ...item,
              storageId: item.storageId as Id<"_storage"> | undefined,
            }))
          : undefined,
        questions: draftJob.questions.map((q, i) => ({
          key: q.key || `q_${i}`,
          question: q.question,
          type: q.type,
          description: q.description,
        })),
      });

      toast.success("Extraction job started!");
      clearDraftJob();
      onCancel();
    } catch (error) {
      console.error("Failed to start extraction:", error);
      toast.error("Failed to start extraction job");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return draftJob.name.trim().length > 0;
      case 2:
        return (
          (draftJob.selectedHistoryIds ?? []).length > 0 ||
          (draftJob.zoteroSelection?.items ?? []).length > 0 ||
          (draftJob.manualItems ?? []).length > 0
        );
      case 3:
        return draftJob.questions.length > 0;
      default:
        return false;
    }
  };

  return (
    <div className="w-full">
      {/* Header with Cancel */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Cancel
        </Button>

        <div className="text-sm text-muted-foreground">
          Step {step} of 3
        </div>
      </motion.div>

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
              animate={{ width: `${((step - 1) / (steps.length - 1)) * 100}%` }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>

          {/* Step Indicators */}
          {steps.map((s, i) => {
            const isActive = step >= s.id;
            const isCurrent = step === s.id;
            
            return (
              <motion.div
                key={s.id}
                initial={{ scale: 0, opacity: 0 }}
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
                  {isActive && step > s.id ? (
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
            key={step}
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
            {step === 1 && (
              <form onSubmit={handleNext} className="max-w-lg mx-auto">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-center mb-8"
                >
                  <h2 className="text-2xl font-bold text-foreground mb-2">
                    Name your extraction job
                  </h2>
                  <p className="text-muted-foreground">
                    Give this job a descriptive name to help you identify it later.
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
                      Job Name
                    </Label>
                    <Input
                      id="name"
                      placeholder="e.g., RCT Data Extraction for Review 2024"
                      value={draftJob.name}
                      onChange={(e) => setDraftJobName(e.target.value)}
                      className="h-14 text-lg"
                      autoFocus
                    />
                  </div>

                  <div className="pt-4 text-sm text-muted-foreground bg-muted p-4 rounded-lg">
                    <p>
                      <strong className="text-foreground">Tip:</strong> Use a descriptive name that includes the
                      research topic and time period for easy reference.
                    </p>
                  </div>
                </motion.div>
              </form>
            )}

            {step === 2 && (
              <div className="h-full">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mb-6"
                >
                  <h2 className="text-2xl font-bold text-foreground mb-2">
                    Select Papers
                  </h2>
                 <p className="text-muted-foreground">
                   Combine sources from history, Zotero, or manual entries.
                 </p>
                 <SourceSummary />
                </motion.div>

                 <SourceSelector />
              </div>
            )}

            {step === 3 && (
              <div className="h-full">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mb-6"
                >
                  <h2 className="text-2xl font-bold text-foreground mb-2">
                    Define Questions
                  </h2>
                  <p className="text-muted-foreground">
                    What data points do you want to extract from each paper?
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
          {step === 1 ? "Cancel" : "Back"}
        </Button>

        <Button
          onClick={step === 3 ? handleSubmit : handleNext}
          disabled={!canProceed() || isSubmitting}
          size="lg"
          className="min-w-[160px] font-semibold"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Starting...
            </>
          ) : step === 3 ? (
            <>
              Start Extraction
              <Zap className="ml-2 h-4 w-4" />
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </motion.div>
    </div>
  );
}
