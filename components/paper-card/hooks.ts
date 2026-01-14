"use client";

import { useCallback, useContext } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  useAIConfigStore,
  useTranslationStore,
  useSearchHistoryStore,
  useTransientScreeningStore,
} from "@/lib/store";
import { useSearchOptional } from "@/lib/search";
import { createCitationSearch } from "@/lib/search";
import { getEffectiveSearchId } from "@/lib/utils";
import { translatePaperContent, generateScreeningResponses } from "@/app/actions/ai-enhance";
import { toast } from "sonner";
import useSWRImmutable from "swr/immutable";
import { ScreeningContext } from "@/components/results-list";

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

export function useTranslate(
  data: { id: string; title: string; abstract: string } | undefined,
  autoSet: boolean = true
) {
  const search = useSearchOptional();
  const selectedLanguage = search?.params?.lang ?? '';

  const { provider, model, apiKey } = useAIConfigStore();

  const {
    getTranslation,
    setTranslation,
    clearTranslation,
    getShowTranslated,
    setShowTranslated: setShowTranslatedStore,
  } = useTranslationStore();

  const translatedContent = data?.id ? getTranslation(data.id) : null;
  const showTranslated = data?.id ? getShowTranslated(data.id) : false;

  const setShowTranslated = useCallback(
    (show: boolean) => {
      if (data?.id) {
        setShowTranslatedStore(data?.id, show);
      }
    },
    [data?.id, setShowTranslatedStore]
  );

  const handleTranslateContent = useCallback(async () => {
    const needsTranslation =
      !!selectedLanguage &&
      selectedLanguage !== "en" &&
      (!translatedContent ||
        translatedContent.sourceLanguage !== selectedLanguage);

    if (!apiKey || !provider || !data?.id || !needsTranslation) {
      return;
    }

    try {
      const translation = await translatePaperContent(
        data.title,
        data.abstract || "",
        selectedLanguage,
        provider,
        apiKey,
        model
      );

      setTranslation(data?.id, translation);
      if (autoSet) {
        setShowTranslated(true);
      }
    } catch (error) {
      console.error("Translation error:", error);
    }
  }, [data?.id, data?.title, data?.abstract, translatedContent, selectedLanguage, apiKey, provider, model, setTranslation, autoSet, setShowTranslated]);

  const { isLoading: isTranslating } = useSWRImmutable(
    data?.id ? `translation-${data.id}` : null,
    () => handleTranslateContent()
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
    setScreeningResponses,
    canStartScreening,
  } = useContext(ScreeningContext);

  const myExistingResponses = existingResponses?.[data.id] || {};
  const myMissingResponses = missingResponses?.[data.id] || [];

  const { testIndexPerQuestion } = useTransientScreeningStore();

  const stableMyMissingResponses = JSON.stringify(
    myMissingResponses.map(
      (question) => question + "#" + (testIndexPerQuestion[question] || 0)
    )
  );

  const screeningQuestions = searchResult?.screeningQuestions || [];
  const screeningResponses = searchResult?.screeningResponses || {};

  const { provider, model, apiKey, budget, dollarsUsed } = useAIConfigStore();

  const startScreening = useCallback(async (): Promise<
    | { responses: Record<string, boolean | null>; confidence: number }
    | undefined
  > => {
    if (provider && apiKey && myMissingResponses.length > 0) {
      if (budget > 0 && dollarsUsed >= budget) {
        return;
      }

      try {
        const screeningResponses = await generateScreeningResponses(
          data.title,
          data.abstract,
          myMissingResponses,
          provider,
          apiKey,
          model
        );

        if (setScreeningResponses) {
          setScreeningResponses(data.id, screeningResponses.responses);
        }

        return screeningResponses;
      } catch (error) {
        console.error("Error generating screening responses:", error);
        toast.error(
          "Failed to generate screening responses. Please check your API key and try again."
        );
      }
    }
  }, [data.title, data.abstract, myMissingResponses, provider, apiKey, model, budget, dollarsUsed, setScreeningResponses, data.id]);

  const { isLoading: isScreening } = useSWRImmutable(
    data.id && canStartScreening
      ? ["screening", data.id, stableMyMissingResponses]
      : null,
    () => startScreening(),
    {}
  );

  return {
    screeningQuestions,
    screeningResponses,
    myExistingResponses,
    myLoadingResponses: (isScreening
      ? myMissingResponses.reduce(
          (acc, question) => ({ ...acc, [question]: true }),
          {}
        )
      : {}) as Record<string, boolean>,
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

// ==================== usePaperCardData ====================

export function usePaperCardData(result: PaperData, translatedContent: TranslationContent | null, showTranslated: boolean) {
  return {
    displayTitle: showTranslated && translatedContent
      ? translatedContent.translatedTitle
      : result.title,
    displayAbstract: showTranslated && translatedContent
      ? translatedContent.translatedAbstract
      : result.abstract,
    authors: result.authorships
      ? result.authorships.map((a) => a.author.display_name)
      : [],
    journal: result.primary_location?.source?.display_name || "",
    citedByCount: result.cited_by_count || 0,
    citesCount: result.referenced_works_count || 0,
    relatedCount: result.related_works?.length || 0,
    isOA: result.open_access?.is_oa || false,
    oaUrl: result.open_access?.oa_url,
    doi: result.doi,
  };
}
