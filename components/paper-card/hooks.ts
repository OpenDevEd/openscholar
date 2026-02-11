"use client";

import { useCallback, useContext } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  useTranslationStore,
  useSearchHistoryStore,
} from "@/lib/store";
import { useSearchOptional } from "@/lib/search";
import { createCitationSearch } from "@/lib/search";
import { getEffectiveSearchId } from "@/lib/utils";
import { ScreeningContext, TranslationContext } from "@/components/results-list";
import { appToast } from "@/lib/toast";

// ==================== Types ====================

export interface PaperData {
  id: string;
  title: string;
  abstract: string;
  publication_year?: number;
  authorships?: { author: { display_name: string } }[];
  primary_location?: {
    source?: { display_name: string };
  };
  biblio?: {
    volume?: string;
    issue?: string;
    first_page?: string;
    last_page?: string;
  };
  cited_by_count?: number;
  referenced_works_count?: number;
  related_works?: any[];
  open_access?: {
    is_oa: boolean;
    oa_url?: string;
  };
  doi?: string;
}

export interface TranslationContent {
  translatedTitle: string;
  translatedAbstract: string;
  sourceLanguage: string;
  isAlreadyInEnglish?: boolean;
}

// ==================== useTranslate ====================

/**
 * Hook for reading translation state from the store and context.
 * Translation is triggered by useBatchTranslation in results-list.tsx.
 * This hook is now a pure "reader" - it doesn't trigger translations.
 */
export function useTranslate(
  data: { id: string; title: string; abstract: string } | undefined,
  _autoSet: boolean = true
) {
  const search = useSearchOptional();
  const selectedLanguage = search?.params?.lang ?? '';

  // Use selectors to subscribe to specific translation data
  const translatedContent = useTranslationStore(
    (state) => (data?.id ? state.translations[data.id] || null : null)
  );
  const showTranslated = useTranslationStore(
    (state) => (data?.id ? state.showTranslations[data.id] || false : false)
  );
  const setShowTranslatedStore = useTranslationStore((state) => state.setShowTranslated);

  // Get loading state from context (provided by useBatchTranslation)
  const { loadingPaperIds } = useContext(TranslationContext);

  const isTranslating = data?.id ? (loadingPaperIds?.has(data.id) ?? false) : false;

  const setShowTranslated = useCallback(
    (show: boolean) => {
      if (data?.id) {
        setShowTranslatedStore(data?.id, show);
      }
    },
    [data?.id, setShowTranslatedStore]
  );

  return {
    translatedContent,
    showTranslated,
    isTranslating,
    setShowTranslated,
    selectedLanguage,
  };
}

// ==================== useScreening ====================

export function useScreening(data: {
  id: string;
  title: string;
  abstract: string;
}) {
  const pathname = usePathname();
  const searchId = getEffectiveSearchId(pathname, undefined);
  
  const { getSearchResult } = useSearchHistoryStore();
  const searchResult = getSearchResult(searchId || "");

  const {
    missingResponses,
    existingResponses,
    loadingQuestions,
  } = useContext(ScreeningContext);

  const myExistingResponses = existingResponses?.[data.id] || {};
  const myMissingResponses = missingResponses?.[data.id] || [];
  // Get the set of loading questions for this paper (or empty set)
  const myLoadingQuestions = loadingQuestions?.[data.id] ?? new Set<string>();

  const screeningQuestions = searchResult?.screeningQuestions || [];
  const screeningResponses = searchResult?.screeningResponses || {};

  return {
    screeningQuestions,
    screeningResponses,
    myExistingResponses,
    myLoadingQuestions,
    myMissingResponses,
  };
}


// ==================== useCitationHandlers ====================

export function useCitationHandlers(paperId: string) {
  const router = useRouter();

  const handleFilteredSearch = useCallback(
    (filterType: "cites" | "citedBy" | "related") => {
      const { url } = createCitationSearch(paperId, filterType);
      router.push(url);
    },
    [paperId, router]
  );

  return {
    handleCitesSearch: () => handleFilteredSearch("cites"),
    handleCitedBySearch: () => handleFilteredSearch("citedBy"),
    handleRelatedSearch: () => handleFilteredSearch("related"),
  };
}