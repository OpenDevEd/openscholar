"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import posthog from "posthog-js";
import { motion } from "motion/react";
import { Expand, Minimize2, Loader2, Eye, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedCount } from "./components/animated-count";
import { useSearchOptional } from "@/lib/search";
import { useCurrentQuestionStore } from "@/lib/store";
import { appToast, getErrorMessage, runWithLoadingToast } from "@/lib/toast";
import { useEnhanceSearchQuery } from "@/lib/ai/client/router";
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
  const t = useTranslations();
  const tv = useTranslations("validation");
  const tsc = useTranslations("searchCommand");
  const search = useSearchOptional();
  const { currentQuestion } = useCurrentQuestionStore();

  const [isBroadening, setIsBroadening] = useState(false);
  const [isNarrowing, setIsNarrowing] = useState(false);

  // Use the new router hook
  const { execute: enhanceQuery, isConfigured } = useEnhanceSearchQuery();

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
      appToast.validation.failed(tv("noQueryToBroaden"));
      return;
    }

    if (!isConfigured) {
      appToast.ai.configRequired(tv("aiConfigRequired"));
      return;
    }

    const { expandedQuery } = validateAndExpandKeywordsSilently(effectiveQuery);

    setIsBroadening(true);

    const broadenPrompt = `Current query: "${expandedQuery}"
${currentQuestion ? `Research Question: "${currentQuestion}"` : ""}
${currentLanguage ? `Language Context: "${currentLanguage}"` : ""}

This query is returning fewer than 10 results. Please broaden the search by:
1. Expanding beyond overly restrictive search terms
2. Using more OR operators to include synonyms
3. Removing overly specific constraints
4. Making the query more inclusive while maintaining the core research intent

Return a more inclusive version of this query.`;

    try {
      await runWithLoadingToast({
        loading: tsc("broadeningSearch"),
        run: async () => {
          const result = await enhanceQuery({ query: broadenPrompt, language: currentLanguage || undefined });

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
          title: tsc("queryBroadened"),
          description: tsc("newQuery", { query: result.enhancedQuery }),
        }),
        error: (error) => ({
          title: tsc("failedToBroaden"),
          description: getErrorMessage(error, "An unexpected error occurred. Please try again."),
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
      appToast.validation.failed(tv("noQueryToNarrow"));
      return;
    }

    if (!isConfigured) {
      appToast.ai.configRequired(tv("aiConfigRequired"));
      return;
    }

    const { expandedQuery } = validateAndExpandKeywordsSilently(effectiveQuery);

    setIsNarrowing(true);

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

    try {
      await runWithLoadingToast({
        loading: tsc("makingSearchSpecific"),
        run: async () => {
          const result = await enhanceQuery({ query: narrowPrompt, language: currentLanguage || undefined });

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
          title: tsc("queryMadeSpecific"),
          description: tsc("newQuery", { query: result.enhancedQuery }),
        }),
        error: (error) => ({
          title: tsc("failedToNarrow"),
          description: getErrorMessage(error, "An unexpected error occurred. Please try again."),
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
          <span className="text-muted-foreground">{t("common.results")}</span>
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
                {tsc("makeBroader")}
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
                {tsc("makeSpecific")}
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
        <span className="hidden sm:inline">{t("common.screen")}</span>
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
