"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams } from "next/navigation";
import { Step1 } from "@/components/steps/Step1";
import { Step2 } from "@/components/steps/Step2";
import { Step3 } from "@/components/steps/Step3";
import { Step4 } from "@/components/steps/Step4";
import { Step5 } from "@/components/steps/Step5";
import { ReviewProvider, useReview } from "@/components/review/ReviewProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion, AnimatePresence } from "framer-motion";

function ReviewContent() {
  const reviewContext = useReview();
  const { review, currentStep, isLoading, errors, loadReview } = reviewContext;
  const params = useParams();
  const reviewId = parseInt(params.id as string);
  const [hasAttemptedLoad, setHasAttemptedLoad] = useState(false);

  useEffect(() => {
    if (reviewId && !hasAttemptedLoad) {
      setHasAttemptedLoad(true);
      loadReview(reviewId);
    }

    // Scroll to top when component mounts or reviewId changes
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }, [reviewId, loadReview, hasAttemptedLoad]);

  if (isLoading) {
    return (
      <motion.div
        className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
          style={{ transformOrigin: 'center center', willChange: 'transform' }}
        >
          <Card className="w-full max-w-md">
            <CardContent className="flex flex-col items-center justify-center p-8">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                style={{ willChange: 'transform' }}
              >
                <Loader2 className="h-8 w-8 mb-4 text-primary" />
              </motion.div>
              <motion.h3
                className="text-lg font-semibold mb-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.2 }}
              >
                Loading Review
              </motion.h3>
              <motion.p
                className="text-sm text-muted-foreground text-center"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.3 }}
              >
                Please wait while we load your systematic review data...
              </motion.p>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    );
  }

  // Only show "Review not found" if we've attempted to load and still don't have a review
  if (!review && hasAttemptedLoad && !isLoading) {
    return (
      <motion.div
        className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <Card className="w-full max-w-md">
            <CardContent className="flex items-center justify-center p-8">
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.1 }}
              >
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Review not found. Please check the URL and try again.
                  </AlertDescription>
                </Alert>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    );
  }

  const renderCurrentStep = () => {
    if (!currentStep || !review) {
      return (
        <motion.div
          className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{ transformOrigin: 'center center', willChange: 'transform' }}
          >
            <Card className="w-full max-w-md">
              <CardContent className="flex items-center justify-center p-8">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  style={{ willChange: 'transform' }}
                >
                  <Loader2 className="h-8 w-8 mb-4 text-primary" />
                </motion.div>
                <motion.p
                  className="text-sm text-muted-foreground"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                >
                  Loading step...
                </motion.p>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
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

      case "search_execution":
        return (
          <Step5
            {...stepProps}
            researchQuestion={review.researchQuestion || ""}
          />
        );

      default:
        return (
          <motion.div
            className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <Card className="w-full max-w-md">
                <CardContent className="flex items-center justify-center p-8">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                  >
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        This step is not yet implemented.
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        );
    }
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`step-${currentStep || 'loading'}`}
        className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
      >
        {/* Main Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
        >
          {renderCurrentStep()}
        </motion.div>

        {/* Error Display */}
        {errors.length > 0 && (
          <motion.div
            className="fixed bottom-4 right-4 max-w-sm"
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {errors.map((error: { message: string; timestamp: Date }, index: number) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
              >
                <Alert className="mb-2 border-red-200 bg-red-50">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800">
                    {error.message}
                  </AlertDescription>
                </Alert>
              </motion.div>
            ))}
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

export default function ReviewPage() {
  return (
    <ReviewProvider>
      <Suspense fallback={
        <motion.div
          className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{ transformOrigin: 'center center', willChange: 'transform' }}
          >
            <Card className="w-full max-w-md">
              <CardContent className="flex flex-col items-center justify-center p-8">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                  <Loader2 className="h-8 w-8 mb-4 text-primary" />
                </motion.div>
                <motion.h3
                  className="text-lg font-semibold mb-2"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                >
                  Loading
                </motion.h3>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      }>
        <ReviewContent />
      </Suspense>
    </ReviewProvider>
  );
}
