"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  useUIStore,
  useCurrentQueryStore,
} from "@/lib/store";
import { useAppToast } from "@/lib/toast";
import {
  useQueryChangeHandler,
  useCreateSearchFilters,
} from "@/lib/hooks";
import { submitNewSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import { Search, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { useAIConfigStore } from "@/lib/store";
import Image from "next/image";
import { subtleSpring } from "@/lib/animation-config";
import { useEnhanceSearchQuery } from "@/lib/ai/client/router";
import { useTranslations, useLocale } from "next-intl";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";

function PageContent() {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const tToast = useTranslations("toast");
  const tAccessibility = useTranslations("accessibility");
  const locale = useLocale();
  const toast = useAppToast();
  const router = useRouter();

  const { loadingResultIndex, setLoadingResultIndex } = useUIStore();

  // Loading state for AI enhancement
  const [isEnhancingQuestion, setIsEnhancingQuestion] = React.useState(false);

  // Home page doesn't need SWR loading states - just local state
  const isFormDisabled = loadingResultIndex !== null || isEnhancingQuestion;

  // Use shared current query state for navbar/home page synchronization
  const { currentQuery, setCurrentQuery } = useCurrentQueryStore();
  const handleQueryChange = useQueryChangeHandler(setCurrentQuery);

  // AI configuration and research question state
  const { apiKeyMode } = useAIConfigStore();

  // Use the new router hook that respects apiKeyMode
  const { execute: enhanceQuery, isConfigured: isAIConfigured } = useEnhanceSearchQuery();

  const createSearchFilters = useCreateSearchFilters();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const form = new FormData(e.currentTarget);
    const originalQuery = form.get("query") as string;

    setLoadingResultIndex(null);

    let searchQuery = originalQuery;

    // Check if the query ends with a question mark (indicating a research question)
    if (originalQuery.trim().endsWith('?')) {
      try {
        // Start AI enhancement loading state
        setIsEnhancingQuestion(true);

        // Convert research question to search query using AI
        // The router hook respects apiKeyMode - local mode uses store's API key, credits mode uses Convex
        const result = await enhanceQuery({ query: originalQuery, language: localeToLanguageCode(locale) });

        // Use the enhanced query for searching
        searchQuery = result.enhancedQuery;

        toast.ai.succeeded(tToast("researchQuestionProcessed"), tToast("convertedToSearchQuery", { query: searchQuery }));

      } catch (error) {
        console.error("Failed to convert research question:", error);
        toast.ai.failed(tToast("questionConversion"), error);
        return;
      } finally {
        // End AI enhancement loading state
        setIsEnhancingQuestion(false);
      }
    }

    // Create FormData with the processed query value
    const formData = new FormData();
    formData.set("query", searchQuery);

    // Include research question if it was detected
    if (originalQuery.trim().endsWith('?')) {
      formData.set("researchQuestion", originalQuery);
    }

    // Create filters object from current state
    const filters = createSearchFilters();

    // Submit new search and get the URL to navigate to
    const researchQuestion = originalQuery.trim().endsWith('?') ? originalQuery : undefined;
    const { url } = submitNewSearch(searchQuery, filters, researchQuestion);

    // Navigate to the results page with search params
    router.push(url);
  };

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8 md:py-12">
      <div className="w-full max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={subtleSpring}
          className={cn(
            "relative rounded-2xl overflow-hidden",
            "bg-background/80 dark:bg-background/60",
            "backdrop-blur-xl backdrop-saturate-150",
            "border border-border/50",
            "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]"
          )}
        >
          {/* Subtle gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent pointer-events-none" />

          {/* Header */}
          <div className={cn("relative px-4 md:px-6 py-6", "border-b border-border/40")}>
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...subtleSpring, delay: 0.05 }}
              className="flex flex-col items-center text-center gap-3"
            >
              {/* Logo SVG */}
              <div className="relative">
                <Image
                  src="/icon.svg"
                  alt={tAccessibility("logoAlt")}
                  width={64}
                  height={64}
                  className="w-14 h-14 md:w-16 md:h-16"
                  priority
                />
                {/* Subtle glow effect */}
                <div className="absolute inset-0 bg-primary/20 blur-2xl -z-10 scale-150" />
              </div>

              {/* Title + Description */}
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-baseline justify-center">
                  OpenScholar
                  <span className="text-base md:text-lg font-medium text-muted-foreground">.ai</span>
                </h1>
                <p className="text-sm md:text-base text-muted-foreground mt-1">
                  {t("tagline")}
                </p>
              </div>
            </motion.div>
          </div>

          {/* Search Form */}
          <div className="relative p-4 md:p-6">
            {/* AI Enhancement Loading */}
            <AnimatePresence>
              {isEnhancingQuestion && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="mb-4"
                >
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-50 border border-orange-200 dark:bg-orange-950/30 dark:border-orange-800">
                    <Loader2 className="h-4 w-4 animate-spin text-orange-600 dark:text-orange-400" />
                    <span className="text-sm text-orange-700 dark:text-orange-300">
                      {t("convertingQuestion")}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Search Input */}
              <div className="relative">
                <Textarea
                  name="query"
                  value={currentQuery}
                  placeholder={t("searchPlaceholder")}
                  className="w-full border border-border/50 bg-background/50 rounded-xl resize-none min-h-[100px] max-h-40 focus-visible:ring-1 focus-visible:ring-primary/50 focus-visible:ring-offset-0 text-base md:text-lg placeholder:text-muted-foreground/60 p-4"
                  disabled={isFormDisabled}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const form = e.currentTarget.form;
                      if (form) {
                        form.requestSubmit();
                      }
                    }
                  }}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3">
                <Button
                  type="submit"
                  disabled={isFormDisabled || !currentQuery.trim()}
                  size="lg"
                  className="rounded-full px-6 gap-2 btn-hover"
                >
                  {isEnhancingQuestion ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      <span>{tc("processing")}</span>
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" />
                      <span>{tc("search")}</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>

          {/* Footer - Keyboard Hints */}
          <div className={cn("relative px-4 md:px-6 py-3", "border-t border-border/40", "bg-muted/20")}>
            <p className="text-center text-xs text-muted-foreground">
              {t.rich("enterToSearch", {
                kbd: (chunks) => (
                  <kbd className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs font-mono">
                    {chunks}
                  </kbd>
                ),
              })}
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(PageContent), { ssr: false });
