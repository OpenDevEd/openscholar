"use client";
"use no memo"; // Sync effect setCurrentQuery(urlQuery) for store; try/finally in handlers

import React, { useState, useEffect, useCallback } from "react";
import { Search, Wand2, Loader2 } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { Button } from "@/components/ui/button";
import { FloatingInput } from "./components/floating-input";
import { QueryHistoryNav } from "./components/query-history-nav";
import { LanguageTranslateControl } from "./components/language-translate-control";
import { useSearchOptional } from "@/lib/search";
import {
  useSearchHistoryStore,
  useCurrentQuestionStore,
  useAIConfigStore,
  useCurrentQueryStore,
  useKeywordExpansionDialogStore,
} from "@/lib/store";
import { useEffectiveSearchId, useQueryHistory } from "@/lib/hooks";
import { useAppToast, getErrorMessage } from "@/lib/toast";
import { useEnhanceSearchQuery, useTranslateQuery } from "@/lib/ai/client/router";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { cn } from "@/lib/utils";
import posthog from "posthog-js";

interface SearchModeProps {
  isLoading?: boolean;
  isValidating?: boolean;
}

export function SearchMode({ isLoading, isValidating }: SearchModeProps) {
  const toast = useAppToast();
  const t = useTranslations("searchCommand");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const tValidation = useTranslations("validation");
  const locale = useLocale();
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
  const urlQuery = search?.params?.q ?? "";
  const [localInputValue, setLocalInputValue] = useState(urlQuery);
  const [isTranslating, setIsTranslating] = useState(false);

  // Sync local input + global store when URL query changes (e.g. history nav, AI enhance, translation)
  useEffect(() => {
    setLocalInputValue(urlQuery);
    setCurrentQuery(urlQuery);
  }, [urlQuery, setCurrentQuery]);

  // Use the new router hooks
  const { execute: enhanceQuery, isConfigured: isEnhanceConfigured } = useEnhanceSearchQuery();
  const { execute: translateQueryFn, isConfigured: isTranslateConfigured, isPlanEntitled: isTranslatePlanEntitled } = useTranslateQuery();

  const selectedLanguage = search?.params?.lang ?? "";

  const isFormDisabled = isLoading || isValidating || isTranslating || isEnhancing;
  const isLanguageSelectorDisabled = isTranslating || isEnhancing;

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

  // Query history navigation (shared with AdjustMode)
  const {
    historyIndex, historyLength, canGoPrevious, canGoNext, goToPrevious, goToNext,
  } = useQueryHistory(effectiveSearchId, search?.setQuery);

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
      toast.validation.failed(tValidation('searchRequired'));
      return;
    }

    if (!isEnhanceConfigured) {
      toast.ai.configRequired(tValidation('aiConfigRequired'));
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
        language: currentSearchResult?.language ?? localeToLanguageCode(locale),
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

    } catch (error) {
      // Track enhancement error
      posthog.capture("ai_query_enhancement_failed", {
        original_question: questionToProcess,
        error_message: getErrorMessage(error, te("unknownError")),
      });

      toast.ai.failed(t("enhancement"), error);
    } finally {
      setIsEnhancing(false);
    }
  };

  // Shared translation logic
  const performTranslation = useCallback(
    async (targetLanguage: string) => {
      if (!search || !targetLanguage || !localInputValue.trim()) return;
      if (!isTranslatePlanEntitled) return; // silently blocked — UI already shows upgrade prompt
      if (!isTranslateConfigured) {
        toast.ai.configRequired(tValidation("aiConfigRequired"));
        return;
      }
      setIsTranslating(true);
      const { expandedQuery } = validateAndExpandKeywordsSilently(localInputValue);
      try {
        const result = await translateQueryFn({
          query: expandedQuery,
          targetLanguage,
        });
        search.setQuery(result.translatedQuery);
        posthog.capture("query_translated", {
          original_query: expandedQuery,
          translated_query: result.translatedQuery,
          target_language: targetLanguage,
        });
      } catch (error) {
        posthog.capture("query_translation_failed", {
          original_query: localInputValue,
          target_language: targetLanguage,
          error_message: getErrorMessage(error, te("translationFailed")),
        });
        toast.error(
          t("translationFailed"),
          getErrorMessage(error, te("unexpectedErrorRetry"))
        );
      } finally {
        setIsTranslating(false);
      }
    },
    [
      search,
      localInputValue,
      isTranslatePlanEntitled,
      isTranslateConfigured,
      translateQueryFn,
      t,
      te,
      toast,
      tValidation,
    ]
  );

  // Handle language change (updates language and auto-translates when there's query text)
  const handleLanguageChange = useCallback(
    async (language: string) => {
      if (!search || language === selectedLanguage) return;
      search.setLanguage(language || null);
      posthog.capture("language_selected", {
        language: language || "none",
        previous_language: selectedLanguage || "none",
        context: "search",
      });
      if (language && localInputValue.trim()) {
        await performTranslation(language);
      }
    },
    [search, selectedLanguage, localInputValue, performTranslation]
  );

  // Handle translate button click
  const handleTranslate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedLanguage) return;
      await performTranslation(selectedLanguage);
    },
    [selectedLanguage, performTranslation]
  );

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
              variant="ai"
              disabled={isFormDisabled || !currentQuestion.trim()}
              className="h-7 px-2.5 text-xs gap-1.5"
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
          labelAddon={
            <QueryHistoryNav
              historyIndex={historyIndex}
              historyLength={historyLength}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
              onPrevious={goToPrevious}
              onNext={goToNext}
              disabled={isFormDisabled}
            />
          }
          placeholder={isTranslating ? tc('translating') : t('placeholder.keywords')}
          value={localInputValue}
          onChange={(e) => handleQueryChange(e.target.value)}
          disabled={isFormDisabled}
          icon={<Search className="h-4 w-4" />}
          action={
            <div className="flex items-center gap-2">
              <LanguageTranslateControl
                value={selectedLanguage}
                onValueChange={handleLanguageChange}
                onTranslate={() => handleTranslate({ preventDefault: () => {} } as React.FormEvent)}
                disabled={isLanguageSelectorDisabled}
                translateDisabled={!localInputValue.trim()}
                isTranslating={isTranslating}
                isPlanEntitled={isTranslatePlanEntitled}
              />
              <Button
                type="submit"
                size="sm"
                disabled={isFormDisabled || !localInputValue.trim()}
                className="px-3"
              >
                <>
                  <Search className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">{tc('search')}</span>
                </>
              </Button>
            </div>
          }
        />
      </form>
    </div>
  );
}
