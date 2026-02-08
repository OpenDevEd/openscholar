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
  useCurrentQueryStore,
  useKeywordExpansionDialogStore,
  useAISettingsDialogStore,
} from "@/lib/store";
import { useEffectiveSearchId } from "@/lib/hooks";
import { toast } from "sonner";
import { enhanceSearchQuery, translateQuery } from "@/app/actions/ai-enhance";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { cn } from "@/lib/utils";
import posthog from "posthog-js";

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
  const setSuggestedQuery = useKeywordExpansionDialogStore((state) => state.setSuggestedQuery);
  // Keyword search state - also sync with global store for real-time tooltip updates
  const { setCurrentQuery } = useCurrentQueryStore();
  const [localInputValue, setLocalInputValue] = useState(search?.params?.q ?? "");
  const [isTranslating, setIsTranslating] = useState(false);

  const urlQuery = search?.params?.q ?? "";
  const selectedLanguage = search?.params?.lang ?? "";

  const isFormDisabled = isLoading || isValidating || isTranslating || isEnhancing;

  // Sync local input when URL query changes
  useEffect(() => {
    setLocalInputValue(urlQuery);
    setCurrentQuery(urlQuery);
  }, [urlQuery, setCurrentQuery]);

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
    setCurrentQuery(value); // Update global store for real-time tooltip updates
    setSuggestedQuery(validateAndExpandKeywordsSilently(value).expandedQuery);
  }, [setCurrentQuery, setSuggestedQuery]);

  // Handle keyword search submit
  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (search && localInputValue.trim()) {
        search.setQuery(localInputValue);

        // Track search submitted event
        posthog.capture("search_submitted", {
          query: localInputValue,
          query_length: localInputValue.length,
          has_boolean_operators: /\b(AND|OR|NOT)\b/.test(localInputValue),
          language: selectedLanguage || "en",
        });
      }
    },
    [search, localInputValue, selectedLanguage]
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

      // Track AI query enhancement event
      posthog.capture("ai_query_enhanced", {
        original_question: questionToProcess,
        enhanced_query: result.enhancedQuery,
        ai_provider: provider,
        ai_model: model,
        language: currentSearchResult?.language || "en",
      });

      toast.success("Question converted to keywords", {
        description: `Searching for: "${result.enhancedQuery}"`,
      });
    } catch (error) {
      // Track enhancement error
      posthog.capture("ai_query_enhancement_failed", {
        original_question: questionToProcess,
        ai_provider: provider,
        ai_model: model,
        error_message: error instanceof Error ? error.message : "Unknown error",
      });

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

    const previousLanguage = selectedLanguage;
    search.setLanguage(language || null);

    // Track language selection
    posthog.capture("language_selected", {
      language: language || "none",
      previous_language: previousLanguage || "none",
      context: "search",
    });

    if (localInputValue.trim() && language) {
      if (!apiKey || !provider) {
        toast.error("API Key Required", {
          description: "Please configure your AI settings to translate queries.",
          action: {
            label: "Open Settings",
            onClick: () => useAISettingsDialogStore.getState().setIsOpen(true),
          },
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

        // Track query translation event
        posthog.capture("query_translated", {
          original_query: expandedQuery,
          translated_query: translatedQuery,
          target_language: language,
          ai_provider: provider,
          ai_model: model,
        });

        toast.success("Query translated", {
          description: `Translated to ${language}`,
        });
      } catch (error) {
        toast.dismiss(loadingToast);

        // Track translation error
        posthog.capture("query_translation_failed", {
          original_query: localInputValue,
          target_language: language,
          ai_provider: provider,
          ai_model: model,
        });

        toast.error("Translation failed", {
          description: error instanceof Error ? error.message : "An unexpected error occurred. Please try again.",
        });
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
