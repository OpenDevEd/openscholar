"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Sparkles, HelpCircle, X, TestTube, Play } from "lucide-react";
import { useSearchHistoryStore, useAIConfigStore } from "@/lib/store";
import type { ScreeningQuestionEntry } from "@/lib/types";
import { toast } from "sonner";
import { generateScreeningQuestions } from "@/app/actions/ai-enhance";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";

interface ScreeningQuestionsProps {
  searchId: string;
  className?: string;
}

export function ScreeningQuestions({
  searchId,
  className,
}: ScreeningQuestionsProps) {
  const [newQuestion, setNewQuestion] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const {
    getSearchResult,
    addScreeningQuestion,
    removeScreeningQuestion,
    clearScreeningQuestions,
    removeScreeningQuestionFromAllPapers,
  } = useSearchHistoryStore();
  const { provider, apiKey } = useAIConfigStore();

  const searchResult = getSearchResult(searchId);
  const screeningQuestions = searchResult?.screeningQuestions || [];

  // Get research question from question history or use the search query as fallback
  const lastQuestionFromHistory =
    searchResult?.questionHistory?.[searchResult.questionHistory.length - 1]
      ?.question;
  const searchQuery = searchResult?.query || "";
  const researchQuestion =
    lastQuestionFromHistory ||
    (searchQuery
      ? validateAndExpandKeywordsSilently(searchQuery).expandedQuery
      : "");

  const handleAddQuestion = async () => {
    if (!newQuestion.trim()) {
      toast.error("Please enter a question");
      return;
    }

    // Check for duplicates
    const duplicate = (screeningQuestions || []).find(
      (q) => q.question.toLowerCase() === newQuestion.trim().toLowerCase()
    );
    if (duplicate) {
      toast.error("This question already exists");
      return;
    }

    setIsAdding(true);
    try {
      addScreeningQuestion(searchId, newQuestion.trim());
      setNewQuestion("");
      toast.success("Question added successfully");
    } catch (error) {
      toast.error("Failed to add question");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteQuestion = (questionIndex: number, question: string) => {
    const truncatedQuestion =
      question.length > 50 ? question.substring(0, 50) + "..." : question;
    removeScreeningQuestion(searchId, questionIndex);
    toast.success("Question deleted");
  };

  const handleTestQuestion = (question: string) => {
    const truncatedQuestion =
      question.length > 50 ? question.substring(0, 50) + "..." : question;
    removeScreeningQuestionFromAllPapers(searchId, question);
    toast.success(`Removed "${truncatedQuestion}" from all paper responses`);
  };

  const handleTestAllQuestions = () => {
    if (screeningQuestions.length === 0) {
      toast.info("No questions to test");
      return;
    }

    // Remove all questions from all paper responses
    screeningQuestions.forEach((questionEntry) => {
      removeScreeningQuestionFromAllPapers(searchId, questionEntry.question);
    });

    toast.success(
      `Removed all ${screeningQuestions.length} questions from paper responses`
    );
  };

  const handleClearAllQuestions = () => {
    if (screeningQuestions.length === 0) {
      toast.info("No questions to clear");
      return;
    }

    clearScreeningQuestions(searchId);
    toast.success(
      `Cleared all ${screeningQuestions.length} screening questions`
    );
  };

  const handleGenerateWithAI = async () => {
    if (!apiKey) {
      toast.error("Please configure your AI API key first");
      return;
    }

    if (!researchQuestion.trim()) {
      toast.error(
        "No research question available for generating screening questions"
      );
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateScreeningQuestions(
        researchQuestion,
        (screeningQuestions || []).map((q) => q.question),
        provider,
        apiKey
      );

      // Add each generated question to the screening questions
      let addedCount = 0;
      for (const question of result.questions) {
        try {
          addScreeningQuestion(searchId, question.trim());
          addedCount++;
        } catch (error) {
          // Skip duplicates or other errors
          console.warn("Failed to add question:", question, error);
        }
      }

      if (addedCount > 0) {
        toast.success(
          `Added ${addedCount} new screening question${
            addedCount > 1 ? "s" : ""
          }`
        );
      } else {
        toast.warning("No new questions were generated (may be duplicates)");
      }
    } catch (error) {
      console.error("Error generating screening questions:", error);
      toast.error("Failed to generate screening questions. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAddQuestion();
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Question Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add Screening Question
          </CardTitle>
        </CardHeader>
        <CardContent className="">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="screening-question">Question</Label>
              <Input
                id="screening-question"
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Enter a screening question..."
                disabled={isAdding}
                className="text-base"
              />
              <p className="text-xs text-muted-foreground">
                Questions that help determine if a paper meets your inclusion
                criteria.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={handleAddQuestion}
                disabled={!newQuestion.trim() || isAdding}
                className="flex-1 h-12 sm:h-10 text-base sm:text-sm"
              >
                {isAdding ? (
                  <div className="h-5 w-5 sm:h-4 sm:w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                ) : (
                  <Plus className="h-5 w-5 sm:h-4 sm:w-4 mr-2" />
                )}
                Add Question
              </Button>
              <Button
                onClick={handleGenerateWithAI}
                variant="outline"
                disabled={isGenerating || !researchQuestion.trim()}
                className="flex items-center justify-center gap-2 h-12 sm:h-10 text-base sm:text-sm"
              >
                {isGenerating ? (
                  <div className="h-5 w-5 sm:h-4 sm:w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Sparkles className="h-5 w-5 sm:h-4 sm:w-4" />
                )}
                {isGenerating ? "Generating..." : "Generate with AI"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Questions List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              <span className="text-lg sm:text-xl">
                Screening Questions ({(screeningQuestions || []).length})
              </span>
            </span>
            {(screeningQuestions || []).length > 0 && (
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <Button
                  size="sm"
                  onClick={handleTestAllQuestions}
                  title="Test all questions - remove from all responses"
                  className="h-9 px-3 text-sm"
                >
                  <Play className="h-4 w-4 mr-1 sm:mr-2" />
                  <span>Test All</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClearAllQuestions}
                  className="text-destructive hover:bg-destructive/10 h-9 px-3 text-sm"
                  title="Clear all screening questions"
                >
                  <Trash2 className="h-4 w-4 mr-1 sm:mr-2" />
                  <span>Clear All</span>
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="">
          {(screeningQuestions || []).length === 0 ? (
            <div className="text-center py-8 sm:py-12 text-muted-foreground">
              <HelpCircle className="h-12 w-12 sm:h-16 sm:w-16 mx-auto mb-4 opacity-50" />
              <p className="text-base sm:text-lg font-medium mb-2">
                No screening questions yet
              </p>
              <p className="text-sm">
                Add your first question using the form above.
              </p>
            </div>
          ) : (
            <div className="space-y-3 sm:space-y-4">
              {(screeningQuestions || []).map((questionEntry, index) => (
                <div
                  key={questionEntry.question}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 sm:p-3 rounded-lg border bg-card hover:bg-card/50 transition-colors"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="flex-shrink-0 w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mt-0.5">
                      <span className="text-xs sm:text-xs font-mono font-medium text-primary">
                        {index + 1}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm sm:text-sm leading-relaxed break-words">
                        {questionEntry.question}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 sm:gap-1 ml-10 sm:ml-0">
                    <Button
                      size="sm"
                      onClick={() => handleTestQuestion(questionEntry.question)}
                      title="Test question - remove from all responses"
                      className="h-9 px-3 text-sm flex-shrink-0"
                    >
                      <Play className="h-4 w-4 mr-1 sm:mr-2" />
                      <span>Test</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        handleDeleteQuestion(index, questionEntry.question)
                      }
                      className="text-destructive hover:bg-destructive/10 h-9 w-9 sm:h-8 sm:w-8 p-0 flex-shrink-0"
                      title="Delete question"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
