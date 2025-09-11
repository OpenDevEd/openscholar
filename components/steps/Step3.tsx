"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Filter, RefreshCw, HelpCircle, Target, Brain } from "lucide-react";
import { StepLayout } from "./StepLayout";
import { StepHeader } from "./StepHeader";
import { ResearchQuestionDisplay } from "./ResearchQuestionDisplay";
import { LoadingState } from "./LoadingState";
import { ResultsHeader } from "./ResultsHeader";
import { NavigationButtons } from "./NavigationButtons";
import { InfoSection } from "./InfoSection";
import { QuestionManager } from "./QuestionManager";
import { useReview } from "@/components/review/ReviewProvider";

interface Step3Props {
  researchQuestion?: string;
  onContinue?: () => void;
  onBack?: () => void;
}

export function Step3({ researchQuestion: propResearchQuestion, onContinue, onBack }: Step3Props) {
  const { review, isSaving, generateAndSaveScreeningQuestions, goToPreviousStep, goToNextStep, addCustomScreeningQuestion, removeScreeningQuestion, editScreeningQuestion } = useReview();
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [questionGenerationProgress, setQuestionGenerationProgress] = useState(0);

  // Use screening questions from review context
  const screeningQuestions = review?.screeningQuestions || [];

  const handleGenerate = async () => {
    if (!review) return;

    setIsGeneratingQuestions(true);
    setQuestionGenerationProgress(0);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setQuestionGenerationProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + Math.random() * 15;
      });
    }, 200);

    try {
      await generateAndSaveScreeningQuestions();
      setQuestionGenerationProgress(100);
    } catch (error) {
      console.error('Failed to generate screening questions:', error);
    } finally {
      clearInterval(progressInterval);
      setIsGeneratingQuestions(false);
    }
  };

  const addCustomQuestion = (question: string) => {
    if (review && question.trim()) {
      addCustomScreeningQuestion(review.id, question.trim());
    }
  };

  const removeQuestion = (index: number) => {
    if (review) {
      removeScreeningQuestion(review.id, index);
    }
  };

  useEffect(() => {
    if (screeningQuestions.length === 0 && review && !isGeneratingQuestions) {
      handleGenerate();
    }
  }, [review, screeningQuestions.length, isGeneratingQuestions]);

  return (
    <StepLayout>
      <StepHeader
        stepNumber={3}
        totalSteps={4}
        title="Screening Questions"
        description="AI-generated questions to help screen research papers by title and abstract"
      />

      {/* Main Content */}
      <Card className="max-w-4xl mx-auto shadow-xl border-0 bg-card/80 backdrop-blur-sm">
        <CardContent className="pt-6 space-y-6">
          <ResearchQuestionDisplay
            researchQuestion={review?.researchQuestion || propResearchQuestion || ""}
          />

          {isGeneratingQuestions ? (
            <LoadingState
              icon={Brain}
              title="Generating screening questions..."
              description="Analyzing your research question and creating targeted screening criteria"
              colorScheme="purple"
              skeletonCount={4}
              autoProgress={false}
              progress={questionGenerationProgress}
            />
            ) : (
              <div className="space-y-6">
                <ResultsHeader
                  icon={Filter}
                  title="Screening Questions Ready"
                  subtitle={`${screeningQuestions.length} questions generated`}
                  count={screeningQuestions.length}
                  countLabel="questions"
                  onRegenerate={handleGenerate}
                  colorScheme="purple"
                />

                <QuestionManager
                  questions={screeningQuestions}
                  onAddQuestion={addCustomQuestion}
                  onEditQuestion={(index, question) => {
                    if (review) {
                      editScreeningQuestion(review.id, index, question);
                    }
                  }}
                  onRemoveQuestion={removeQuestion}
                  placeholder="Enter a custom screening question..."
                  addButtonText="Add Question"
                  getQuestionIcon={() => <HelpCircle className="h-3 w-3 text-purple-600 dark:text-purple-400" />}
                />

                <InfoSection
                  title="How Screening Works"
                  variant="info"
                  content={
                    <p>
                      These questions will be used to screen research papers based on their titles and abstracts.
                      Papers that don't meet the screening criteria will be filtered out, leaving only the most relevant studies for your review.
                    </p>
                  }
                />
              </div>
            )}
          </CardContent>

          <CardFooter>
            <NavigationButtons
              onBack={goToPreviousStep}
              onContinue={goToNextStep}
              backText="Back to Step 2"
              continueText="Continue to Step 4"
              continueDisabled={isGeneratingQuestions || screeningQuestions.length === 0 || isSaving}
              isLoading={isGeneratingQuestions || isSaving}
            />
          </CardFooter>
        </Card>
      </StepLayout>
  );
}
