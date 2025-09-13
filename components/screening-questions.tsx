"use client";

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Sparkles, HelpCircle, X, TestTube } from "lucide-react";
import { useSearchHistoryStore, useAIConfigStore } from "@/lib/store";
import type { ScreeningQuestionEntry } from "@/lib/types";
import { toast } from "sonner";
import { generateScreeningQuestions } from "@/app/actions/ai-enhance";
import { validateAndExpandKeywordsSilently } from '@/lib/keyword-validation';

interface ScreeningQuestionsProps {
  searchId: string;
  className?: string;
}

export function ScreeningQuestions({ searchId, className }: ScreeningQuestionsProps) {
  const [newQuestion, setNewQuestion] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const { getSearchResult, addScreeningQuestion, removeScreeningQuestion, clearScreeningQuestions, removeScreeningQuestionFromAllPapers } = useSearchHistoryStore();
  const { provider, apiKey } = useAIConfigStore();

  const searchResult = getSearchResult(searchId);
  const screeningQuestions = searchResult?.screeningQuestions || [];

  // Get research question from question history or use the search query as fallback
  const lastQuestionFromHistory = searchResult?.questionHistory?.[searchResult.questionHistory.length - 1]?.question;
  const searchQuery = searchResult?.query || '';
  const researchQuestion = lastQuestionFromHistory || (searchQuery ? validateAndExpandKeywordsSilently(searchQuery).expandedQuery : '');

  const handleAddQuestion = async () => {
    if (!newQuestion.trim()) {
      toast.error("Please enter a question");
      return;
    }

    // Check for duplicates
    const duplicate = (screeningQuestions || []).find(q => q.question.toLowerCase() === newQuestion.trim().toLowerCase());
    if (duplicate) {
      toast.error("This question already exists");
      return;
    }

    setIsAdding(true);
    try {
      addScreeningQuestion(searchId, newQuestion.trim());
      setNewQuestion('');
      toast.success("Question added successfully");
    } catch (error) {
      toast.error("Failed to add question");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteQuestion = (questionIndex: number, question: string) => {
    const truncatedQuestion = question.length > 50 ? question.substring(0, 50) + '...' : question;
    if (window.confirm(`Are you sure you want to delete "${truncatedQuestion}"?`)) {
      removeScreeningQuestion(searchId, questionIndex);
      toast.success("Question deleted");
    }
  };

  const handleTestQuestion = (question: string) => {
    const truncatedQuestion = question.length > 50 ? question.substring(0, 50) + '...' : question;
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

    toast.success(`Removed all ${screeningQuestions.length} questions from paper responses`);
  };

  const handleClearAllQuestions = () => {
    if (screeningQuestions.length === 0) {
      toast.info("No questions to clear");
      return;
    }

    if (window.confirm(`Are you sure you want to delete all ${screeningQuestions.length} screening questions? This action cannot be undone.`)) {
      clearScreeningQuestions(searchId);
      toast.success(`Cleared all ${screeningQuestions.length} screening questions`);
    }
  };

  const handleGenerateWithAI = async () => {
    if (!apiKey) {
      toast.error("Please configure your AI API key first");
      return;
    }

    if (!researchQuestion.trim()) {
      toast.error("No research question available for generating screening questions");
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateScreeningQuestions(
        researchQuestion,
        (screeningQuestions || []).map(q => q.question),
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
        toast.success(`Added ${addedCount} new screening question${addedCount > 1 ? 's' : ''}`);
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
    if (e.key === 'Enter' && !e.shiftKey) {
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
        <CardContent>
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
              />
              <p className="text-xs text-muted-foreground">
                Questions that help determine if a paper meets your inclusion criteria.
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={handleAddQuestion}
                disabled={!newQuestion.trim() || isAdding}
                className="flex-1"
              >
                {isAdding ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Add Question
              </Button>
              <Button
                onClick={handleGenerateWithAI}
                variant="outline"
                disabled={isGenerating || !researchQuestion.trim()}
                className="flex items-center gap-2"
              >
                {isGenerating ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {isGenerating ? "Generating..." : "Generate with AI"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Questions List */}
      <Card >
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              Screening Questions ({(screeningQuestions || []).length})
            </span>
            {(screeningQuestions || []).length > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleTestAllQuestions}
                  title="Test all questions - remove from all responses"
                >
                  Test All
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClearAllQuestions}
                  className="text-destructive hover:bg-destructive/10 h-8 px-2 text-xs"
                  title="Clear all screening questions"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Clear All
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(screeningQuestions || []).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <HelpCircle className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No screening questions yet</p>
              <p className="text-sm">Add your first question using the form above.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(screeningQuestions || []).map((questionEntry, index) => (
                <div
                  key={questionEntry.question}
                  className="flex items-center justify-between gap-3 p-2 px-4 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <span className="text-xs font-mono font-medium text-primary">
                        {index + 1}
                      </span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm leading-relaxed">
                        {questionEntry.question}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      onClick={() => handleTestQuestion(questionEntry.question)}
                      title="Test question - remove from all responses"
                    >
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteQuestion(index, questionEntry.question)}
                      className="text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
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
