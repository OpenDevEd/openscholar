"use client";
"use no memo"; // Sync effect for editableQuery when urlQuery changes (prev/next); try/finally in enhance handler

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { Search, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FloatingInput } from "./components/floating-input";
import { QueryHistoryNav } from "./components/query-history-nav";
import { useSearch } from "@/lib/search";
import { useQueryHistory } from "@/lib/hooks";
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
  const th = useTranslations("home");
  const tv = useTranslations("validation");
  const locale = useLocale();
  const search = useSearch();

  // Use the new router hook
  const { execute: enhanceQuery, isConfigured } = useEnhanceSearchQuery();

  // Get query from URL params
  const urlQuery = search.params.q;
  const urlLanguage = search.params.lang ?? "";

  // Local state for editing; kept in sync with urlQuery when URL changes (e.g. prev/next)
  const [editableQuery, setEditableQuery] = useState(urlQuery);

  // Sync editableQuery when urlQuery changes (prev/next navigation, external updates)
  useEffect(() => {
    setEditableQuery(urlQuery);
  }, [urlQuery]);
  const [aiInstructions, setAiInstructions] = useState("");
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [queryFlash, setQueryFlash] = useState(false);

  // Query history navigation (shared with SearchMode)
  const {
    historyIndex, historyLength, canGoPrevious, canGoNext, goToPrevious, goToNext,
  } = useQueryHistory(searchId, search.setQuery);

  const isFormDisabled = isLoading || isValidating || isEnhancing;

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

  // Match home screen: Enter = submit, Shift+Enter = new line
  const handleQueryKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit]
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
        language: urlLanguage || localeToLanguageCode(locale) || undefined,
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
              variant="ai"
              disabled={isFormDisabled || !aiInstructions.trim()}
              className="h-7 px-2.5 text-xs gap-1.5"
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
            <QueryHistoryNav
              historyIndex={historyIndex}
              historyLength={historyLength}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
              onPrevious={goToPrevious}
              onNext={goToNext}
              disabled={isFormDisabled}
            />
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
              onKeyDown={handleQueryKeyDown}
              disabled={isFormDisabled}
            />
            
            {/* Bottom bar: hints + search button (same as home screen) */}
            <div className="flex flex-wrap items-center justify-end md:justify-between gap-2 pt-1.5 border-t border-border/40">
              <div className="text-xs text-muted-foreground hidden md:flex flex-wrap items-center gap-2 shrink-0 order-2 md:order-1">
                <span className="px-1.5 py-0.5 rounded-md bg-muted/50 border border-border/50 font-mono">
                  {th("enterKey")}
                </span>
                {th("toSubmit")}
                <span className="mx-1 opacity-20">|</span>
                <span className="px-1.5 py-0.5 rounded-md bg-muted/50 border border-border/50 font-mono">
                  {th("shiftEnterKey")}
                </span>
                {th("newLine")}
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={isFormDisabled || !editableQuery.trim()}
                className={cn("order-1 md:order-2 h-7 px-3 text-xs")}
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
