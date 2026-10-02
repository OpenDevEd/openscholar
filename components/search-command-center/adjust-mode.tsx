"use client";
"use no memo"; // Sync effect for editableQuery when urlQuery changes (prev/next); try/finally in enhance handler

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FloatingInput } from "./components/floating-input";
import { QueryHistoryNav } from "./components/query-history-nav";
import { QueryTextarea } from "./components/query-textarea";
import { OqlQueryStatus } from "./components/oql-query-status";
import { OQL_FIELD } from "@/lib/openalex/oql";
import { useSearch } from "@/lib/search";
import { useQueryHistory } from "@/lib/hooks";
import { useAppToast } from "@/lib/toast";
import { useEnhanceSearchQuery } from "@/lib/ai/client/router";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation-browser";
import { languageOptions } from "@/lib/ai/core/languages";
import { AISetupGate } from "@/components/ai/ai-setup-gate";

interface AdjustModeProps {
  searchId: string;
  isLoading?: boolean;
  isValidating?: boolean;
  allowEmpty?: boolean;
}

export function AdjustMode({ searchId, isLoading, isValidating, allowEmpty = false }: AdjustModeProps) {
  const toast = useAppToast();
  const t = useTranslations();
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
  const isOql = search.params.field === OQL_FIELD;

  // Handle manual query submission
  const submitQuery = useCallback(() => {
    if (allowEmpty || editableQuery.trim()) {
      search.setQuery(editableQuery);
    }
  }, [search, editableQuery, allowEmpty]);

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

Please enhance this academic search query according to the user's specific instructions while following ${isOql ? "OpenAlex Query Language (OQL) rules" : "Elasticsearch Query String Query syntax rules"}.${
        urlLanguage
          ? ` The output MUST be translated to ${languageName} if it is not already in that language.`
          : ""
      }`;

      const response = await enhanceQuery({
        query: enhancedPrompt,
        language: urlLanguage || localeToLanguageCode(locale) || undefined,
        syntax: isOql ? "oql" : undefined,
        task: "refine",
      });

      search.setQuery(response.enhancedQuery);

      // Flash effect
      setQueryFlash(true);
      setTimeout(() => setQueryFlash(false), 1000);


      setAiInstructions("");
    } catch (error) {
      toast.ai.failed(t("searchCommand.enhancement"), error);
    } finally {
      setIsEnhancing(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {!isConfigured && <AISetupGate />}

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

      {/* Editable query, with the same box the import search dialog uses */}
      <QueryTextarea
        label={isOql ? t("searchCommand.oqlQuery") : t("searchCommand.currentQuery")}
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
        value={editableQuery}
        onChange={setEditableQuery}
        onSubmit={submitQuery}
        placeholder={t("searchCommand.noQuerySet")}
        disabled={isFormDisabled}
        busy={isLoading || isValidating}
        allowEmpty={allowEmpty}
        flash={queryFlash}
      />
      {isOql && <OqlQueryStatus error={search.error} />}
    </div>
  );
}
