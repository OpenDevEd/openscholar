"use client";
  "use no memo"; // try/finally in handlers

import React, { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { motion, AnimatePresence } from "motion/react";
import {
  Loader2,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { CompactQuestionList } from "./components/compact-question-list";
import { useSearchHistoryStore, useTransientScreeningStore } from "@/lib/store";
import { useGenerateScreeningQuestions } from "@/lib/ai/client/router";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { commandCenterSpring } from "@/lib/animation-config";
import { useCooldown } from "@/lib/hooks/use-cooldown";
import { useAppToast } from "@/lib/toast";

interface ScreeningExpansionProps {
  isOpen: boolean;
  searchId: string;
  panelId: string;
}

export function ScreeningExpansion({ isOpen, searchId, panelId }: ScreeningExpansionProps) {
  const toast = useAppToast();
  const t = useTranslations();
  const locale = useLocale();
  const [newQuestion, setNewQuestion] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTestAllCooling, triggerTestAllCooldown] = useCooldown();

  const {
    getSearchResult,
    addScreeningQuestion,
    updateScreeningQuestion,
    removeScreeningQuestion,
    clearScreeningQuestions,
    removeScreeningQuestionFromAllPapers,
  } = useSearchHistoryStore();
  const {
    incrementTestIndexPerQuestion,
    clearTestIndexPerQuestion,
    clearAllTestIndexPerQuestion,
  } = useTransientScreeningStore();

  const { execute: generateQuestions, isConfigured } = useGenerateScreeningQuestions();

  const searchResult = getSearchResult(searchId);
  const screeningQuestions = searchResult?.screeningQuestions || [];

  const lastQuestionFromHistory = searchResult?.latestQuestion;
  const searchQuery = searchResult?.query || "";
  const researchQuestion =
    lastQuestionFromHistory ||
    (searchQuery ? validateAndExpandKeywordsSilently(searchQuery).expandedQuery : "");
  const hasResearchQuestion = researchQuestion.trim().length > 0;

  const handleAddQuestion = () => {
    const normalizedQuestion = newQuestion.trim();
    if (!normalizedQuestion) return;

    const duplicate = screeningQuestions.find(
      (q) => q.question.toLowerCase() === normalizedQuestion.toLowerCase()
    );
    if (duplicate) return;

    setIsAdding(true);
    try {
      addScreeningQuestion(searchId, normalizedQuestion);
      posthog.capture("screening_question_added", {
        question_length: normalizedQuestion.length,
        total_questions: screeningQuestions.length + 1,
        source: "manual",
      });
      setNewQuestion("");
    } finally {
      setIsAdding(false);
    }
  };

  const handleEditQuestion = (
    index: number,
    previousQuestion: string,
    nextQuestion: string
  ): boolean => {
    const normalizedQuestion = nextQuestion.trim();
    if (!normalizedQuestion) return false;

    const hasDuplicate = screeningQuestions.some(
      (question, questionIndex) =>
        questionIndex !== index &&
        question.question.toLowerCase() === normalizedQuestion.toLowerCase()
    );
    if (hasDuplicate) return false;

    const changed = previousQuestion !== normalizedQuestion;
    if (changed) {
      updateScreeningQuestion(searchId, index, { question: normalizedQuestion });
      clearTestIndexPerQuestion(previousQuestion);
      clearTestIndexPerQuestion(normalizedQuestion);
    }

    posthog.capture("screening_question_edited", {
      changed,
      previous_question_length: previousQuestion.length,
      next_question_length: normalizedQuestion.length,
      total_questions: screeningQuestions.length,
    });
    return true;
  };

  const handleDeleteQuestion = (index: number, question: string) => {
    const remainingQuestions = screeningQuestions.length - 1;
    removeScreeningQuestion(searchId, index);
    clearTestIndexPerQuestion(question);

    posthog.capture("screening_question_deleted", {
      question_length: question.length,
      remaining_questions: remainingQuestions,
    });
  };

  const handleTestQuestion = (question: string) => {
    removeScreeningQuestionFromAllPapers(searchId, question);
    incrementTestIndexPerQuestion(question);

    posthog.capture("screening_question_tested", {
      question,
      question_length: question.length,
    });
  };

  const handleTestAllQuestions = () => {
    if (screeningQuestions.length === 0) return;

    screeningQuestions.forEach((q) => {
      removeScreeningQuestionFromAllPapers(searchId, q.question);
      incrementTestIndexPerQuestion(q.question);
    });

    triggerTestAllCooldown();
  };

  const handleClearAllQuestions = () => {
    if (screeningQuestions.length === 0) return;

    const questionsCleared = screeningQuestions.length;
    clearScreeningQuestions(searchId);
    clearAllTestIndexPerQuestion();

    posthog.capture("screening_questions_cleared", {
      questions_cleared_count: questionsCleared,
    });
  };

  const handleGenerateWithAI = async () => {
    if (!isConfigured) return;

    if (!hasResearchQuestion) return;

    setIsGenerating(true);
    try {
      const result = await generateQuestions({
        researchQuestion,
        existingQuestions: screeningQuestions.map((q) => q.question),
        responseLanguage: localeToLanguageCode(locale),
      });

      const existingQuestions = new Set(
        screeningQuestions.map((question) => question.question.toLowerCase())
      );
      let addedCount = 0;
      for (const question of result.questions) {
        const normalizedQuestion = question.trim();
        const normalizedKey = normalizedQuestion.toLowerCase();
        if (!normalizedQuestion || existingQuestions.has(normalizedKey)) continue;
        addScreeningQuestion(searchId, normalizedQuestion);
        existingQuestions.add(normalizedKey);
        addedCount++;
      }

      if (addedCount > 0) {
        posthog.capture("screening_questions_generated", {
          questions_generated: result.questions.length,
          questions_added: addedCount,
          questions_duplicated: result.questions.length - addedCount,
          total_questions: screeningQuestions.length + addedCount,
        });
      }
    } catch (error) {
      posthog.capture("screening_questions_generation_failed", {});
      toast.ai.failed(t("searchCommand.questionGeneration"), error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleAddQuestion();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          id={panelId}
          role="region"
          aria-labelledby={`${panelId}-title`}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={commandCenterSpring}
          className="overflow-hidden"
        >
          <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-3">
            {/* Input row */}
            <div className="flex flex-wrap gap-2 items-center">
              <ButtonGroup>
                <Button
                  variant="ai"
                  size="sm"
                  onClick={handleGenerateWithAI}
                  disabled={isGenerating || !hasResearchQuestion}
                  className="h-8 gap-1.5 shrink-0"
                >
                  {isGenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {t("common.generate")}
                </Button>
                {screeningQuestions.length > 0 && (
                  <Button
                    variant="ai"
                    size="sm"
                    onClick={handleTestAllQuestions}
                    disabled={isTestAllCooling}
                    className="h-8 gap-1.5 shrink-0"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {t("searchCommand.testAllQuestions")}
                  </Button>
                )}
              </ButtonGroup>
              <Input
                value={newQuestion}
                onChange={(event) => setNewQuestion(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("searchCommand.placeholder.screeningQuestion")}
                disabled={isAdding || isGenerating}
                className="h-8 flex-1 bg-background text-sm"
              />
              <ButtonGroup>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddQuestion}
                  disabled={!newQuestion.trim() || isAdding}
                  className="h-8 gap-1.5 shrink-0"
                >
                  {isAdding ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {t("common.add")}
                </Button>
                {screeningQuestions.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearAllQuestions}
                    className="h-8 gap-1.5 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("searchCommand.clearAllQuestions")}
                  </Button>
                )}
              </ButtonGroup>

            </div>

            {/* Question list */}
            <CompactQuestionList
              questions={screeningQuestions}
              onTest={handleTestQuestion}
              onDelete={handleDeleteQuestion}
              onEdit={handleEditQuestion}
              disabled={isAdding || isGenerating}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
