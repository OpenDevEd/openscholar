"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Wand2, Loader2, MoreHorizontal, Trash2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CompactQuestionList } from "./components/compact-question-list";
import { useSearchHistoryStore, useAIConfigStore, useTransientScreeningStore } from "@/lib/store";
import { appToast } from "@/lib/toast";
import { generateScreeningQuestions } from "@/app/actions/ai-enhance";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { cn } from "@/lib/utils";
import { commandCenterSpring } from "@/lib/animation-config";
import posthog from "posthog-js";

interface ScreeningExpansionProps {
  isOpen: boolean;
  searchId: string;
}

export function ScreeningExpansion({ isOpen, searchId }: ScreeningExpansionProps) {
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
  const { provider, model, apiKey } = useAIConfigStore();
  const { incrementTestIndexPerQuestion } = useTransientScreeningStore();

  const searchResult = getSearchResult(searchId);
  const screeningQuestions = searchResult?.screeningQuestions || [];

  // Get research question from history or query
  const lastQuestionFromHistory =
    searchResult?.questionHistory?.[searchResult.questionHistory.length - 1]?.question;
  const searchQuery = searchResult?.query || "";
  const researchQuestion =
    lastQuestionFromHistory ||
    (searchQuery ? validateAndExpandKeywordsSilently(searchQuery).expandedQuery : "");

  const handleAddQuestion = async () => {
    if (!newQuestion.trim()) {
      appToast.validation.failed("Please enter a question.");
      return;
    }

    const duplicate = screeningQuestions.find(
      (q) => q.question.toLowerCase() === newQuestion.trim().toLowerCase()
    );
    if (duplicate) {
      appToast.validation.failed("This question already exists.");
      return;
    }

    setIsAdding(true);
    try {
      addScreeningQuestion(searchId, newQuestion.trim());

      // Track manual screening question added event
      posthog.capture("screening_question_added", {
        question_length: newQuestion.trim().length,
        total_questions: screeningQuestions.length + 1,
        source: "manual",
      });

      setNewQuestion("");
      appToast.entity.created("question");
    } catch {
      appToast.validation.failed("Failed to add question.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteQuestion = (index: number, question: string) => {
    const remainingQuestions = screeningQuestions.length - 1;
    removeScreeningQuestion(searchId, index);
    appToast.entity.deleted("question");

    // Track screening question deletion
    posthog.capture("screening_question_deleted", {
      question_length: question.length,
      remaining_questions: remainingQuestions,
    });
  };

  const handleTestQuestion = (question: string) => {
    removeScreeningQuestionFromAllPapers(searchId, question);
    incrementTestIndexPerQuestion(question);
    appToast.entity.cleared("question responses");

    // Track screening question test
    posthog.capture("screening_question_tested", {
      question: question,
      question_length: question.length,
    });
  };

  const handleTestAllQuestions = () => {
    if (screeningQuestions.length === 0) {
      appToast.validation.warning("No questions to test.");
      return;
    }

    screeningQuestions.forEach((q) => {
      removeScreeningQuestionFromAllPapers(searchId, q.question);
      incrementTestIndexPerQuestion(q.question);
    });

    appToast.entity.cleared("question responses", screeningQuestions.length);
  };

  const handleClearAllQuestions = () => {
    if (screeningQuestions.length === 0) {
      appToast.validation.warning("No questions to clear.");
      return;
    }

    const questionsCleared = screeningQuestions.length;
    clearScreeningQuestions(searchId);
    appToast.entity.cleared("questions", questionsCleared);

    // Track screening questions cleared
    posthog.capture("screening_questions_cleared", {
      questions_cleared_count: questionsCleared,
    });
  };

  const handleGenerateWithAI = async () => {
    if (!apiKey || !provider) {
      appToast.ai.configRequired("Please configure your AI provider and API key first.");
      return;
    }

    if (!researchQuestion.trim()) {
      appToast.validation.failed("No research question available.");
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateScreeningQuestions(
        researchQuestion,
        screeningQuestions.map((q) => q.question),
        provider,
        apiKey,
        model
      );

      let addedCount = 0;
      for (const question of result.questions) {
        try {
          addScreeningQuestion(searchId, question.trim());
          addedCount++;
        } catch {
          // Skip duplicates
        }
      }

      if (addedCount > 0) {
        // Track AI-generated screening questions event
        posthog.capture("screening_questions_generated", {
          questions_generated: result.questions.length,
          questions_added: addedCount,
          questions_duplicated: result.questions.length - addedCount,
          total_questions: screeningQuestions.length + addedCount,
          ai_provider: provider,
          ai_model: model,
        });

        appToast.entity.created(
          "screening questions",
          `${addedCount} new question${addedCount > 1 ? "s" : ""}`
        );
      } else {
        appToast.validation.warning("No new questions generated.");
      }
    } catch (error) {
      // Track generation failure
      posthog.capture("screening_questions_generation_failed", {
        ai_provider: provider,
        ai_model: model,
      });

      appToast.ai.failed("Question generation", error);
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
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={commandCenterSpring}
          className="overflow-hidden"
        >
          <div className="px-4 pb-4 pt-2 space-y-3 border-t border-border/40">
            {/* Header with actions */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Screening Questions ({screeningQuestions.length})
              </span>

              {screeningQuestions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleTestAllQuestions}>
                      <Play className="h-4 w-4 mr-2" />
                      Test all questions
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleClearAllQuestions}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Clear all questions
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Add question row */}
            <div className="flex gap-2">
              <Input
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Add a screening question..."
                disabled={isAdding || isGenerating}
                className="flex-1 h-9"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={handleAddQuestion}
                disabled={!newQuestion.trim() || isAdding}
                className="h-9 w-9 flex-shrink-0"
              >
                {isAdding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateWithAI}
                disabled={isGenerating || !researchQuestion.trim()}
                className={cn(
                  "h-9 px-3 flex-shrink-0 text-xs gap-1.5",
                  "bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10",
                  "hover:from-violet-500/20 hover:to-fuchsia-500/20",
                  "border-violet-500/30 hover:border-violet-500/50",
                  "text-violet-700 dark:text-violet-300",
                  "transition-all duration-200"
                )}
              >
                {isGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Wand2 className="h-3 w-3 sm:mr-0.5" />
                    <span className="hidden sm:inline">Generate</span>
                  </>
                )}
              </Button>
            </div>

            {/* Questions list */}
            <CompactQuestionList
              questions={screeningQuestions}
              onTest={handleTestQuestion}
              onDelete={handleDeleteQuestion}
              disabled={isAdding || isGenerating}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
