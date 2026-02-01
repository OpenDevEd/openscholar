"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useExtractionStore } from "@/lib/store/extraction";
import { useSearchHistoryStore } from "@/lib/store";
import { QuestionBuilder } from "./question-builder";
import { HistorySelector } from "./history-selector";
import { toast } from "sonner";

interface JobCreatorProps {
  onCancel: () => void;
}

export function JobCreator({ onCancel }: JobCreatorProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { draftJob, setDraftJobName, clearDraftJob } = useExtractionStore();
  const startExtraction = useMutation(api.extraction.mutations.startExtraction);
  const searchHistory = useSearchHistoryStore((state) => state.searchHistory);

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

    const historyEntry = searchHistory.find((h: any) => h.id === draftJob.selectedHistoryId);
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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <CardTitle>Create Extraction Job</CardTitle>
              <CardDescription>
                Step {step} of 3: {" "}
                {step === 1 && "Job Details"}
                {step === 2 && "Select Papers"}
                {step === 3 && "Define Questions"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Step 1: Job Details */}
          {step === 1 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="name">Job Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., RCT Data Extraction"
                  value={draftJob.name}
                  onChange={(e) => setDraftJobName(e.target.value)}
                />
              </div>
            </motion.div>
          )}

          {/* Step 2: Select Papers */}
          {step === 2 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <HistorySelector />
            </motion.div>
          )}

          {/* Step 3: Define Questions */}
          {step === 3 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <QuestionBuilder />
            </motion.div>
          )}
        </CardContent>

        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={handleBack}>
            {step === 1 ? "Cancel" : "Back"}
          </Button>

          {step < 3 ? (
            <Button onClick={handleNext} disabled={!canProceed()}>
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!canProceed() || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Start Extraction
                </>
              )}
            </Button>
          )}
        </CardFooter>
      </Card>
    </motion.div>
  );
}
