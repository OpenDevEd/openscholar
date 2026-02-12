"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Search, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FloatingInput } from "./components/floating-input";
import { useSearch } from "@/lib/search";
import { useSearchHistoryStore } from "@/lib/store";
import { useAppToast } from "@/lib/toast";
import { useEnhanceSearchQuery } from "@/lib/ai/client/router";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { languageOptions } from "@/lib/ai/core/languages";
import { cn } from "@/lib/utils";

interface AdjustModeProps {
  searchId: string;
  isLoading?: boolean;
  isValidating?: boolean;
}

export function AdjustMode({ searchId, isLoading, isValidating }: AdjustModeProps) {
  const toast = useAppToast();
  const t = useTranslations();
  const tv = useTranslations("validation");
  const search = useSearch();

  // Use the new router hook
  const { execute: enhanceQuery, isConfigured } = useEnhanceSearchQuery();

  // Get query from URL params
  const urlQuery = search.params.q;
  const urlLanguage = search.params.lang ?? "";

  // Local state for editing
  const [editableQuery, setEditableQuery] = useState(urlQuery);
  const [aiInstructions, setAiInstructions] = useState("");
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [queryFlash, setQueryFlash] = useState(false);

  // Get current search result for history navigation
  const currentSearchResult = useSearchHistoryStore((state) =>
    searchId ? state.searchHistory.find((item) => item.id === searchId) : null
  );

  const queryHistory = currentSearchResult?.queryHistory || [];
  const [historyIndex, setHistoryIndex] = useState(
    queryHistory.length > 0 ? queryHistory.length - 1 : 0
  );

  const isFormDisabled = isLoading || isValidating || isEnhancing;

  // Sync editable query when URL query changes
  useEffect(() => {
    setEditableQuery(urlQuery);
  }, [urlQuery]);

  // Track previous history length to detect new additions
  const prevHistoryLengthRef = useRef(queryHistory.length);

  // Update history index only when a NEW entry is added (not when navigating)
  useEffect(() => {
    if (queryHistory.length > prevHistoryLengthRef.current) {
      // New entry added - jump to latest
      setHistoryIndex(queryHistory.length - 1);
    }
    prevHistoryLengthRef.current = queryHistory.length;
  }, [queryHistory.length]);

  // Navigation handlers
  const canGoPrevious = queryHistory.length > 0 && historyIndex > 0;
  const canGoNext = queryHistory.length > 0 && historyIndex < queryHistory.length - 1;

  const goToPrevious = useCallback(() => {
    if (canGoPrevious) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      search.setQuery(queryHistory[prevIndex].query, { skipHistory: true });
    }
  }, [canGoPrevious, historyIndex, queryHistory, search]);

  const goToNext = useCallback(() => {
    if (canGoNext) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      search.setQuery(queryHistory[nextIndex].query, { skipHistory: true });
    }
  }, [canGoNext, historyIndex, queryHistory, search]);

  // Handle manual query submission
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (editableQuery.trim()) {
        search.setQuery(editableQuery);
      }
    },
    [search, editableQuery]
  );

  // Handle AI enhancement
  const handleAiEnhancement = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!aiInstructions.trim() || !urlQuery.trim()) return;

    if (!isConfigured) {
      toast.ai.configRequired(tv("aiConfigRequired"));
      return;
    }

    setIsEnhancing(true);

    try {
      const { expandedQuery } = validateAndExpandKeywordsSilently(urlQuery);
      const languageName = languageOptions.find((o) => o.code === urlLanguage)?.name;

      const enhancedPrompt = `Original query: "${expandedQuery}"

User enhancement instructions: "${aiInstructions}"

Please enhance this academic search query according to the user's specific instructions while following Elasticsearch Query String Query syntax rules.${
        urlLanguage
          ? ` The output MUST be translated to ${languageName} if it is not already in that language.`
          : ""
      }`;

      const response = await enhanceQuery({
        query: enhancedPrompt,
        language: urlLanguage || undefined,
      });

      search.setQuery(response.enhancedQuery);

      // Flash effect
      setQueryFlash(true);
      setTimeout(() => setQueryFlash(false), 1000);

      toast.ai.succeeded(t("searchCommand.queryEnhanced"), response.explanation || undefined);

      setAiInstructions("");
    } catch (error) {
      toast.ai.failed(t("searchCommand.enhancement"), error);
    } finally {
      setIsEnhancing(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* AI Enhancement Input */}
      <form onSubmit={handleAiEnhancement}>
        <FloatingInput
          label={t("searchCommand.enhanceWithAI")}
          placeholder={t("searchCommand.placeholder.enhance")}
          value={aiInstructions}
          onChange={(e) => setAiInstructions(e.target.value)}
          disabled={isFormDisabled}
          icon={<Wand2 className="h-4 w-4" />}
          action={
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={isFormDisabled || !aiInstructions.trim()}
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
                  {t("searchCommand.enhance")}
                </>
              )}
            </Button>
          }
        />
      </form>

      {/* Editable Query Textarea with inline controls */}
      <form onSubmit={handleSubmit}>
        <div className="group relative">
          {/* Floating label with history navigation */}
          <div className="absolute -top-2.5 left-3 z-10 flex items-center gap-2">
            <span
              className={cn(
                "px-1.5 py-0.5 text-xs font-medium",
                "text-muted-foreground bg-background rounded",
                "transition-colors duration-200",
                "group-focus-within:text-primary"
              )}
            >
              {t("searchCommand.currentQuery")}
            </span>
            {queryHistory.length > 1 && (
              <div className="flex items-center gap-0.5 bg-background rounded px-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={goToPrevious}
                  disabled={!canGoPrevious || isFormDisabled}
                  className="h-5 w-5"
                >
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <span className="text-[10px] text-muted-foreground tabular-nums px-0.5">
                  {historyIndex + 1}/{queryHistory.length}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={goToNext}
                  disabled={!canGoNext || isFormDisabled}
                  className="h-5 w-5"
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {/* Textarea container */}
          <div
            className={cn(
              "border rounded-xl px-3 py-2.5",
              "bg-background/50",
              "transition-all duration-300",
              "border-border/60",
              "focus-within:border-primary/50",
              "focus-within:ring-2 focus-within:ring-primary/10",
              "focus-within:bg-background",
              queryFlash && "bg-green-50 border-green-400 dark:bg-green-950/30 dark:border-green-600"
            )}
          >
            <textarea
              className="w-full bg-transparent outline-none resize-none text-sm placeholder:text-muted-foreground/60 min-h-[60px]"
              placeholder={t("searchCommand.noQuerySet")}
              value={editableQuery}
              onChange={(e) => setEditableQuery(e.target.value)}
              disabled={isFormDisabled}
            />
            
            {/* Inline search button */}
            <div className="flex justify-end pt-1.5 border-t border-border/40">
              <Button
                type="submit"
                size="sm"
                disabled={isFormDisabled || !editableQuery.trim()}
                className="h-7 px-3 text-xs"
              >
                {isLoading || isValidating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Search className="h-3.5 w-3.5 mr-1.5" />
                )}
                {t("common.search")}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
