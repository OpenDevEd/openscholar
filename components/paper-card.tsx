"use client";

import React, { useCallback, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { workToCoins } from "@/lib/utils";
import {
  useResultsStore,
  useUIStore,
  useSearchHistoryStore,
  useAIConfigStore,
  useTranslationStore,
  useTransientScreeningStore,
  ScreeningQuestion,
} from "@/lib/store";
// import { useScreeningStore } from "@/lib/store";
import { getEffectiveSearchId } from "@/lib/utils";
import {
  useCurrentSearchFormState,
  useUpdateSearchFilter,
  useIsMobile,
  useIsTablet,
} from "@/lib/hooks";
import { openFocusMode } from "@/lib/search-actions";
import { RatingSelector } from "./rating-selector";
import { PaperMetadata } from "./paper-metadata";
import { DownloadMenu } from "./download-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Download,
  ExternalLink,
  Calendar,
  BookOpen,
  Users,
  Quote,
  Star,
  StarOff,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Network,
  Award,
  Target,
  Layers,
  Building,
  Leaf,
  BarChart3,
  FileText,
  // ClipboardCheck,
  Plus,
  Check,
  X,
  Minus,
  Table,
  // ClipboardPlus
} from "lucide-react";
import { ScreeningContext } from "./results-list";
import {
  generateScreeningResponses,
  translatePaperContent,
} from "@/app/actions/ai-enhance";
import { toast } from "sonner";
import useSWRImmutable from "swr/immutable";
import { ScreeningQuestionEntry } from "@/lib/types";

interface PaperCardProps {
  result: any;
  resultIndex: number;
  onDownloadItem: (item: any, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: any, format: "json" | "csv") => void;
}

function finalState(
  isQuestionAnswered: boolean | null,
  isQuestionLoading: boolean,
  isQuestionMissing: boolean
) {
  if (isQuestionLoading) return "loading";
  if (isQuestionMissing) return "unchecked";
  if (isQuestionAnswered != null)
    return isQuestionAnswered === true
      ? "checked"
      : isQuestionAnswered === false
      ? "crossed"
      : "unchecked";
  return "unchecked";
}

export function useTranslate(
  data: { id: string; title: string; abstract: string } | undefined,
  autoSet: boolean = true
) {
  const pathname = usePathname();
  const searchId = getEffectiveSearchId(pathname, undefined);

  const { provider, apiKey } = useAIConfigStore();

  const selectedLanguage = useSearchHistoryStore((state) => {
    const currentResult = searchId
      ? state.searchHistory.find((item) => item.id === searchId)
      : null;
    return currentResult?.language || "";
  });

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
    [data?.id]
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
        apiKey
      );

      setTranslation(data?.id, translation);
      if (autoSet) {
        setShowTranslated(true);
      }
    } catch (error) {
      console.error("Translation error:", error);
    } finally {
    }
  }, [data?.id, translatedContent, selectedLanguage, apiKey, provider]);

  const { isLoading: isTranslating } = useSWRImmutable(
    data?.id ? `translation-${data.id}` : null,
    () => handleTranslateContent()
  );

  return {
    translatedContent,
    showTranslated,
    isTranslating,
    setShowTranslated,
  };
}

export function useScreening(data: {
  id: string;
  title: string;
  abstract: string;
}) {
  const pathname = usePathname();
  const searchId = getEffectiveSearchId(pathname, undefined);
  // Get current search and screening data
  const { getSearchResult } = useSearchHistoryStore();
  const searchResult = getSearchResult(searchId || "");

  const {
    missingResponses,
    existingResponses,
    setScreeningResponses,
    canStartScreening,
  } = useContext(ScreeningContext);

  const myExistingResponses = existingResponses?.[data.id] || {};
  const myMissingResponses = missingResponses?.[data.id] || []

  const { testIndexPerQuestion } = useTransientScreeningStore();

  const stableMyMissingResponses = JSON.stringify(myMissingResponses.map((question) => question + "#" + (testIndexPerQuestion[question] || 0)));

  const screeningQuestions = searchResult?.screeningQuestions || [];
  const screeningResponses = searchResult?.screeningResponses || {};

  const { provider, apiKey, budget, dollarsUsed } = useAIConfigStore();

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
          apiKey
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
  }, [data.title, data.abstract, myMissingResponses, provider, apiKey]);

  const { isLoading: isScreening } = useSWRImmutable(
    (data.id && canStartScreening)
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
      ? myMissingResponses.reduce((acc, question) => ({ ...acc, [question]: true }), {})
      : {}) as Record<string, boolean>,
    myMissingResponses,
  };
}

export function ScreeningResponses({
  data,
  expandShortcut,
}: {
  data: { id: string; title: string; abstract: string };
  expandShortcut?: string;
}) {
  const {
    screeningQuestions,
    screeningResponses,
    myExistingResponses,
    myLoadingResponses,
    myMissingResponses,
  } = useScreening(data);

  // State for expanded view
  const [showExpandedView, setShowExpandedView] = useState(false);

  // Handle keyboard shortcut
  useEffect(() => {
    if (!expandShortcut) return;

    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === expandShortcut && !event.ctrlKey && !event.altKey && !event.metaKey) {
        setShowExpandedView(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [expandShortcut]);

  return (
    <>
      {screeningQuestions.length > 0 && (
        <div className="mb-3">
          <div className="flex flex-wrap gap-2 items-center">
            {screeningQuestions.map((question, index) => {
              const isQuestionAnswered = myExistingResponses[question.question];
              const isQuestionLoading = myLoadingResponses[question.question];
              const isQuestionMissing = myMissingResponses.includes(
                question.question
              );

              const displayState = finalState(
                isQuestionAnswered,
                isQuestionLoading,
                isQuestionMissing
              );

              return (
                <button
                  key={index}
                  disabled={displayState === "loading"}
                  className={`flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors ${
                    displayState === "checked"
                      ? "bg-green-50 border-green-200 text-green-800 hover:bg-green-100"
                      : displayState === "crossed"
                      ? "bg-red-50 border-red-200 text-red-800 hover:bg-red-100"
                      : displayState === "loading"
                      ? "bg-blue-50 border-blue-200 text-blue-800 cursor-wait"
                      : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                  }`}
                  title={`Question ${index + 1}: ${question.question}`}
                >
                  {displayState === "checked" && (
                    <Check className="h-3 w-3 text-green-700" />
                  )}
                  {displayState === "crossed" && (
                    <X className="h-3 w-3 text-red-700" />
                  )}
                  {displayState === "unchecked" && (
                    <Minus className="h-3 w-3 text-gray-500" />
                  )}
                  {displayState === "loading" && (
                    <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                  )}
                  <span className="font-mono">{index + 1}</span>
                </button>
              );
            })}

            {/* Expand Button */}
            <button
              onClick={() => setShowExpandedView(!showExpandedView)}
              className="flex items-center gap-1 px-2 py-1 rounded border bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100 text-xs transition-colors"
              title={`Show detailed screening responses${expandShortcut ? ` (${expandShortcut.toUpperCase()})` : ""}`}
            >
              <Table className="h-3 w-3 text-blue-700" />
              {showExpandedView ? "Hide" : "Details"}
              {expandShortcut && (
                <span className="text-xs text-muted-background bg-black/10 px-1 rounded hidden md:inline">
                  {expandShortcut.toUpperCase()}
                </span>
              )}
            </button>
          </div>

          {/* Expanded Table View */}
          {showExpandedView && (
            <div className="mt-3 p-4 bg-muted/30 rounded-lg border">
              <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                <Table className="h-4 w-4" />
                Screening Responses
              </h4>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                        #
                      </th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                        Question
                      </th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                        Response
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {screeningQuestions.map((question, index) => {
                      const isQuestionAnswered =
                        myExistingResponses[question.question];
                      const isQuestionLoading =
                        myLoadingResponses[question.question];
                      const isQuestionMissing = myMissingResponses.includes(
                        question.question
                      );
                      const displayState = finalState(
                        isQuestionAnswered,
                        isQuestionLoading,
                        isQuestionMissing
                      );
                      const statusText =
                        isQuestionAnswered === true
                          ? "Yes"
                          : isQuestionAnswered === false
                          ? "No"
                          : isQuestionLoading
                          ? "Loading..."
                          : "?";

                      return (
                        <tr
                          key={index}
                          className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                        >
                          <td className="py-2 px-2 font-mono text-muted-foreground">
                            {index + 1}
                          </td>
                          <td className="py-2 px-2 text-foreground max-w-xs">
                            <div className="truncate" title={question.question}>
                              {question.question}
                            </div>
                          </td>
                          <td className="py-2 px-2">
                            <div
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                                displayState === "checked"
                                  ? "bg-green-100 text-green-800 border border-green-200"
                                  : displayState === "crossed"
                                  ? "bg-red-100 text-red-800 border border-red-200"
                                  : displayState === "loading"
                                  ? "bg-blue-100 text-blue-800 border border-blue-200"
                                  : "bg-gray-100 text-gray-700 border border-gray-200"
                              }`}
                            >
                              {displayState === "checked" && (
                                <Check className="h-3 w-3 text-green-800" />
                              )}
                              {displayState === "crossed" && (
                                <X className="h-3 w-3 text-red-800" />
                              )}
                              {displayState === "unchecked" && (
                                <Minus className="h-3 w-3 text-gray-600" />
                              )}
                              {displayState === "loading" && (
                                <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                              )}
                              {statusText}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function PaperCard({
  result,
  resultIndex,
  onDownloadItem,
  onDownloadEssentialItem,
}: PaperCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { expandedAbstracts, toggleAbstract } = useResultsStore();
  const { isFocusModeOpen } = useUIStore();
  const updateFilter = useUpdateSearchFilter();
  const isMobile = useIsTablet();

  const searchId = getEffectiveSearchId(pathname, undefined);
  // Get current search and screening data
  const selectedLanguage = useSearchHistoryStore((state) => {
    const currentResult = searchId
      ? state.searchHistory.find((item) => item.id === searchId)
      : null;
    return currentResult?.language || "";
  });

  // const handleAddToScreening = () => {
  //   addDocumentFromWork(result);
  // };

  const handleFilteredSearch = async (
    filterType: "cites" | "cited_by" | "related"
  ) => {
    // Create new search entry in history (SWR will handle data fetching)
    const { addSearchResult } = useSearchHistoryStore.getState();
    const searchId = addSearchResult({
      query: "",
      field: "title_and_abstract",
      count: 0, // SWR will populate the actual count
      dateRange: undefined,
      yearRange: undefined,
      filterType: "year",
      sortBy: "cited_by_count:desc",
      selectedRegions: [],
      selectedCountryFocus: [],
      // Don't set rating ranges - they should default to undefined (not filtered)
      citesItemId: filterType === "cites" ? result.id : "",
      citedByItemId: filterType === "cited_by" ? result.id : "",
      relatedToItemId: filterType === "related" ? result.id : "",
    });

    // Navigate to the new search - SWR will handle data fetching
    if (searchId) {
      router.push(`/results/${searchId}`);
    }
  };

  const handleCitesSearch = () => handleFilteredSearch("cites");
  const handleCitedBySearch = () => handleFilteredSearch("cited_by");
  const handleRelatedSearch = () => handleFilteredSearch("related");

  const {
    translatedContent,
    showTranslated,
    isTranslating,
    setShowTranslated,
  } = useTranslate(result);

  // Auto-translate when language changes and conditions are met

  return (
    <div className="border rounded-lg hover:bg-accent/50 transition-colors group">
      <div className="p-4 overflow-hidden">
        {/* COINS metadata span - only render when focus mode is not active */}
        {!isFocusModeOpen && (
          <span
            className="Z3988"
            title={workToCoins(result)}
            style={{ display: "none" }}
          ></span>
        )}

        {/* Screening Questions Checkboxes */}
        <ScreeningResponses data={result} />

        {/* Title */}
        <div className="mb-3">
          {/* Translation toggle and status */}
          {selectedLanguage && selectedLanguage !== "en" && (
            <div className="flex items-center gap-2 mb-2">
              {isTranslating && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                  Translating to English...
                </div>
              )}

              {translatedContent &&
                translatedContent.sourceLanguage === selectedLanguage &&
                !translatedContent.isAlreadyInEnglish && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTranslated(!showTranslated);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    {showTranslated ? "Original" : "English"}
                  </button>
                )}
            </div>
          )}

          <button
            onClick={() => openFocusMode(isMobile, resultIndex)}
            className="text-left w-full group-hover:underline hover:text-blue-600 transition-colors cursor-pointer"
          >
            <h3 className="font-medium text-lg text-wrap-anywhere">
              {showTranslated && translatedContent
                ? `${translatedContent.translatedTitle} (${result.publication_year})`
                : `${result.title} (${result.publication_year})`}
            </h3>
          </button>
        </div>
        {/* Authors */}
        {result.authorships && (
          <div className="mb-3">
            <div className="flex gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                {result.authorships
                  .map(
                    (author: { author: { display_name: string } }) =>
                      author.author.display_name
                  )
                  .join(", ")}
              </span>
            </div>
          </div>
        )}

        {/* Abstract and Extended Content */}
        <div className="mb-4">
          {/* Abstract */}
          {result.abstract && (
            <p className="text-sm text-muted-foreground text-wrap-anywhere mb-2">
              {expandedAbstracts[result.id]
                ? showTranslated && translatedContent
                  ? translatedContent.translatedAbstract
                  : result.abstract
                : showTranslated && translatedContent
                ? translatedContent.translatedAbstract.length > 500
                  ? `${translatedContent.translatedAbstract.slice(0, 500)}...`
                  : translatedContent.translatedAbstract
                : result.abstract.length > 500
                ? `${result.abstract.slice(0, 500)}...`
                : result.abstract}
            </p>
          )}

          {/* Expanded Metadata - shown when expanded, excluding already shown content */}
          {expandedAbstracts[result.id] && (
            <div className="mt-4 space-y-3">
              {/* Academic Classification */}
              <div className="space-y-2">
                {/* Citation Percentile */}
                {result.cited_by_percentile_year && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Award className="h-3 w-3 flex-shrink-0" />
                    <div>
                      <span className="font-medium">
                        Citation Percentile (Year):
                      </span>
                      <span className="ml-1">
                        {result.cited_by_percentile_year.min}-
                        {result.cited_by_percentile_year.max}%
                      </span>
                    </div>
                  </div>
                )}
                {result.primary_topic && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Target className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">Topic:</span>
                      <span className="ml-1">
                        {result.primary_topic.display_name}
                      </span>
                    </div>
                  </div>
                )}

                {result.primary_topic?.subfield && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Layers className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">Subfield:</span>
                      <span className="ml-1">
                        {result.primary_topic.subfield.display_name}
                      </span>
                    </div>
                  </div>
                )}

                {result.primary_topic?.field && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <BookOpen className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">Field:</span>
                      <span className="ml-1">
                        {result.primary_topic.field.display_name}
                      </span>
                    </div>
                  </div>
                )}

                {result.primary_topic?.domain && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Building className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">Domain:</span>
                      <span className="ml-1">
                        {result.primary_topic.domain.display_name}
                      </span>
                    </div>
                  </div>
                )}

                {result.sustainable_development_goals &&
                  result.sustainable_development_goals.length > 0 && (
                    <div className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Leaf className="h-3 w-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="font-medium">SDGs:</span>
                        <div className="ml-1 flex flex-wrap gap-1 mt-1">
                          {result.sustainable_development_goals.map(
                            (sdg: {
                              id: string;
                              display_name: string;
                              score: number;
                            }) => (
                              <span
                                key={sdg.id}
                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs"
                                title={`${sdg.display_name} (Score: ${
                                  sdg.score?.toFixed(2) || "N/A"
                                })`}
                              >
                                {sdg.display_name}
                                {sdg.score && (
                                  <span className="text-green-600 font-medium">
                                    {sdg.score.toFixed(2)}
                                  </span>
                                )}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  )}
              </div>

              {/* Additional Citation Metrics not shown in main content */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Quote className="h-3 w-3 flex-shrink-0" />
                  <span className="font-medium">References:</span>
                  <span>{result.referenced_works_count || 0}</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <BarChart3 className="h-3 w-3 flex-shrink-0" />
                  <span className="font-medium">FWCI:</span>
                  <span>{result.fwci ? result.fwci.toFixed(2) : "N/A"}</span>
                </div>
              </div>
            </div>
          )}

          {/* Show More/Less Button - Always visible */}
          <button
            onClick={() => toggleAbstract(result.id)}
            className="mt-2 text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
          >
            {expandedAbstracts[result.id] ? "Show Less" : "Show More"}
          </button>
        </div>

        {/* Bottom Row: Completely different mobile vs desktop */}
        {isMobile ? (
          /* Mobile Layout: Card-based with clear sections */
          <div className="space-y-3">
            {/* Top row: Rating and quick actions */}
            <div className="flex items-center justify-between">
              <RatingSelector paperId={result.id} variant="compact" />
              <div className="flex items-center gap-2">
                {/* Add to Screening Button - COMMENTED OUT */}
                {/*
                <Button
                  variant={isInScreening ? "default" : "outline"}
                  size="sm"
                  onClick={handleAddToScreening}
                  disabled={isInScreening}
                  className={`flex items-center gap-1 px-3 ${
                    isInScreening
                      ? 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/50'
                      : 'text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950/50'
                  }`}
                  title={isInScreening ? "Already in screening" : "Add to screening"}
                >
                  {isInScreening ? (
                    <ClipboardCheck className="h-4 w-4" />
                  ) : (
                    <ClipboardPlus className="h-4 w-4" />
                  )}
                  <span className="text-sm">{isInScreening ? "Added" : "Screen"}</span>
                </Button>
                */}

                <DownloadMenu
                  variant="icon"
                  onDownloadJSON={() => onDownloadItem(result, "json")}
                  onDownloadCSV={() => onDownloadItem(result, "csv")}
                  onDownloadEssentialJSON={() =>
                    onDownloadEssentialItem(result, "json")
                  }
                  onDownloadEssentialCSV={() =>
                    onDownloadEssentialItem(result, "csv")
                  }
                />
                {result.open_access?.is_oa && result.open_access?.oa_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(result.open_access.oa_url, "_blank")
                    }
                    className="flex items-center gap-1 text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/50 px-3"
                    title="Open Access PDF"
                  >
                    <FileText className="h-4 w-4" />
                    <span className="text-sm">PDF</span>
                  </Button>
                )}

                {/* DOI Button */}
                {result.doi && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const doiUrl = result.doi.startsWith("http")
                        ? result.doi
                        : `https://doi.org/${result.doi}`;
                      window.open(doiUrl, "_blank");
                    }}
                    className="flex items-center gap-1 text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950/50 px-3"
                    title="Open DOI"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="text-xs font-mono">
                      {result.doi.replace("https://doi.org/", "")}
                    </span>
                  </Button>
                )}
              </div>
            </div>

            {/* Citation and related works cards */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleCitesSearch}
                className="bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/30 dark:hover:bg-orange-950/50 border border-orange-200 dark:border-orange-800 rounded-lg p-3 text-left transition-colors group relative"
              >
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 mb-1">
                  <Quote className="h-4 w-4" />
                  <span className="text-xs font-medium">Citations</span>
                </div>
                <div className="text-lg font-semibold text-orange-700 dark:text-orange-300">
                  {result.cited_by_count || 0}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-3 top-1/2 transform -translate-y-1/2 text-orange-600/60 dark:text-orange-400/60 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors" />
              </button>

              <button
                onClick={handleCitedBySearch}
                className="bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-950/50 border border-green-200 dark:border-green-800 rounded-lg p-3 text-left transition-colors group relative"
              >
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-1">
                  <Quote className="h-4 w-4" />
                  <span className="text-xs font-medium">Cited by</span>
                </div>
                <div className="text-lg font-semibold text-green-700 dark:text-green-300">
                  {result.referenced_works_count || 0}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-3 top-1/2 transform -translate-y-1/2 text-green-600/60 dark:text-green-400/60 group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors" />
              </button>

              <button
                onClick={handleRelatedSearch}
                className="bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:hover:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-left transition-colors group relative"
              >
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1">
                  <Network className="h-4 w-4" />
                  <span className="text-xs font-medium">Related</span>
                </div>
                <div className="text-lg font-semibold text-blue-700 dark:text-blue-300">
                  {result.related_works?.length || 0}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-3 top-1/2 transform -translate-y-1/2 text-blue-600/60 dark:text-blue-400/60 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
              </button>
            </div>
          </div>
        ) : (
          /* Desktop Layout: Original horizontal layout */
          <div className="flex items-center justify-between content-end gap-4 flex-wrap">
            {/* Left side: Rating and Citation buttons */}
            <div className="flex items-center gap-4 shrink-0">
              <RatingSelector paperId={result.id} variant="compact" />
            </div>

            {/* Right side: Action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Add to Screening Button - COMMENTED OUT */}
              {/*
              <Button
                variant={isInScreening ? "default" : "outline"}
                size="sm"
                onClick={handleAddToScreening}
                disabled={isInScreening}
                className={`flex items-center gap-2 flex-shrink-0 ${
                  isInScreening
                    ? 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/50'
                    : 'text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950/50'
                }`}
                title={isInScreening ? "Already in screening" : "Add to screening"}
              >
                {isInScreening ? (
                  <ClipboardCheck className="h-4 w-4" />
                ) : (
                  <ClipboardPlus className="h-4 w-4" />
                )}
                <span>{isInScreening ? "Added" : "Add to Screening"}</span>
              </Button>
              */}

              {/* Open Access PDF Button */}
              {result.open_access?.is_oa && result.open_access?.oa_url && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(result.open_access.oa_url, "_blank")
                  }
                  onMouseDown={(e) => {
                    // Handle middle click
                    if (e.button === 1) {
                      e.preventDefault();
                      window.open(result.open_access.oa_url, "_blank");
                    }
                  }}
                  className="flex items-center gap-2 text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/50 cursor-pointer flex-shrink-0"
                  title="Open Access PDF"
                >
                  <FileText className="h-4 w-4" />
                  <span>PDF</span>
                </Button>
              )}

              {/* DOI Button */}
              {result.doi && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const doiUrl = result.doi.startsWith("http")
                      ? result.doi
                      : `https://doi.org/${result.doi}`;
                    window.open(doiUrl, "_blank");
                  }}
                  onMouseDown={(e) => {
                    // Handle middle click
                    if (e.button === 1) {
                      e.preventDefault();
                      const doiUrl = result.doi.startsWith("http")
                        ? result.doi
                        : `https://doi.org/${result.doi}`;
                      window.open(doiUrl, "_blank");
                    }
                  }}
                  className="flex items-center gap-1 text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950/50 cursor-pointer flex-shrink-0"
                  title="Open DOI"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span className="text-xs font-mono">
                    {result.doi.replace("https://doi.org/", "")}
                  </span>
                </Button>
              )}

              {/* Download Menu */}
              <DownloadMenu
                variant="icon"
                onDownloadJSON={() => onDownloadItem(result, "json")}
                onDownloadCSV={() => onDownloadItem(result, "csv")}
                onDownloadEssentialJSON={() =>
                  onDownloadEssentialItem(result, "json")
                }
                onDownloadEssentialCSV={() =>
                  onDownloadEssentialItem(result, "csv")
                }
              />
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 justify-center w-full bg-card-foreground/5 rounded-lg p-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCitesSearch}
                className="flex items-center gap-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-950/50 flex-shrink-0"
                title="Find works that cite this paper"
              >
                <Quote className="h-4 w-4" />
                <span className="text-sm">
                  Cited by: {result.cited_by_count || 0}
                </span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleCitedBySearch}
                className="flex items-center gap-2 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/50 flex-shrink-0"
                title="Find works cited by this paper"
              >
                <Quote className="h-4 w-4" />
                <span className="text-sm">
                  Cites: {result.referenced_works_count || 0}
                </span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleRelatedSearch}
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50 flex-shrink-0"
                title="Find works related to this paper"
              >
                <Network className="h-4 w-4" />
                <span className="text-sm">
                  Related: {result.related_works?.length || 0}
                </span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
