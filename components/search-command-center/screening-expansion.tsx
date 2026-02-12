"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "motion/react";
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
import { useSearchHistoryStore, useTransientScreeningStore } from "@/lib/store";
import { appToast } from "@/lib/toast";
import { useGenerateScreeningQuestions } from "@/lib/ai/client/router";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { cn } from "@/lib/utils";
import { commandCenterSpring } from "@/lib/animation-config";
import posthog from "posthog-js";

interface ScreeningExpansionProps {
  isOpen: boolean;
  searchId: string;
}

export function ScreeningExpansion({ isOpen, searchId }: ScreeningExpansionProps) {
  const t = useTranslations();
  const tv = useTranslations("validation");
  const tToast = useTranslations("toast");
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
  const { incrementTestIndexPerQuestion } = useTransientScreeningStore();

  // Use the new router hook
  const { execute: generateQuestions, isConfigured } = useGenerateScreeningQuestions();

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
      appToast.validation.failed(tv("pleaseEnterQuestion"));
      return;
    }

    const duplicate = screeningQuestions.find(
      (q) => q.question.toLowerCase() === newQuestion.trim().toLowerCase()
    );
    if (duplicate) {
      appToast.validation.failed(tv("questionAlreadyExists"));
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
      appToast.entity.created(tToast("entityQuestion"));
    } catch {
      appToast.validation.failed(tv("failedToAddQuestion"));
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteQuestion = (index: number, question: string) => {
    const remainingQuestions = screeningQuestions.length - 1;
    removeScreeningQuestion(searchId, index);
    appToast.entity.deleted(tToast("entityQuestion"));

    // Track screening question deletion
    posthog.capture("screening_question_deleted", {
      question_length: question.length,
      remaining_questions: remainingQuestions,
    });
  };

  const handleTestQuestion = (question: string) => {
    removeScreeningQuestionFromAllPapers(searchId, question);
    incrementTestIndexPerQuestion(question);
    appToast.entity.cleared(tToast("entityQuestionResponses"));

    // Track screening question test
    posthog.capture("screening_question_tested", {
      question: question,
      question_length: question.length,
    });
  };

  const handleTestAllQuestions = () => {
    if (screeningQuestions.length === 0) {
      appToast.validation.warning(tv("noQuestionsToTest"));
      return;
    }

    screeningQuestions.forEach((q) => {
      removeScreeningQuestionFromAllPapers(searchId, q.question);
      incrementTestIndexPerQuestion(q.question);
    });

    appToast.entity.cleared(tToast("entityQuestionResponses"), screeningQuestions.length);
  };

  const handleClearAllQuestions = () => {
    if (screeningQuestions.length === 0) {
      appToast.validation.warning(tv("noQuestionsToClear"));
      return;
    }

    const questionsCleared = screeningQuestions.length;
    clearScreeningQuestions(searchId);
    appToast.entity.cleared(tToast("entityQuestions"), questionsCleared);

    // Track screening questions cleared
    posthog.capture("screening_questions_cleared", {
      questions_cleared_count: questionsCleared,
    });
  };

  const handleGenerateWithAI = async () => {
    if (!isConfigured) {
      appToast.ai.configRequired(tv("aiConfigRequired"));
      return;
    }

    if (!researchQuestion.trim()) {
      appToast.validation.failed(tv("noResearchQuestionAvailable"));
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateQuestions({
        researchQuestion,
        existingQuestions: screeningQuestions.map((q) => q.question),
      });

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
        });

        appToast.entity.created(
          "screening questions",
          t("extraction.addedQuestions", { count: addedCount })
        );
      } else {
        appToast.validation.warning(tv("noNewQuestionsGenerated"));
      }
    } catch (error) {
      // Track generation failure
      posthog.capture("screening_questions_generation_failed", {});

      appToast.ai.failed(t("searchCommand.questionGeneration"), error);
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
                {t("searchCommand.screeningQuestionsCount", { count: screeningQuestions.length })}
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
                      {t("searchCommand.testAllQuestions")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleClearAllQuestions}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      {t("searchCommand.clearAllQuestions")}
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
                placeholder={t("searchCommand.placeholder.screeningQuestion")}
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
                    <span className="hidden sm:inline">{t("common.generate")}</span>
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
