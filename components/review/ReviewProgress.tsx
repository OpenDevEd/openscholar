"use client";

import { useReview } from "./ReviewProvider";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Clock, AlertCircle, Save } from "lucide-react";
import { Step } from "@/db/schema";
import { STEP_ORDER, STEP_LABELS } from "@/lib/repo";

export function ReviewProgress() {
  const { review, currentStep, isSaving, lastSaved } = useReview();

  if (!review || !currentStep) return null;

  const currentStepIndex = STEP_ORDER.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / STEP_ORDER.length) * 100;

  const getStepStatus = (step: Step, index: number): 'completed' | 'current' | 'pending' => {
    if (index < currentStepIndex) return 'completed';
    if (index === currentStepIndex) return 'current';
    return 'pending';
  };

  const getStepIcon = (status: 'completed' | 'current' | 'pending') => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'current':
        return <Clock className="h-4 w-4 text-blue-600 animate-pulse" />;
      case 'pending':
        return <div className="h-4 w-4 rounded-full border-2 border-gray-300" />;
    }
  };

  return (
    <div className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
      <div className="container max-w-4xl mx-auto px-4 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold">{review.title || "Systematic Review"}</h1>
            <p className="text-sm text-muted-foreground">
              Step {currentStepIndex + 1} of {STEP_ORDER.length}: {STEP_LABELS[currentStep]}
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Saving indicator */}
            {isSaving && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Save className="h-3 w-3 animate-pulse" />
                <span>Saving...</span>
              </div>
            )}

            {/* Last saved */}
            {lastSaved && !isSaving && (
              <div className="text-xs text-muted-foreground">
                Last saved: {lastSaved.toLocaleTimeString()}
              </div>
            )}

            {/* Status badge */}
            <Badge variant={review.status === 'completed' ? 'default' : 'secondary'}>
              {(review.status || 'draft').replace('_', ' ').toUpperCase()}
            </Badge>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="text-xs text-muted-foreground text-center">
            {Math.round(progress)}% Complete
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-between mt-4 overflow-x-auto">
          {STEP_ORDER.slice(0, 4).map((step, index) => {
            const status = getStepStatus(step, index);
            return (
              <div key={step} className="flex flex-col items-center min-w-0 flex-1">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full mb-1 ${
                  status === 'completed' ? 'bg-green-100' :
                  status === 'current' ? 'bg-blue-100' : 'bg-gray-100'
                }`}>
                  {getStepIcon(status)}
                </div>
                <div className="text-xs text-center leading-tight max-w-20 truncate">
                  {STEP_LABELS[step]}
                </div>
                {status === 'current' && (
                  <div className="w-2 h-2 bg-blue-600 rounded-full mt-1 animate-pulse" />
                )}
              </div>
            );
          })}

          {STEP_ORDER.length > 4 && (
            <div className="flex flex-col items-center min-w-0 flex-1">
              <div className="flex items-center justify-center w-8 h-8 rounded-full mb-1 bg-gray-100">
                <span className="text-xs font-medium text-gray-500">
                  +{STEP_ORDER.length - 4}
                </span>
              </div>
              <div className="text-xs text-center leading-tight">
                More Steps
              </div>
            </div>
          )}
        </div>

        {/* Current step details */}
        <div className="mt-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium">Current Step</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {getStepDescription(currentStep)}
          </p>
        </div>
      </div>
    </div>
  );
}

function getStepDescription(step: Step): string {
  switch (step) {
    case "research_question":
      return "Define your research question clearly to guide the entire systematic review process.";
    case "search_terms":
      return "Generate boolean search terms to find relevant literature in academic databases.";
    case "screening_questions":
      return "Create questions to screen papers by title and abstract for relevance.";
    case "data_extraction_questions":
      return "Set up questions for extracting data from included studies.";
    case "search_execution":
      return "Execute searches across multiple databases and collect results.";
    case "screening":
      return "Review search results and exclude irrelevant papers.";
    case "data_extraction":
      return "Extract data from included studies using your predefined questions.";
    case "completed":
      return "Your systematic review is complete! Review and export your findings.";
    default:
      return "Continue with your systematic review process.";
  }
}
