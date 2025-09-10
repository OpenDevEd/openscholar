"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams } from "next/navigation";
import { Step1 } from "@/components/steps/Step1";
import { Step2 } from "@/components/steps/Step2";
import { Step3 } from "@/components/steps/Step3";
import { Step4 } from "@/components/steps/Step4";
import { ReviewProvider, useReview } from "@/components/review/ReviewProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

function ReviewContent() {
  const reviewContext = useReview();
  const { review, currentStep, isLoading, errors, loadReview } = reviewContext;
  const params = useParams();
  const reviewId = parseInt(params.id as string);

  useEffect(() => {
    if (reviewId) {
      loadReview(reviewId);
    }

    // Scroll to top when component mounts or reviewId changes
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }, [reviewId, loadReview]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin mb-4" />
            <h3 className="text-lg font-semibold mb-2">Loading Review</h3>
            <p className="text-sm text-muted-foreground text-center">
              Please wait while we load your systematic review data...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center p-8">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Review not found. Please check the URL and try again.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  const renderCurrentStep = () => {
    if (!currentStep || !review) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center">
          <Card className="w-full max-w-md">
            <CardContent className="flex items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <p className="text-sm text-muted-foreground">Loading step...</p>
            </CardContent>
          </Card>
        </div>
      );
    }

    const stepProps = {
      researchQuestion: review.researchQuestion || "",
      onContinue: () => {
        reviewContext.goToNextStep();
      },
      onBack: () => {
        reviewContext.goToPreviousStep();
      },
    };

    switch (currentStep) {
      case "research_question":
        return <Step1 {...stepProps} />;

      case "search_terms":
        return (
          <Step2
            {...stepProps}
            researchQuestion={review.researchQuestion || ""}
          />
        );

      case "screening_questions":
        return (
          <Step3
            {...stepProps}
            researchQuestion={review.researchQuestion || ""}
          />
        );

      case "data_extraction_questions":
        return (
          <Step4
            {...stepProps}
            researchQuestion={review.researchQuestion || ""}
          />
        );

      default:
        return (
          <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center">
            <Card className="w-full max-w-md">
              <CardContent className="flex items-center justify-center p-8">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    This step is not yet implemented.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Main Content */}
      {renderCurrentStep()}

      {/* Error Display */}
      {errors.length > 0 && (
        <div className="fixed bottom-4 right-4 max-w-sm">
          {errors.map((error: { message: string; timestamp: Date }, index: number) => (
            <Alert key={index} className="mb-2 border-red-200 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                {error.message}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReviewPage() {
  return (
    <ReviewProvider>
      <Suspense fallback={
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center">
          <Card className="w-full max-w-md">
            <CardContent className="flex flex-col items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <h3 className="text-lg font-semibold mb-2">Loading</h3>
            </CardContent>
          </Card>
        </div>
      }>
        <ReviewContent />
      </Suspense>
    </ReviewProvider>
  );
}
