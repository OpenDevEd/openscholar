"use client";

import React, { useState } from "react";
import posthog from "posthog-js";
import { motion } from "framer-motion";
import { Expand, Minimize2, Loader2, Eye, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedCount } from "./components/animated-count";
import { useSearchOptional } from "@/lib/search";
import { useAIConfigStore, useCurrentQuestionStore, useAISettingsDialogStore } from "@/lib/store";
import { appToast, getErrorMessage, runWithLoadingToast } from "@/lib/toast";
import { enhanceSearchQuery } from "@/app/actions/ai-enhance";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";

interface SearchCommandFooterProps {
  totalCount: number;
  currentQuery: string;
  isScreeningOpen: boolean;
  onScreeningToggle: () => void;
  isLoading?: boolean;
}

export function SearchCommandFooter({
  totalCount,
  currentQuery,
  isScreeningOpen,
  onScreeningToggle,
  isLoading,
}: SearchCommandFooterProps) {
  const search = useSearchOptional();
  const { provider, model, apiKey } = useAIConfigStore();
  const { currentQuestion } = useCurrentQuestionStore();

  const [isBroadening, setIsBroadening] = useState(false);
  const [isNarrowing, setIsNarrowing] = useState(false);

  const effectiveQuery = currentQuery || search?.params?.q || "";
  const currentLanguage = search?.params?.lang ?? "";

  // Show buttons conditionally
  const showBroadenButton = totalCount < 10 && totalCount >= 0 && effectiveQuery.trim();
  const showNarrowButton = totalCount > 1000 && effectiveQuery.trim();

  // Wrap screening toggle to add tracking
  const handleScreeningToggle = () => {
    posthog.capture("screening_panel_toggled", {
      is_open: !isScreeningOpen,
    });
    onScreeningToggle();
  };

  const handleBroadenQuery = async () => {
    if (!effectiveQuery.trim()) {
      appToast.validation.failed("No active query to broaden.");
      return;
    }

    if (!apiKey || !provider) {
      appToast.ai.configRequired("Please configure your AI settings to broaden this query.");
      return;
    }

    const { expandedQuery } = validateAndExpandKeywordsSilently(effectiveQuery);

    setIsBroadening(true);

    try {
      const broadenPrompt = `Current query: "${expandedQuery}"
${currentQuestion ? `Research Question: "${currentQuestion}"` : ""}
${currentLanguage ? `Language Context: "${currentLanguage}"` : ""}

This query is returning fewer than 10 results. Please broaden the search by:
1. Expanding beyond overly restrictive search terms
2. Using more OR operators to include synonyms
3. Removing overly specific constraints
4. Making the query more inclusive while maintaining the core research intent

Return a more inclusive version of this query.`;

      await runWithLoadingToast({
        loading: "Broadening search...",
        run: async () => {
          const result = await enhanceSearchQuery(
            broadenPrompt,
            provider,
            apiKey,
            model,
            currentLanguage
          );

          if (search) {
            search.setQuery(result.enhancedQuery);
          }

          // Track query broadened
          posthog.capture("query_broadened", {
            original_query: expandedQuery,
            broadened_query: result.enhancedQuery,
          });

          return result;
        },
        success: (result) => ({
          title: "Query broadened",
          description: `New query: "${result.enhancedQuery}"`,
        }),
        error: (error) => ({
          title: "Failed to broaden query",
          description: getErrorMessage(
            error,
            "An unexpected error occurred. Please try again."
          ),
          action: {
            label: "Open AI Settings",
            onClick: () => useAISettingsDialogStore.getState().setIsOpen(true),
          },
        }),
      });
    } catch {
      // Toast is already handled by runWithLoadingToast.
    } finally {
      setIsBroadening(false);
    }
  };

  const handleNarrowQuery = async () => {
    if (!effectiveQuery.trim()) {
      appToast.validation.failed("No active query to narrow.");
      return;
    }

    if (!apiKey || !provider) {
      appToast.ai.configRequired("Please configure your AI settings to narrow this query.");
      return;
    }

    const { expandedQuery } = validateAndExpandKeywordsSilently(effectiveQuery);

    setIsNarrowing(true);

    try {
      const narrowPrompt = `Current query: "${expandedQuery}"
Current results: ${totalCount.toLocaleString()} papers found
${currentQuestion ? `Research Question: "${currentQuestion}"` : ""}
${currentLanguage ? `Language Context: "${currentLanguage}"` : ""}

This query is returning too many results. Please make it more specific by:
1. Focusing on the core research question
2. Adding more specific keywords
3. Using more precise technical terminology
4. Adding exclusion terms if needed

Return a more targeted version of this query.`;

      await runWithLoadingToast({
        loading: "Making search more specific...",
        run: async () => {
          const result = await enhanceSearchQuery(
            narrowPrompt,
            provider,
            apiKey,
            model,
            currentLanguage
          );

          if (search) {
            search.setQuery(result.enhancedQuery);
          }

          // Track query narrowed
          posthog.capture("query_narrowed", {
            original_query: expandedQuery,
            narrowed_query: result.enhancedQuery,
          });

          return result;
        },
        success: (result) => ({
          title: "Query made more specific",
          description: `New query: "${result.enhancedQuery}"`,
        }),
        error: (error) => ({
          title: "Failed to narrow query",
          description: getErrorMessage(
            error,
            "An unexpected error occurred. Please try again."
          ),
          action: {
            label: "Open AI Settings",
            onClick: () => useAISettingsDialogStore.getState().setIsOpen(true),
          },
        }),
      });
    } catch {
      // Toast is already handled by runWithLoadingToast.
    } finally {
      setIsNarrowing(false);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-4 py-3",
        "border-t border-border/40"
      )}
    >
      {/* Left: Results count and contextual buttons */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <AnimatedCount
            value={totalCount}
            className="text-lg font-semibold text-foreground"
          />
          <span className="text-muted-foreground">results</span>
        </div>

        {/* Contextual broaden/narrow buttons */}
        {(showBroadenButton || showNarrowButton) && (
          <div className="hidden sm:flex items-center gap-2">
            {showBroadenButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBroadenQuery}
                disabled={isBroadening || isLoading}
                className={cn(
                  "h-7 px-2.5 text-xs gap-1.5",
                  "bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10",
                  "hover:from-violet-500/20 hover:to-fuchsia-500/20",
                  "border-violet-500/30 hover:border-violet-500/50",
                  "text-violet-700 dark:text-violet-300",
                  "transition-all duration-200"
                )}
              >
                {isBroadening ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Expand className="h-3 w-3" />
                )}
                Make broader
              </Button>
            )}
            {showNarrowButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleNarrowQuery}
                disabled={isNarrowing || isLoading}
                className={cn(
                  "h-7 px-2.5 text-xs gap-1.5",
                  "bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10",
                  "hover:from-violet-500/20 hover:to-fuchsia-500/20",
                  "border-violet-500/30 hover:border-violet-500/50",
                  "text-violet-700 dark:text-violet-300",
                  "transition-all duration-200"
                )}
              >
                {isNarrowing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Minimize2 className="h-3 w-3" />
                )}
                Make specific
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Right: Screen toggle */}
      <Button
        variant={isScreeningOpen ? "default" : "outline"}
        size="sm"
        onClick={handleScreeningToggle}
        className={cn(
          "h-8 gap-1.5",
          isScreeningOpen && "bg-primary text-primary-foreground"
        )}
      >
        <Eye className="h-4 w-4" />
        <span className="hidden sm:inline">Screen</span>
        <motion.div
          animate={{ rotate: isScreeningOpen ? 180 : 0 }}
          transition={subtleSpring}
        >
          <ChevronDown className="h-3 w-3" />
        </motion.div>
      </Button>
    </div>
  );
}
