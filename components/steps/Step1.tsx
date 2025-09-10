"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { HelpCircle, Lightbulb } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StepLayout } from "./StepLayout";
import { StepHeader } from "./StepHeader";
import { NavigationButtons } from "./NavigationButtons";
import { InfoSection } from "./InfoSection";
import { useReview } from "@/components/review/ReviewProvider";

interface Step1Props {
  researchQuestion?: string;
  onContinue?: () => void;
}

export function Step1({ researchQuestion: propResearchQuestion, onContinue }: Step1Props) {
  const { review, isSaving, saveResearchQuestion, goToNextStep } = useReview();

  // Use local state for the research question input
  const [localResearchQuestion, setLocalResearchQuestion] = useState(
    propResearchQuestion || review?.researchQuestion || ""
  );

  // Update local state when review data changes
  useEffect(() => {
    if (review?.researchQuestion) {
      setLocalResearchQuestion(review.researchQuestion);
    }
  }, [review?.researchQuestion]);

  const handleContinue = async () => {
    if (localResearchQuestion.trim() && review) {
      try {
        await saveResearchQuestion(localResearchQuestion);
        goToNextStep();
      } catch (error) {
        console.error("Failed to save research question:", error);
      }
    }
  };

  const handleResearchQuestionChange = (value: string) => {
    setLocalResearchQuestion(value);
    // Auto-save will be triggered by the ReviewProvider for unsaved changes
  };

  return (
    <StepLayout>
      <StepHeader
        stepNumber={1}
        totalSteps={4}
        title="Define Your Research Question"
        description="Start your systematic review by clearly defining what you want to investigate"
      />

      {/* Main Card */}
      <Card className="max-w-2xl mx-auto shadow-xl border-0 bg-card/80 backdrop-blur-sm">
        <CardHeader className="text-center pb-6">
          <div className="flex items-center justify-center mb-4">
            <div className="p-3 rounded-full bg-primary/10">
              <Lightbulb className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-semibold">
            What is your research question?
          </CardTitle>
          <CardDescription className="text-base">
            Be specific about what you want to explore. A clear question will guide your entire review process.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="research-question" className="text-base font-medium">
                Research Question
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Write your research question in a clear, focused way. For example: "What are the effects of exercise on mental health in adults?"</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Textarea
              id="research-question"
              placeholder="e.g., What are the impacts of social media on adolescent mental health?"
              value={localResearchQuestion}
              onChange={(e) => handleResearchQuestionChange(e.target.value)}
              className="min-h-[120px] text-base resize-none border-2 focus:border-primary/50 transition-colors"
              maxLength={500}
              disabled={isSaving}
            />
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>Be specific and focused</span>
              <span>{localResearchQuestion.length}/500</span>
            </div>
          </div>

          {/* Example Questions */}
          <div className="bg-muted/50 rounded-lg p-4 border border-border/50">
            <h4 className="font-medium mb-4 flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              Example Research Questions
            </h4>
            <div className="">
              <button
                onClick={() => handleResearchQuestionChange("What are the effects of mindfulness meditation on anxiety symptoms in adults?")}
                className="w-full text-left p-2 rounded-md hover:bg-background transition-colors border border-transparent hover:border-border/50"
              >
                <p className="text-sm leading-relaxed">
                  "What are the effects of mindfulness meditation on anxiety symptoms in adults?"
                </p>
              </button>
              <button
                onClick={() => handleResearchQuestionChange("How does parental involvement influence academic achievement in elementary school children?")}
                className="w-full text-left p-2 rounded-md hover:bg-background transition-colors border border-transparent hover:border-border/50"
              >
                <p className="text-sm leading-relaxed">
                  "How does parental involvement influence academic achievement in elementary school children?"
                </p>
              </button>
              <button
                onClick={() => handleResearchQuestionChange("What interventions are most effective for reducing workplace stress?")}
                className="w-full text-left p-2 rounded-md hover:bg-background transition-colors border border-transparent hover:border-border/50"
              >
                <p className="text-sm leading-relaxed">
                  "What interventions are most effective for reducing workplace stress?"
                </p>
              </button>
            </div>
          </div>
        </CardContent>

        <CardFooter>
          <NavigationButtons
            onContinue={handleContinue}
            continueText="Continue to Step 2"
            continueDisabled={!localResearchQuestion.trim() || isSaving}
            showBack={false}
            isLoading={isSaving}
          />
        </CardFooter>
      </Card>

      {/* Tips Section */}
      <div className="max-w-2xl mx-auto mt-8">
        <InfoSection
          title="Tips for a Good Research Question"
          variant="tips"
          content={
            <ul className="space-y-2">
              <li>• Be specific about the population, intervention, or phenomenon you're studying</li>
              <li>• Make it answerable through research evidence</li>
              <li>• Consider the scope - not too broad, not too narrow</li>
              <li>• Think about what would be practically useful to know</li>
            </ul>
          }
        />
      </div>
    </StepLayout>
  );
}
