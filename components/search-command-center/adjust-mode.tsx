"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Search, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FloatingInput, FloatingTextarea } from "./components/floating-input";
import { useSearch } from "@/lib/search";
import { useSearchHistoryStore, useAIConfigStore } from "@/lib/store";
import { usePathname } from "next/navigation";
import { getEffectiveSearchId } from "@/lib/utils";
import { toast } from "sonner";
import { enhanceSearchQuery } from "@/app/actions/ai-enhance";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { languageOptions } from "@/components/language-selector";
import { cn } from "@/lib/utils";
import { subtleSpring } from "./index";

interface AdjustModeProps {
  searchId: string;
  isLoading?: boolean;
  isValidating?: boolean;
}

export function AdjustMode({ searchId, isLoading, isValidating }: AdjustModeProps) {
  const search = useSearch();
  const pathname = usePathname();
  const { provider, model, apiKey } = useAIConfigStore();

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

  // Update history index when query history changes
  useEffect(() => {
    if (queryHistory.length > 0) {
      setHistoryIndex(queryHistory.length - 1);
    }
  }, [queryHistory.length]);

  // Navigation handlers
  const canGoPrevious = queryHistory.length > 0 && historyIndex > 0;
  const canGoNext = queryHistory.length > 0 && historyIndex < queryHistory.length - 1;

  const goToPrevious = useCallback(() => {
    if (canGoPrevious) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      search.setQuery(queryHistory[prevIndex].query);
    }
  }, [canGoPrevious, historyIndex, queryHistory, search]);

  const goToNext = useCallback(() => {
    if (canGoNext) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      search.setQuery(queryHistory[nextIndex].query);
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

    if (!apiKey || !provider) {
      toast.error("Configuration Required", {
        description: "Please configure your AI API key in settings.",
      });
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

      const response = await enhanceSearchQuery(
        enhancedPrompt,
        provider,
        apiKey,
        model,
        urlLanguage || undefined
      );

      search.setQuery(response.enhancedQuery);

      // Flash effect
      setQueryFlash(true);
      setTimeout(() => setQueryFlash(false), 1000);

      toast.success("Query enhanced!", {
        description: response.explanation,
      });

      setAiInstructions("");
    } catch {
      toast.error("Enhancement failed", {
        description: "Please check your API key and try again.",
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={subtleSpring}
      className="px-4 py-5 space-y-4"
    >
      {/* History Navigation */}
      <div className="flex items-center justify-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={goToPrevious}
          disabled={!canGoPrevious || isFormDisabled}
          className="h-8 w-8"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <span className="text-sm text-muted-foreground tabular-nums min-w-[80px] text-center">
          {queryHistory.length > 0 ? (
            <>
              Query{" "}
              <span className="font-medium text-foreground">
                {historyIndex + 1}
              </span>{" "}
              of {queryHistory.length}
            </>
          ) : (
            "No history"
          )}
        </span>

        <Button
          variant="ghost"
          size="icon"
          onClick={goToNext}
          disabled={!canGoNext || isFormDisabled}
          className="h-8 w-8"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* AI Enhancement Input */}
      <form onSubmit={handleAiEnhancement}>
        <FloatingInput
          label="Enhance with AI"
          placeholder="e.g., make it more specific about clinical trials..."
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
              className="h-8 px-3"
            >
              {isEnhancing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Go
                  <span className="hidden sm:inline ml-1">→</span>
                </>
              )}
            </Button>
          }
        />
      </form>

      {/* Editable Query Textarea */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <FloatingTextarea
          label="Current Query"
          placeholder="No query set..."
          value={editableQuery}
          onChange={(e) => setEditableQuery(e.target.value)}
          disabled={isFormDisabled}
          flash={queryFlash}
        />

        {/* Search Button */}
        <div className="flex justify-center">
          <Button
            type="submit"
            disabled={isFormDisabled || !editableQuery.trim()}
            className="h-10 px-6"
          >
            {isLoading || isValidating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Search
          </Button>
        </div>
      </form>
    </motion.div>
  );
}
