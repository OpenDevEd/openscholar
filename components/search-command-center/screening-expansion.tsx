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
import { toast } from "sonner";
import { generateScreeningQuestions } from "@/app/actions/ai-enhance";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { cn } from "@/lib/utils";
import { commandCenterSpring } from "@/lib/animation-config";

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
      toast.error("Please enter a question");
      return;
    }

    const duplicate = screeningQuestions.find(
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
      toast.success("Question added");
    } catch {
      toast.error("Failed to add question");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteQuestion = (index: number, question: string) => {
    removeScreeningQuestion(searchId, index);
    toast.success("Question deleted");
  };

  const handleTestQuestion = (question: string) => {
    removeScreeningQuestionFromAllPapers(searchId, question);
    incrementTestIndexPerQuestion(question);
    toast.success("Removed responses for this question");
  };

  const handleTestAllQuestions = () => {
    if (screeningQuestions.length === 0) {
      toast.info("No questions to test");
      return;
    }

    screeningQuestions.forEach((q) => {
      removeScreeningQuestionFromAllPapers(searchId, q.question);
      incrementTestIndexPerQuestion(q.question);
    });

    toast.success(`Removed all ${screeningQuestions.length} question responses`);
  };

  const handleClearAllQuestions = () => {
    if (screeningQuestions.length === 0) {
      toast.info("No questions to clear");
      return;
    }

    clearScreeningQuestions(searchId);
    toast.success(`Cleared all ${screeningQuestions.length} questions`);
  };

  const handleGenerateWithAI = async () => {
    if (!apiKey) {
      toast.error("Please configure your AI API key first");
      return;
    }

    if (!researchQuestion.trim()) {
      toast.error("No research question available");
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
        toast.success(`Added ${addedCount} new question${addedCount > 1 ? "s" : ""}`);
      } else {
        toast.warning("No new questions generated");
      }
    } catch {
      toast.error("Failed to generate questions");
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
                className="h-9 px-3 flex-shrink-0"
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Wand2 className="h-4 w-4 sm:mr-1.5" />
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
