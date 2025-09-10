"use client";

import { useReview } from "./ReviewProvider";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { isFirstStep, isLastStep } from "@/lib/repo";

interface StepNavigationProps {
  showBack?: boolean;
  showNext?: boolean;
  className?: string;
}

export function StepNavigation({
  showBack = true,
  showNext = true,
  className = ""
}: StepNavigationProps) {
  const { currentStep, isSaving, review, goToPreviousStep, goToNextStep } = useReview();

  if (!review) return null;

  const canGoBack = showBack && currentStep && !isFirstStep(currentStep);
  const canGoNext = showNext && currentStep && !isLastStep(currentStep);

  return (
    <div className={`flex items-center justify-between ${className}`}>
      {/* Back button */}
      <div>
        {canGoBack ? (
          <Button
            variant="outline"
            onClick={goToPreviousStep}
            disabled={isSaving}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Previous Step
          </Button>
        ) : (
          <div /> // Empty div for spacing
        )}
      </div>

      {/* Next/Save button */}
      <div>
        {canGoNext ? (
          <Button
            onClick={goToNextStep}
            disabled={isSaving}
            className="flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Next Step
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        ) : (
          <div /> // Empty div for spacing
        )}
      </div>
    </div>
  );
}
