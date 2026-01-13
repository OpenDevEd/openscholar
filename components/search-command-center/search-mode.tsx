"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Search, Wand2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FloatingInput } from "./components/floating-input";
import { LanguageSelector } from "@/components/language-selector";
import { useSearchOptional } from "@/lib/search";
import {
  useSearchHistoryStore,
  useCurrentQuestionStore,
  useAIConfigStore,
} from "@/lib/store";
import { useQueryChangeHandler, useEffectiveSearchId } from "@/lib/hooks";
import { toast } from "sonner";
import { enhanceSearchQuery, translateQuery } from "@/app/actions/ai-enhance";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { cn } from "@/lib/utils";

interface SearchModeProps {
  isLoading?: boolean;
  isValidating?: boolean;
}

export function SearchMode({ isLoading, isValidating }: SearchModeProps) {
  const search = useSearchOptional();
  const effectiveSearchId = useEffectiveSearchId();

  // Research question state
  const { currentQuestion, setCurrentQuestion } = useCurrentQuestionStore();
  const { addQuestionToHistory, getSearchResult } = useSearchHistoryStore();
  const { provider, model, apiKey } = useAIConfigStore();
  const [isEnhancing, setIsEnhancing] = useState(false);

  // Keyword search state
  const [localInputValue, setLocalInputValue] = useState(search?.params?.q ?? "");
  const [isTranslating, setIsTranslating] = useState(false);

  const urlQuery = search?.params?.q ?? "";
  const selectedLanguage = search?.params?.lang ?? "";

  const isFormDisabled = isLoading || isValidating || isTranslating || isEnhancing;

  // Sync local input when URL query changes
  useEffect(() => {
    setLocalInputValue(urlQuery);
  }, [urlQuery]);

  // Sync question from history when search changes
  useEffect(() => {
    if (effectiveSearchId) {
      const currentSearch = getSearchResult(effectiveSearchId);
      if (currentSearch?.questionHistory?.length) {
        const latestQuestion =
          currentSearch.questionHistory[currentSearch.questionHistory.length - 1].question;
        setCurrentQuestion(latestQuestion);
      } else {
        setCurrentQuestion("");
      }
    }
  }, [effectiveSearchId, getSearchResult, setCurrentQuestion]);

  // Handle keyword input change
  const handleQueryChange = useCallback((value: string) => {
    setLocalInputValue(value);
  }, []);

  // Handle keyword search submit
  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (search && localInputValue.trim()) {
        search.setQuery(localInputValue);
      }
    },
    [search, localInputValue]
  );

  // Handle research question submit
  const handleQuestionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!effectiveSearchId) {
      toast.error("No active search", {
        description: "Please perform a search first.",
      });
      return;
    }

    const questionToProcess = currentQuestion.trim();
    if (questionToProcess) {
      addQuestionToHistory(effectiveSearchId, questionToProcess);
    }

    if (!questionToProcess) return;

    try {
      setIsEnhancing(true);
      const currentSearchResult = getSearchResult(effectiveSearchId);
      const result = await enhanceSearchQuery(
        questionToProcess,
        provider,
        apiKey,
        model,
        currentSearchResult?.language
      );

      if (search) {
        search.setQuery(result.enhancedQuery);
      }

      toast.success("Question converted to keywords", {
        description: `Searching for: "${result.enhancedQuery}"`,
      });
    } catch (error) {
      toast.error("Enhancement Failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  // Handle language change with translation
  const handleLanguageChange = async (language: string) => {
    if (!search || language === selectedLanguage) return;

    search.setLanguage(language || null);

    if (localInputValue.trim() && language) {
      if (!apiKey || !provider) {
        toast.error("API Key Required", {
          description: "Please configure your AI settings to translate queries.",
        });
        return;
      }

      setIsTranslating(true);
      const loadingToast = toast.loading("Translating query...");

      try {
        const { expandedQuery } = validateAndExpandKeywordsSilently(localInputValue);
        const translatedQuery = await translateQuery(
          expandedQuery,
          language,
          provider,
          apiKey,
          model
        );

        search.setQuery(translatedQuery);
        toast.dismiss(loadingToast);
        toast.success("Query translated", {
          description: `Translated to ${language}`,
        });
      } catch {
        toast.dismiss(loadingToast);
        toast.error("Translation failed");
      } finally {
        setIsTranslating(false);
      }
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Research Question Input */}
      <form onSubmit={handleQuestionSubmit}>
        <FloatingInput
          label="Research Question"
          placeholder="What are the effects of mindfulness on anxiety?"
          value={currentQuestion}
          onChange={(e) => setCurrentQuestion(e.target.value)}
          disabled={isFormDisabled}
          icon={<Wand2 className="h-4 w-4" />}
          action={
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={isFormDisabled || !currentQuestion.trim()}
              className={cn(
                "h-7 px-2.5 text-xs gap-1.5",
                "bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10",
                "hover:from-violet-500/20 hover:to-fuchsia-500/20",
                "border-violet-500/30 hover:border-violet-500/50",
                "text-violet-700 dark:text-violet-300",
                "transition-all duration-200"
              )}
            >
              {isEnhancing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Wand2 className="h-3 w-3" />
                  Ask AI
                </>
              )}
            </Button>
          }
        />
      </form>


      {/* Keywords Input */}
      <form onSubmit={handleSearchSubmit}>
        <FloatingInput
          label="Keywords"
          placeholder={isTranslating ? "Translating..." : "mindfulness AND (anxiety OR stress)"}
          value={localInputValue}
          onChange={(e) => handleQueryChange(e.target.value)}
          disabled={isFormDisabled}
          icon={<Search className="h-4 w-4" />}
          action={
            <div className="flex items-center gap-2">
              <LanguageSelector
                value={selectedLanguage}
                onValueChange={handleLanguageChange}
                disabled={isFormDisabled}
              />
              <Button
                type="submit"
                size="sm"
                disabled={isFormDisabled || !localInputValue.trim()}
                className="px-3"
              >
                {isTranslating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Search className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Search</span>
                  </>
                )}
              </Button>
            </div>
          }
        />
      </form>
    </div>
  );
}
