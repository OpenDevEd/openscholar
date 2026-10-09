"use client";
"use no memo"; // try/finally in handlers

import React, { useState } from "react";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { useTranslations, useLocale, useFormatter } from "next-intl";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import posthog from "posthog-js";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Expand,
  Minimize2,
  Eye,
  ChevronDown,
  ListChecks,
  Coins,
  MessageSquare,
  AiIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AnimatedCount } from "./components/animated-count";
import { useSearchOptional } from "@/lib/search";
import { useCurrentQuestionStore } from "@/lib/store";
import { useAppToast, getErrorMessage } from "@/lib/toast";
import { useEnhanceSearchQuery } from "@/lib/ai/client/router";
import { ensureQueryShortcuts, validateAndExpandKeywordsSilently } from "@/lib/keyword-validation-browser";
import { cn } from "@/lib/utils";
import { OQL_FIELD } from "@/lib/openalex/oql";
import { subtleSpring } from "@/lib/animation-config";
import { ResultsTranslationControl } from "./components/results-translation-control";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { useSignInRedirect } from "@/lib/auth/use-sign-in-redirect";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { chatAbout } from "@/lib/assistant/place";

interface SearchCommandFooterProps {
  totalCount: number;
  currentQuery: string;
  isScreeningOpen: boolean;
  onScreeningToggle: () => void;
  screeningPanelId: string;
  screeningQuestionCount: number;
  searchId: string;
  isLoading?: boolean;
  queryOnly?: boolean;
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
  queryOnly = false,
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
  // AI rewrites in the search's own query language.
  const syntax = search?.params?.field === OQL_FIELD ? ("oql" as const) : undefined;
  const { currentQuestion } = useCurrentQuestionStore();

  const { phase } = useAuthReadiness();
  const goToSignIn = useSignInRedirect();
  const router = useWorkspaceRouter();

  const [isBroadening, setIsBroadening] = useState(false);
  const [isNarrowing, setIsNarrowing] = useState(false);
  const assistantEnabled = useFeatureFlag("assistant.enabled");

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

    await ensureQueryShortcuts(effectiveQuery);
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
        syntax,
        task: "broadenNarrow",
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

    await ensureQueryShortcuts(effectiveQuery);
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
        syntax,
        task: "broadenNarrow",
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

  // A chat about this search, in the assistant: a new chat opens with the search mentioned, so the first message carries its ID.
  const handleStartChat = () => {
    if (phase !== "authenticated") {
      goToSignIn();
      return;
    }
    chatAbout({ kind: "search", id: searchId, label: effectiveQuery.trim() || currentQuestion.trim() || t("common.noQuery") });
    posthog.capture("chat_started_from_results", { search_id: searchId, total_count: totalCount });
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        "border-t border-border-subtle"
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

      {/* On a phone the strip spans the card, its buttons spread across it, so none falls off its edge. */}
      <div className="w-full sm:w-auto">
        <motion.div
          layout
          transition={contextualTransition}
          className={cn(
            "flex w-full items-center justify-between rounded-2xl border border-border bg-field p-1 shadow-sm sm:inline-flex sm:w-auto sm:justify-start"
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
                  aria-label={
                    contextualAction === "broaden"
                      ? tsc("makeBroader")
                      : tsc("makeSpecific")
                  }
                  className={cn(
                    "h-9 gap-1.5 rounded-xl border border-transparent px-2 text-muted-foreground hover:bg-muted hover:text-foreground sm:px-2.5",
                    isContextualActionLoading && "text-foreground"
                  )}
                >
                  {isContextualActionLoading ? (
                    <AiIcon working size={14} className="h-3.5 w-3.5" />
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
                {!queryOnly && <div className="mx-0.5 h-6 w-px bg-border/70 sm:mx-1" />}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Acting on results: translation, screening */}
          {!queryOnly && (
            <>
              <ResultsTranslationControl
                disabled={isLoading}
                triggerVariant="ghost"
                compactTrigger
                triggerClassName="h-9 rounded-xl border-0 bg-transparent px-2 text-muted-foreground hover:bg-muted hover:text-foreground sm:px-2.5"
              />

              <div className="mx-0.5 h-6 w-px bg-border/70 sm:mx-1" />

              {/* AI-actions sub-group: Start Chat + Screen All grouped together; trailing coin glyph signals credit-bearing actions */}
              <div
                className="inline-flex items-center gap-0.5 rounded-xl bg-accent pr-1.5"
                data-group="ai-actions"
              >
                {assistantEnabled && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={handleStartChat}
                    aria-label={tsc("startChat")}
                    className="h-9 gap-1.5 rounded-lg border border-transparent px-2 sm:px-2.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span className="hidden text-sm font-medium sm:inline">{tsc("startChat")}</span>
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => phase === "authenticated" ? router.push(`/screening?search=${encodeURIComponent(searchId)}`) : goToSignIn()}
                  disabled={Boolean(isLoading)}
                  aria-label={tsc("screenAll")}
                  className="h-9 gap-1.5 rounded-lg border border-transparent px-2 sm:px-2.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  <span className="hidden text-sm font-medium sm:inline">
                    {tsc("screenAll")}
                  </span>
                </Button>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={tsc("screenAllCredits")}
                      className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/30 transition-colors hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Coins className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-center">
                    <p className="font-semibold">{tsc("screenAllCredits")}</p>
                    <p className="text-xs opacity-90">{tsc("creditsTooltip")}</p>
                  </TooltipContent>
                </Tooltip>
              </div>

              <div className="mx-0.5 h-6 w-px bg-border/70 sm:mx-1" />

              {/* Right: Screen toggle */}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={handleScreeningToggle}
                aria-label={t("common.screen")}
                aria-expanded={isScreeningOpen}
                aria-controls={screeningPanelId}
                className={cn(
                  "h-9 justify-between gap-2 rounded-xl border border-transparent px-2 sm:min-w-[130px] sm:px-2.5",
                  "text-muted-foreground hover:bg-muted hover:text-foreground",
                  isScreeningOpen &&
                    "border-border bg-card text-foreground shadow-[0_10px_22px_-18px_var(--color-primary)]"
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Eye className="h-4 w-4" />
                  <span className="hidden text-sm font-medium sm:inline">{t("common.screen")}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Badge
                    variant={isScreeningOpen ? "default" : "outline"}
                    className={cn(
                      "h-5 min-w-5 rounded-full px-1.5 text-3xs font-semibold tabular-nums",
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
            </>
          )}
        </motion.div>
      </div>

    </div>
  );
}
