"use client";

import React, { useState } from "react";
import posthog from "posthog-js";
import { motion } from "framer-motion";
import { Expand, Minimize2, Loader2, Eye, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedCount } from "./components/animated-count";
import { useSearchOptional } from "@/lib/search";
import { useAIConfigStore, useCurrentQuestionStore } from "@/lib/store";
import { toast } from "sonner";
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
    if (!effectiveQuery.trim() || !apiKey || !provider) return;

    const { expandedQuery } = validateAndExpandKeywordsSilently(effectiveQuery);

    setIsBroadening(true);
    const loadingToast = toast.loading("Broadening search...");

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

      const result = await enhanceSearchQuery(broadenPrompt, provider, apiKey, model, currentLanguage);

      if (search) {
        search.setQuery(result.enhancedQuery);
      }

      toast.dismiss(loadingToast);
      toast.success("Query broadened", {
        description: `New query: "${result.enhancedQuery}"`,
      });

      // Track query broadened
      posthog.capture("query_broadened", {
        original_query: expandedQuery,
        broadened_query: result.enhancedQuery,
      });
    } catch {
      toast.dismiss(loadingToast);
      toast.error("Failed to broaden query");
    } finally {
      setIsBroadening(false);
    }
  };

  const handleNarrowQuery = async () => {
    if (!effectiveQuery.trim() || !apiKey || !provider) return;

    const { expandedQuery } = validateAndExpandKeywordsSilently(effectiveQuery);

    setIsNarrowing(true);
    const loadingToast = toast.loading("Making search more specific...");

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

      const result = await enhanceSearchQuery(narrowPrompt, provider, apiKey, model, currentLanguage);

      if (search) {
        search.setQuery(result.enhancedQuery);
      }

      toast.dismiss(loadingToast);
      toast.success("Query made more specific", {
        description: `New query: "${result.enhancedQuery}"`,
      });

      // Track query narrowed
      posthog.capture("query_narrowed", {
        original_query: expandedQuery,
        narrowed_query: result.enhancedQuery,
      });
    } catch {
      toast.dismiss(loadingToast);
      toast.error("Failed to narrow query");
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
                variant="ghost"
                size="sm"
                onClick={handleBroadenQuery}
                disabled={isBroadening || isLoading}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {isBroadening ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Expand className="h-3 w-3 mr-1" />
                )}
                Make broader
              </Button>
            )}
            {showNarrowButton && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNarrowQuery}
                disabled={isNarrowing || isLoading}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {isNarrowing ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Minimize2 className="h-3 w-3 mr-1" />
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
