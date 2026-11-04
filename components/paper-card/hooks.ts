"use client";

import { useCallback, useContext } from "react";
import { usePathname } from "next/navigation";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { useLocale } from "next-intl";
import {
  useResultsTranslationSettingsStore,
  useTranslationStore,
  useSearchHistoryStore,
} from "@/lib/store";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { createCitationSearch, useSearchOptional } from "@/lib/search";
import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { rememberAuthorNames } from "@/lib/openalex/use-author-names";
import { rememberInstitutionNames, rememberJournalNames } from "@/lib/openalex/use-record-names";
import { authorFilterValue, isAuthorId } from "@/lib/openalex/author-filter";
import { getEffectiveSearchId } from "@/lib/utils";
import { buildShareableUrl } from "@/lib/search-params";
import { ScreeningContext, TranslationContext } from "@/components/results-contexts";

export interface TranslationContent {
  translatedTitle: string;
  translatedAbstract: string;
  noTranslationNeeded?: boolean;
}

// ==================== useTranslate ====================

/**
 * Hook for reading translation state from the store and context.
 * Translation is triggered by useBatchTranslation in results-list.tsx and focus mode.
 * This hook is now a pure "reader" - it doesn't trigger translations.
 */
export function useTranslate(
  data: { id: string; title?: string; abstract?: string } | undefined,
  _autoSet: boolean = true
) {
  const locale = useLocale();
  const targetLanguageOverride = useResultsTranslationSettingsStore(
    (state) => state.targetLanguageOverride
  );
  const targetLanguage = targetLanguageOverride ?? localeToLanguageCode(locale);
  const translationsUndone = useResultsTranslationSettingsStore((state) => state.translationsUndone);

  // Use selectors to subscribe to specific translation data (composite key: paperId:target)
  const translatedContent = useTranslationStore(
    (state) => (data?.id && targetLanguage && !translationsUndone
      ? state.getTranslation(data.id, targetLanguage)
      : null)
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
  };
}

// ==================== useScreening ====================

export function useScreening(data: {
  id: string;
  title?: string;
  abstract?: string;
}) {
  const pathname = usePathname();
  const searchId = getEffectiveSearchId(pathname, undefined);
  
  const { getSearchResult } = useSearchHistoryStore();
  const searchResult = getSearchResult(searchId || "");

  const {
    missingResponses,
    existingResponses,
    loadingQuestions,
    isScreeningPanelOpen,
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
    isScreeningPanelOpen: isScreeningPanelOpen ?? false,
  };
}

// ==================== useCitationHandlers ====================

export function useCitationHandlers(paperId: string) {
  const router = useWorkspaceRouter();

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

/**
 * What the search keeps for one of a work's authors: the OpenAlex id, or the
 * name where OpenAlex has no author record (often an organisation).
 */
export function authorValue(author: { id?: string | null; display_name: string }): string | null {
  return authorFilterValue(author.id ?? author.display_name);
}

/** One of a work's authors, journals or institutions, as the search keeps it and as the page names it. */
export type FilterValue = { value: string; name: string };

/**
 * The records of one kind the page's search is filtered by, and the control that
 * adds or drops one. On a page with no search to narrow, such as the library or a
 * paper a chat names, `toggle` starts a new search by that record instead.
 */
function useRecordFilter(field: "authors" | "journals" | "institutions", param: "author" | "journal" | "inst", remember: (names: Record<string, string>) => void) {
  const router = useWorkspaceRouter();
  // A search provider is the search to narrow. Focus mode in the assistant's panel has none, even over a results page.
  const canFilter = Boolean(useSearchOptional());
  const selected = useCurrentSearchFormState()[field];
  const updateFilter = useUpdateSearchFilter();
  const toggle = ({ value, name }: FilterValue) => {
    if (canFilter && selected.includes(value)) return updateFilter({ [field]: selected.filter((one) => one !== value) });
    // A name is saved as it is picked, so the filter's chip never has to look it up.
    remember({ [value]: name });
    if (canFilter) updateFilter({ [field]: [...selected, value] });
    else router.push(buildShareableUrl("", { [param]: [value] }));
  };
  return { selected: canFilter ? selected : ([] as string[]), toggle };
}

// An author kept by name is its own name, so only an id's is saved.
const rememberAuthorIds = (names: Record<string, string>) =>
  rememberAuthorNames(Object.fromEntries(Object.entries(names).filter(([value]) => isAuthorId(value))));

export const useAuthorFilter = () => useRecordFilter("authors", "author", rememberAuthorIds);
export const useJournalFilter = () => useRecordFilter("journals", "journal", rememberJournalNames);
export const useInstitutionFilter = () => useRecordFilter("institutions", "inst", rememberInstitutionNames);
