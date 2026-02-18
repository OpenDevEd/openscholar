"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useUIStore, useCurrentQueryStore } from "@/lib/store";
import { useAppToast } from "@/lib/toast";
import { useQueryChangeHandler, useCreateSearchFilters } from "@/lib/hooks";
import { submitNewSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import { Search, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AmbientBackground } from "@/components/home/AmbientBackground";
import { HomeHero } from "@/components/home/HomeHero";
import { SearchInput } from "@/components/home/SearchInput";
import { SearchMode } from "@/components/home/ModeToggle";

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
  const tToast = useTranslations("toast");
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

  // AI configuration and research question state
  const { apiKeyMode } = useAIConfigStore();

  // Use the new router hook that respects apiKeyMode
  const { execute: enhanceQuery, isConfigured: isAIConfigured } =
    useEnhanceSearchQuery();

  const createSearchFilters = useCreateSearchFilters();

  const handleSearchSubmit = async (e: React.FormEvent, mode: SearchMode) => {
    // If the event comes from a form submission, prevent default
    if (e && e.preventDefault) {
      e.preventDefault();
    }

    setLoadingResultIndex(null);

    let searchQuery = currentQuery;
    let originalQuery = currentQuery;

    // Check if we need to do AI enhancement (Research Mode)
    // Research mode is triggered if manually selected OR if query ends with '?'
    const isResearchMode =
      mode === "research" || currentQuery.trim().endsWith("?");

    if (isResearchMode) {
      try {
        // Start AI enhancement loading state
        setIsEnhancingQuestion(true);

        // Convert research question to search query using AI
        // The router hook respects apiKeyMode - local mode uses store's API key, credits mode uses Convex
        const result = await enhanceQuery({
          query: originalQuery,
          language: localeToLanguageCode(locale),
        });

        // Use the enhanced query for searching
        searchQuery = result.enhancedQuery;

        toast.ai.succeeded(
          tToast("researchQuestionProcessed"),
          tToast("convertedToSearchQuery", { query: searchQuery }),
        );
      } catch (error) {
        console.error("Failed to convert research question:", error);
        toast.ai.failed(tToast("questionConversion"), error);
        return;
      } finally {
        // End AI enhancement loading state
        setIsEnhancingQuestion(false);
      }
    }

    // Create filters object from current state
    const filters = createSearchFilters();

    // Submit new search and get the URL to navigate to
    const researchQuestion = isResearchMode ? originalQuery : undefined;
    const { url } = submitNewSearch(searchQuery, filters, researchQuestion);

    // Navigate to the results page with search params
    router.push(url);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[80vh] px-4 overflow-hidden relative">
      <AmbientBackground />

      <div className="w-full max-w-4xl flex flex-col items-center gap-8 relative z-10">
        <HomeHero />

        <SearchInput
          query={currentQuery}
          onQueryChange={setCurrentQuery}
          onSubmit={handleSearchSubmit}
          isEnhancing={isEnhancingQuestion}
          disabled={isFormDisabled}
          className="w-full max-w-2xl"
        />
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(PageContent), { ssr: false });
