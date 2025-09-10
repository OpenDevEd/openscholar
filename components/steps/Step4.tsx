"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Brain,
  Filter,
  RefreshCw,
  HelpCircle,
  Target,
  ToggleLeft,
  Hash,
  Type,
  List
} from "lucide-react";
import type { ScreeningQuestion, ScreeningQuestionType } from "@/lib/store";
import { StepLayout } from "./StepLayout";
import { StepHeader } from "./StepHeader";
import { ResearchQuestionDisplay } from "./ResearchQuestionDisplay";
import { LoadingState } from "./LoadingState";
import { ResultsHeader } from "./ResultsHeader";
import { NavigationButtons } from "./NavigationButtons";
import { InfoSection } from "./InfoSection";
import { QuestionManager } from "./QuestionManager";
import { useReview } from "@/components/review/ReviewProvider";

interface Step4Props {
  researchQuestion?: string;
  onContinue?: () => void;
  onBack?: () => void;
}

export function Step4({ researchQuestion: propResearchQuestion, onContinue, onBack }: Step4Props) {
  const { review, isSaving, generateAndSaveDataExtractionQuestions, goToPreviousStep, goToNextStep, addCustomDataExtractionQuestion, removeDataExtractionQuestion, editDataExtractionQuestion } = useReview();
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [questionGenerationProgress, setQuestionGenerationProgress] = useState(0);
  const [customQuestionType, setCustomQuestionType] = useState<ScreeningQuestionType>("boolean");

  // Use data extraction questions from review context
  const aiQuestions = review?.dataExtractionQuestions || [];

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
      await generateAndSaveDataExtractionQuestions();
      setQuestionGenerationProgress(100);
    } catch (error) {
      console.error('Failed to generate data extraction questions:', error);
    } finally {
      clearInterval(progressInterval);
      setIsGeneratingQuestions(false);
    }
  };

  const removeQuestion = (index: number) => {
    if (review) {
      removeDataExtractionQuestion(review.id, index);
    }
  };

  const regenerateQuestions = () => {
    handleGenerate();
  };

  const getTypeIcon = (type: ScreeningQuestionType) => {
    switch (type) {
      case 'boolean':
        return <ToggleLeft className="h-3 w-3" />;
      case 'number':
        return <Hash className="h-3 w-3" />;
      case 'string':
        return <Type className="h-3 w-3" />;
      case 'array':
        return <List className="h-3 w-3" />;
      default:
        return <HelpCircle className="h-3 w-3" />;
    }
  };

  useEffect(() => {
    if (aiQuestions.length === 0 && review && !isGeneratingQuestions) {
      handleGenerate();
    }
  }, [review, aiQuestions.length, isGeneratingQuestions]);

  return (
    <StepLayout>
      <StepHeader
        stepNumber={4}
        totalSteps={4}
        title="Data Extraction Questions"
        description="AI-generated questions with different response types for comprehensive data collection"
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
              title="Generating Data Extraction questions..."
              description="Creating questions with different response types for comprehensive analysis"
              colorScheme="purple"
              skeletonCount={4}
              autoProgress={false}
              progress={questionGenerationProgress}
            />
            ) : (
              <div className="space-y-6">
                <ResultsHeader
                  icon={Brain}
                  title="Data Extraction Questions Ready"
                  subtitle={`${aiQuestions.length} questions with varied response types`}
                  count={aiQuestions.length}
                  countLabel="questions"
                  onRegenerate={regenerateQuestions}
                  colorScheme="purple"
                />

                <QuestionManager
                  questions={aiQuestions}
                  onAddQuestion={(question, type) => {
                    if (review && question.trim()) {
                      addCustomDataExtractionQuestion(review.id, question.trim(), type || "boolean");
                      setCustomQuestionType("boolean");
                    }
                  }}
                  onEditQuestion={(index, question, type) => {
                    if (review) {
                      editDataExtractionQuestion(review.id, index, question, type);
                    }
                  }}
                  onRemoveQuestion={removeQuestion}
                  customQuestionType={customQuestionType}
                  onCustomQuestionTypeChange={setCustomQuestionType}
                  placeholder="Enter a custom question..."
                  addButtonText="Add Question"
                  showQuestionTypes={true}
                  getQuestionIcon={(question) => {
                    if (typeof question === "string") return <HelpCircle className="h-3 w-3 text-purple-600 dark:text-purple-400" />;
                    return getTypeIcon(question.type);
                  }}
                  renderQuestionContent={(question, index, isEditing) => {
                    if (typeof question === "string") {
                      return <p className="text-sm leading-relaxed text-foreground font-medium">{question}</p>;
                    }

                    if (isEditing) {
                      // This will be handled by QuestionManager's internal editing UI
                      return null;
                    }

                    return (
                      <div className="space-y-2">
                        <p className="text-sm text-foreground leading-relaxed">
                          {question.question}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Key: <code className="bg-muted px-1 rounded">{question.key}</code></span>
                        </div>
                      </div>
                    );
                  }}
                />

                <InfoSection
                  title="Question Types Explained"
                  variant="info"
                  content={
                    <div className="space-y-1">
                      <p><strong>Boolean:</strong> Yes/No or True/False responses for clear criteria</p>
                      <p><strong>String:</strong> Text responses for descriptive or qualitative data</p>
                      <p><strong>Number:</strong> Numeric values for quantitative measurements</p>
                      <p><strong>Array:</strong> Multiple values or lists for comprehensive categorization</p>
                    </div>
                  }
                />
              </div>
            )}
          </CardContent>

          <CardFooter>
            <NavigationButtons
              onBack={goToPreviousStep}
              onContinue={goToNextStep}
              backText="Back to Step 3"
              continueText="Complete Setup"
              continueDisabled={isGeneratingQuestions || aiQuestions.length === 0 || isSaving}
              isLoading={isGeneratingQuestions || isSaving}
            />
          </CardFooter>
        </Card>
      </StepLayout>
  );
}