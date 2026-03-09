"use client";
"use no memo"; // try/finally in handlers

import React, { useState } from "react";
import { useTranslations, useLocale, useFormatter } from "next-intl";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import posthog from "posthog-js";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Expand, Minimize2, Loader2, Eye, ChevronDown, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AnimatedCount } from "./components/animated-count";
import { useSearchOptional } from "@/lib/search";
import { useCurrentQuestionStore } from "@/lib/store";
import { useAppToast, getErrorMessage } from "@/lib/toast";
import { useEnhanceSearchQuery } from "@/lib/ai/client/router";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";
import { ResultsTranslationControl } from "./components/results-translation-control";
import { ScreeningDialog } from "@/components/screening/screening-dialog";

interface SearchCommandFooterProps {
  totalCount: number;
  currentQuery: string;
  isScreeningOpen: boolean;
  onScreeningToggle: () => void;
  screeningPanelId: string;
  screeningQuestionCount: number;
  searchId: string;
  isLoading?: boolean;
}

export function SearchCommandFooter({
  totalCount,
  currentQuery,
  isScreeningOpen,
  onScreeningToggle,
  screeningPanelId,
  screeningQuestionCount,
  searchId,
  isLoading,
}: SearchCommandFooterProps) {
  const toast = useAppToast();
  const t = useTranslations();
  const tv = useTranslations("validation");
  const tsc = useTranslations("searchCommand");
  const te = useTranslations("errors");
  const locale = useLocale();
  const format = useFormatter();
  const shouldReduceMotion = useReducedMotion();
  const search = useSearchOptional();
  const { currentQuestion } = useCurrentQuestionStore();

  const [isBroadening, setIsBroadening] = useState(false);
  const [isNarrowing, setIsNarrowing] = useState(false);
  const [isScreeningDialogOpen, setIsScreeningDialogOpen] = useState(false);

  // Use the new router hook
  const { execute: enhanceQuery, isConfigured } = useEnhanceSearchQuery();

  const effectiveQuery = currentQuery || search?.params?.q || "";
  const currentLanguage = search?.params?.lang ?? "";

  // Show buttons conditionally
  const showBroadenButton = totalCount < 10 && totalCount >= 0 && effectiveQuery.trim();
  const showNarrowButton = totalCount > 1000 && effectiveQuery.trim();
  const contextualAction = showBroadenButton
    ? "broaden"
    : showNarrowButton
      ? "narrow"
      : null;
  const contextualTransition = shouldReduceMotion ? { duration: 0 } : subtleSpring;
  const isContextualActionLoading =
    contextualAction === "broaden" ? isBroadening : isNarrowing;

  // Wrap screening toggle to add tracking
  const handleScreeningToggle = () => {
    posthog.capture("screening_panel_toggled", {
      is_open: !isScreeningOpen,
    });
    onScreeningToggle();
  };

  const handleBroadenQuery = async () => {
    if (!effectiveQuery.trim()) {
      toast.validation.failed(tv("noQueryToBroaden"));
      return;
    }

    if (!isConfigured) {
      toast.ai.configRequired(tv("aiConfigRequired"));
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
      const result = await enhanceQuery({
        query: broadenPrompt,
        language: currentLanguage || localeToLanguageCode(locale) || undefined,
      });

      if (search) {
        search.setQuery(result.enhancedQuery);
      }

      // Track query broadened
      posthog.capture("query_broadened", {
        original_query: expandedQuery,
        broadened_query: result.enhancedQuery,
      });
    } catch (error) {
      toast.error(
        tsc("failedToBroaden"),
        getErrorMessage(error, te("unexpectedErrorRetry"))
      );
    } finally {
      setIsBroadening(false);
    }
  };

  const handleNarrowQuery = async () => {
    if (!effectiveQuery.trim()) {
      toast.validation.failed(tv("noQueryToNarrow"));
      return;
    }

    if (!isConfigured) {
      toast.ai.configRequired(tv("aiConfigRequired"));
      return;
    }

    const { expandedQuery } = validateAndExpandKeywordsSilently(effectiveQuery);

    setIsNarrowing(true);

    const narrowPrompt = `Current query: "${expandedQuery}"
Current results: ${format.number(totalCount)} papers found
${currentQuestion ? `Research Question: "${currentQuestion}"` : ""}
${currentLanguage ? `Language Context: "${currentLanguage}"` : ""}

This query is returning too many results. Please make it more specific by:
1. Focusing on the core research question
2. Adding more specific keywords
3. Using more precise technical terminology
4. Adding exclusion terms if needed

Return a more targeted version of this query.`;

    try {
      const result = await enhanceQuery({
        query: narrowPrompt,
        language: currentLanguage || localeToLanguageCode(locale) || undefined,
      });

      if (search) {
        search.setQuery(result.enhancedQuery);
      }

      // Track query narrowed
      posthog.capture("query_narrowed", {
        original_query: expandedQuery,
        narrowed_query: result.enhancedQuery,
      });
    } catch (error) {
      toast.error(
        tsc("failedToNarrow"),
        getErrorMessage(error, te("unexpectedErrorRetry"))
      );
    } finally {
      setIsNarrowing(false);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        "border-t border-border/40"
      )}
    >
      {/* Left: Results count */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <AnimatedCount
            value={totalCount}
            className="text-lg font-semibold text-foreground"
          />
          <span className="text-muted-foreground">{t("common.results")}</span>
        </div>
      </div>

      <div className="self-end sm:self-auto">
        <motion.div
          layout
          transition={contextualTransition}
          className={cn(
            "inline-flex items-center rounded-2xl border border-border/70 bg-background/90 p-1 shadow-sm"
          )}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {contextualAction && (
              <motion.div
                key={contextualAction}
                layout
                initial={
                  shouldReduceMotion
                    ? { opacity: 1, x: 0, scale: 1 }
                    : { opacity: 0, x: -10, scale: 0.96 }
                }
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={
                  shouldReduceMotion
                    ? { opacity: 1, x: 0, scale: 1 }
                    : { opacity: 0, x: -10, scale: 0.96 }
                }
                transition={contextualTransition}
                className="inline-flex items-center"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={
                    contextualAction === "broaden"
                      ? handleBroadenQuery
                      : handleNarrowQuery
                  }
                  disabled={Boolean(isLoading) || isContextualActionLoading}
                  title={
                    contextualAction === "broaden"
                      ? tsc("makeBroader")
                      : tsc("makeSpecific")
                  }
                  aria-label={
                    contextualAction === "broaden"
                      ? tsc("makeBroader")
                      : tsc("makeSpecific")
                  }
                  className={cn(
                    "h-9 gap-1.5 rounded-xl border border-transparent px-2.5 text-muted-foreground hover:bg-muted/55 hover:text-foreground",
                    isContextualActionLoading && "text-foreground"
                  )}
                >
                  {isContextualActionLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : contextualAction === "broaden" ? (
                    <Expand className="h-3.5 w-3.5" />
                  ) : (
                    <Minimize2 className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden text-sm font-medium sm:inline">
                    {contextualAction === "broaden"
                      ? tsc("makeBroader")
                      : tsc("makeSpecific")}
                  </span>
                </Button>
                <div className="mx-1 h-6 w-px bg-border/70" />
              </motion.div>
            )}
          </AnimatePresence>

          <ResultsTranslationControl
            disabled={isLoading}
            triggerVariant="ghost"
            compactTrigger
            triggerClassName="h-9 rounded-xl border-0 bg-transparent px-2.5 text-muted-foreground hover:bg-muted/55 hover:text-foreground"
          />

          <div className="mx-1 h-6 w-px bg-border/70" />
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setIsScreeningDialogOpen(true)}
            disabled={Boolean(isLoading)}
            title={tsc("screenAll")}
            aria-label={tsc("screenAll")}
            className="h-9 gap-1.5 rounded-xl border border-transparent px-2.5 text-muted-foreground hover:bg-muted/55 hover:text-foreground"
          >
            <ListChecks className="h-3.5 w-3.5" />
            <span className="hidden text-sm font-medium sm:inline">
              {tsc("screenAll")}
            </span>
          </Button>

          <div className="mx-1 h-6 w-px bg-border/70" />

          {/* Right: Screen toggle */}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={handleScreeningToggle}
            aria-expanded={isScreeningOpen}
            aria-controls={screeningPanelId}
            className={cn(
              "h-9 min-w-[130px] justify-between gap-2 rounded-xl border border-transparent px-2.5",
              "text-muted-foreground hover:bg-muted/55 hover:text-foreground",
              isScreeningOpen &&
                "border-border/70 bg-card text-foreground shadow-[0_10px_22px_-18px_var(--color-primary)]"
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              <Eye className="h-4 w-4" />
              <span className="text-sm font-medium">{t("common.screen")}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Badge
                variant={isScreeningOpen ? "default" : "outline"}
                className={cn(
                  "h-5 min-w-5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                  isScreeningOpen
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground"
                )}
              >
                {screeningQuestionCount}
              </Badge>
              <motion.div
                animate={{ rotate: isScreeningOpen ? 180 : 0 }}
                transition={subtleSpring}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </motion.div>
            </span>
          </Button>
        </motion.div>
      </div>

      <ScreeningDialog
        open={isScreeningDialogOpen}
        onOpenChange={setIsScreeningDialogOpen}
        searchId={searchId}
      />
    </div>
  );
}
