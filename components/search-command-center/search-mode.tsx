"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Search, Wand2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
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
} from "@/lib/store";
import { useEffectiveSearchId } from "@/lib/hooks";
import { appToast, getErrorMessage, runWithLoadingToast } from "@/lib/toast";
import { useEnhanceSearchQuery, useTranslateQuery } from "@/lib/ai/client/router";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { cn } from "@/lib/utils";
import posthog from "posthog-js";

interface SearchModeProps {
  isLoading?: boolean;
  isValidating?: boolean;
}

export function SearchMode({ isLoading, isValidating }: SearchModeProps) {
  const t = useTranslations("searchCommand");
  const tc = useTranslations("common");
  const tl = useTranslations("languages");
  const te = useTranslations("errors");
  const tValidation = useTranslations("validation");
  const search = useSearchOptional();
  const effectiveSearchId = useEffectiveSearchId();

  // Research question state
  const { currentQuestion, setCurrentQuestion } = useCurrentQuestionStore();
  const { addQuestionToHistory, getSearchResult } = useSearchHistoryStore();
  const { apiKeyMode } = useAIConfigStore();
  const [isEnhancing, setIsEnhancing] = useState(false);
  const setSuggestedQuery = useKeywordExpansionDialogStore((state) => state.setSuggestedQuery);
  // Keyword search state - also sync with global store for real-time tooltip updates
  const { setCurrentQuery } = useCurrentQueryStore();
  const [localInputValue, setLocalInputValue] = useState(search?.params?.q ?? "");
  const [isTranslating, setIsTranslating] = useState(false);

  // Use the new router hooks
  const { execute: enhanceQuery, isConfigured: isEnhanceConfigured } = useEnhanceSearchQuery();
  const { execute: translateQueryFn, isConfigured: isTranslateConfigured } = useTranslateQuery();

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
      }
    },
    [search, localInputValue]
  );

  // Handle research question submit
  const handleQuestionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!effectiveSearchId) {
      appToast.validation.failed(tValidation('searchRequired'));
      return;
    }

    if (!isEnhanceConfigured) {
      appToast.ai.configRequired(tValidation('aiConfigRequired'));
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
      const result = await enhanceQuery({
        query: questionToProcess,
        language: currentSearchResult?.language,
      });

      if (search) {
        search.setQuery(result.enhancedQuery);
      }

      // Track AI query enhancement event
      posthog.capture("ai_query_enhanced", {
        original_question: questionToProcess,
        enhanced_query: result.enhancedQuery,
        language: currentSearchResult?.language || "en",
      });

      appToast.ai.succeeded(t('questionConverted'), t('searchingFor', { query: result.enhancedQuery }));
    } catch (error) {
      // Track enhancement error
      posthog.capture("ai_query_enhancement_failed", {
        original_question: questionToProcess,
        error_message: getErrorMessage(error, te("unknownError")),
      });

      appToast.ai.failed(t("enhancement"), error);
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
      if (!isTranslateConfigured) {
        appToast.ai.configRequired(tValidation('aiConfigRequired'));
        return;
      }

      setIsTranslating(true);
      const { expandedQuery } = validateAndExpandKeywordsSilently(localInputValue);
      try {
        await runWithLoadingToast({
          loading: t('translatingQuery'),
          run: async () => {
            const result = await translateQueryFn({
              query: expandedQuery,
              targetLanguage: language,
            });

            search.setQuery(result.translatedQuery);

            // Track query translation event
            posthog.capture("query_translated", {
              original_query: expandedQuery,
              translated_query: result.translatedQuery,
              target_language: language,
            });

            return result;
          },
          success: () => ({
            title: t('queryTranslated'),
            description: t('translatedTo', { language: tl(language as never) || language }),
          }),
          error: (error) => {
            // Track translation error
            posthog.capture("query_translation_failed", {
              original_query: localInputValue,
              target_language: language,
              error_message: getErrorMessage(error, te("translationFailed")),
            });

            return {
              title: t('translationFailed'),
              description: getErrorMessage(error, te("unexpectedErrorRetry")),
            };
          },
        });
      } catch {
        // Toast is already handled by runWithLoadingToast.
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
          label={t('researchQuestion')}
          placeholder={t('placeholder.researchQuestion')}
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
                  {t('askAI')}
                </>
              )}
            </Button>
          }
        />
      </form>


      {/* Keywords Input */}
      <form onSubmit={handleSearchSubmit}>
        <FloatingInput
          label={t('keywords')}
          placeholder={isTranslating ? tc('translating') : t('placeholder.keywords')}
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
                    <span className="hidden sm:inline">{tc('search')}</span>
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
