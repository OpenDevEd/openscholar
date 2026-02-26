"use client";
"use no memo"; // try/finally in handlers

import React, { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompactQuestionList } from "./components/compact-question-list";
import { useSearchHistoryStore, useTransientScreeningStore } from "@/lib/store";
import { useGenerateScreeningQuestions } from "@/lib/ai/client/router";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { commandCenterSpring } from "@/lib/animation-config";
import { cn } from "@/lib/utils";

interface ScreeningExpansionProps {
  isOpen: boolean;
  searchId: string;
  panelId: string;
}

type InlineStatusTone = "success" | "warning" | "error";

interface InlineStatus {
  tone: InlineStatusTone;
  message: string;
}

export function ScreeningExpansion({ isOpen, searchId, panelId }: ScreeningExpansionProps) {
  const t = useTranslations();
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  const tToast = useTranslations("toast");
  const locale = useLocale();
  const [newQuestion, setNewQuestion] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [inlineStatus, setInlineStatus] = useState<InlineStatus | null>(null);

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

  const lastQuestionFromHistory =
    searchResult?.questionHistory?.[searchResult.questionHistory.length - 1]?.question;
  const searchQuery = searchResult?.query || "";
  const researchQuestion =
    lastQuestionFromHistory ||
    (searchQuery ? validateAndExpandKeywordsSilently(searchQuery).expandedQuery : "");
  const hasResearchQuestion = researchQuestion.trim().length > 0;

  useEffect(() => {
    if (!inlineStatus) return;
    const timeoutId = window.setTimeout(() => {
      setInlineStatus(null);
    }, 3200);
    return () => window.clearTimeout(timeoutId);
  }, [inlineStatus]);

  const setStatus = (tone: InlineStatusTone, message: string) => {
    setInlineStatus({ tone, message });
  };

  const handleAddQuestion = () => {
    const normalizedQuestion = newQuestion.trim();
    if (!normalizedQuestion) {
      setStatus("warning", tv("pleaseEnterQuestion"));
      return;
    }

    const duplicate = screeningQuestions.find(
      (q) => q.question.toLowerCase() === normalizedQuestion.toLowerCase()
    );
    if (duplicate) {
      setStatus("warning", tv("questionAlreadyExists"));
      return;
    }

    setIsAdding(true);
    try {
      addScreeningQuestion(searchId, normalizedQuestion);
      posthog.capture("screening_question_added", {
        question_length: normalizedQuestion.length,
        total_questions: screeningQuestions.length + 1,
        source: "manual",
      });
      setNewQuestion("");
      setStatus(
        "success",
        tToast("entityCreated", { entity: tToast("entityQuestion") })
      );
    } catch {
      setStatus("error", tv("failedToAddQuestion"));
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
    if (!normalizedQuestion) {
      setStatus("warning", tv("pleaseEnterQuestion"));
      return false;
    }

    const hasDuplicate = screeningQuestions.some(
      (question, questionIndex) =>
        questionIndex !== index &&
        question.question.toLowerCase() === normalizedQuestion.toLowerCase()
    );
    if (hasDuplicate) {
      setStatus("warning", tv("questionAlreadyExists"));
      return false;
    }

    const changed = previousQuestion !== normalizedQuestion;
    if (changed) {
      updateScreeningQuestion(searchId, index, { question: normalizedQuestion });
      clearTestIndexPerQuestion(previousQuestion);
      clearTestIndexPerQuestion(normalizedQuestion);
      setStatus(
        "success",
        tToast("entityUpdated", { entity: tToast("entityQuestion") })
      );
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
    setStatus(
      "success",
      tToast("entityDeleted", { entity: tToast("entityQuestion") })
    );

    posthog.capture("screening_question_deleted", {
      question_length: question.length,
      remaining_questions: remainingQuestions,
    });
  };

  const handleTestQuestion = (question: string) => {
    removeScreeningQuestionFromAllPapers(searchId, question);
    incrementTestIndexPerQuestion(question);
    setStatus(
      "success",
      tToast("entityCleared", { entity: tToast("entityQuestionResponses") })
    );

    posthog.capture("screening_question_tested", {
      question,
      question_length: question.length,
    });
  };

  const handleTestAllQuestions = () => {
    if (screeningQuestions.length === 0) {
      setStatus("warning", tv("noQuestionsToTest"));
      return;
    }

    screeningQuestions.forEach((q) => {
      removeScreeningQuestionFromAllPapers(searchId, q.question);
      incrementTestIndexPerQuestion(q.question);
    });

    setStatus(
      "success",
      tToast("entityCleared", { entity: tToast("entityQuestionResponses") })
    );
  };

  const handleClearAllQuestions = () => {
    if (screeningQuestions.length === 0) {
      setStatus("warning", tv("noQuestionsToClear"));
      return;
    }

    const questionsCleared = screeningQuestions.length;
    clearScreeningQuestions(searchId);
    clearAllTestIndexPerQuestion();
    setStatus(
      "success",
      tToast("entityCleared", { entity: tToast("entityQuestions") })
    );

    posthog.capture("screening_questions_cleared", {
      questions_cleared_count: questionsCleared,
    });
  };

  const handleGenerateWithAI = async () => {
    if (!isConfigured) {
      setStatus("error", tv("aiConfigRequired"));
      return;
    }

    if (!hasResearchQuestion) {
      setStatus("warning", tv("noResearchQuestionAvailable"));
      return;
    }

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

        setStatus("success", t("extraction.addedQuestions", { count: addedCount }));
      } else {
        setStatus("warning", tv("noNewQuestionsGenerated"));
      }
    } catch (error: unknown) {
      posthog.capture("screening_questions_generation_failed", {});
      setStatus(
        "error",
        error instanceof Error && error.message ? error.message : te("unexpectedErrorRetry")
      );
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
            <div role="status" aria-live="polite" className="sr-only">
              {inlineStatus?.message || ""}
            </div>

            {/* Input row */}
            <div className="flex gap-2 items-center">
              <Input
                value={newQuestion}
                onChange={(event) => setNewQuestion(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("searchCommand.placeholder.screeningQuestion")}
                disabled={isAdding || isGenerating}
                className="h-8 flex-1 bg-background text-sm"
              />
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
            </div>

            {/* Inline status (transient) */}
            <AnimatePresence>
              {inlineStatus && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs",
                    inlineStatus.tone === "success" && "text-primary",
                    inlineStatus.tone === "warning" &&
                      "text-amber-800 dark:text-amber-200",
                    inlineStatus.tone === "error" && "text-destructive"
                  )}
                >
                  {inlineStatus.tone === "success" ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                  )}
                  {inlineStatus.message}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Question list */}
            <CompactQuestionList
              questions={screeningQuestions}
              onTest={handleTestQuestion}
              onDelete={handleDeleteQuestion}
              onEdit={handleEditQuestion}
              disabled={isAdding || isGenerating}
            />

            {/* Bulk actions row — only when questions exist */}
            {screeningQuestions.length > 0 && (
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleTestAllQuestions}
                  className="h-7 gap-1.5 text-xs"
                >
                  <Play className="h-3 w-3" />
                  {t("searchCommand.testAllQuestions")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAllQuestions}
                  className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                  {t("searchCommand.clearAllQuestions")}
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
