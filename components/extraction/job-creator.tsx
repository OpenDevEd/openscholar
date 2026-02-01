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
  Sparkles,
  Layers,
  FileText,
} from "lucide-react";
import { useExtractionStore } from "@/lib/store/extraction";
import { useSearchHistoryStore } from "@/lib/store";
import { QuestionBuilder } from "./question-builder";
import { HistorySelector } from "./history-selector";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface JobCreatorProps {
  onCancel: () => void;
}

export function JobCreator({ onCancel }: JobCreatorProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { draftJob, setDraftJobName, clearDraftJob } = useExtractionStore();
  const startExtraction = useMutation(api.extraction.mutations.startExtraction);
  const searchHistory = useSearchHistoryStore((state) => state.searchHistory);

  const steps = [
    { id: 1, title: "Job Details", icon: Layers },
    { id: 2, title: "Select Papers", icon: FileText },
    { id: 3, title: "Define Questions", icon: Sparkles },
  ];

  const handleNext = () => {
    if (step < 3) {
      setStep((prev) => (prev + 1) as 1 | 2 | 3);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((prev) => (prev - 1) as 1 | 2 | 3);
    } else {
      onCancel();
    }
  };

  const handleSubmit = async () => {
    if (!draftJob.selectedHistoryId || draftJob.questions.length === 0) {
      toast.error("Please complete all steps");
      return;
    }

    const historyEntry = searchHistory.find(
      (h: any) => h.id === draftJob.selectedHistoryId,
    );
    if (!historyEntry) {
      toast.error("Selected history entry not found");
      return;
    }

    setIsSubmitting(true);

    try {
      await startExtraction({
        name: draftJob.name || "Untitled Extraction Job",
        sourceType: "history",
        sourceHistoryId: draftJob.selectedHistoryId,
        searchFilters: {
          query: historyEntry.query,
          field: historyEntry.field,
          yearRange: historyEntry.yearRange,
          dateRange: historyEntry.dateRange,
          filterType: historyEntry.filterType,
          isYearRangeEnabled: historyEntry.isYearRangeEnabled,
          sortBy: historyEntry.sortBy,
          selectedRegions: historyEntry.selectedRegions,
          selectedCountryFocus: historyEntry.selectedCountryFocus,
          ratingRange: historyEntry.ratingRange,
          onlyRatedPapers: historyEntry.onlyRatedPapers,
          citesItemId: historyEntry.citesItemId,
          citedByItemId: historyEntry.citedByItemId,
          relatedToItemId: historyEntry.relatedToItemId,
          reviewFilter: historyEntry.reviewFilter,
          language: historyEntry.language,
        },
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
        return draftJob.selectedHistoryId !== null;
      case 3:
        return draftJob.questions.length > 0;
      default:
        return false;
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Cancel
        </Button>
        <div className="flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                  step === s.id
                    ? "bg-primary text-primary-foreground"
                    : step > s.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground bg-muted/50",
                )}
              >
                <s.icon className="w-3.5 h-3.5" />
                {s.title}
              </div>
              {i < steps.length - 1 && (
                <div className="w-4 h-px bg-border mx-2" />
              )}
            </div>
          ))}
        </div>
        <div className="w-20" /> {/* Spacer for centering */}
      </div>

      <div className="bg-card border border-border/40 rounded-xl shadow-sm min-h-[500px] flex flex-col">
        <div className="flex-1 p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {step === 1 && (
                <div className="max-w-md mx-auto space-y-6 pt-10">
                  <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold">
                      Name your extraction job
                    </h2>
                    <p className="text-muted-foreground">
                      Give this job a descriptive name to help you identify it
                      later.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Job Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g., RCT Data Extraction for Review 2024"
                      value={draftJob.name}
                      onChange={(e) => setDraftJobName(e.target.value)}
                      className="h-12 text-lg"
                      autoFocus
                    />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="h-full">
                  <div className="mb-6">
                    <h2 className="text-xl font-bold">Select Papers</h2>
                    <p className="text-muted-foreground">
                      Choose a search query from your history to extract data
                      from.
                    </p>
                  </div>
                  <HistorySelector />
                </div>
              )}

              {step === 3 && (
                <div className="h-full">
                  <div className="mb-6">
                    <h2 className="text-xl font-bold">Define Questions</h2>
                    <p className="text-muted-foreground">
                      What data points do you want to extract from each paper?
                    </p>
                  </div>
                  <QuestionBuilder />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="p-4 border-t border-border/40 bg-muted/10 flex justify-between items-center rounded-b-xl">
          <Button variant="ghost" onClick={handleBack} disabled={step === 1}>
            Back
          </Button>

          <Button
            onClick={step === 3 ? handleSubmit : handleNext}
            disabled={!canProceed() || isSubmitting}
            className="min-w-[120px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : step === 3 ? (
              <>
                Start Extraction
                <Sparkles className="ml-2 h-4 w-4" />
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
