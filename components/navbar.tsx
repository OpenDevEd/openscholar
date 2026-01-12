"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Menu,
  Home,
  Clock,
  MoreHorizontal,
  BookOpen,
  FileText,
  Filter,
  LucideIcon,
  Languages,
  List,
  Table,
  Shield,
  Settings,
  LogIn,
  Code,
  ClipboardCheck,
  HelpCircle,
  Settings2,
  Eye,
  Download,
  Sparkles,
  Expand,
  Minimize2,
  Loader2,
  Share2,
  Check,
} from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { KeywordExpansionTooltip } from "./keyword-expansion-tooltip";
import { DownloadMenu } from "./download-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useSearchHistoryStore,
  useCurrentQueryStore,
  useCurrentQuestionStore,
  useAIConfigStore,
} from "@/lib/store";
import {
  useQueryChangeHandler,
  useEffectiveSearchId,
} from "@/lib/hooks";
import { useSearchOptional } from "@/lib/search";
import { toast } from "sonner";
import { enhanceSearchQuery, translateQuery } from "@/app/actions/ai-enhance";
import { usePathname, useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SearchHistory } from "./search-history";
import { useIsMobile } from "@/lib/hooks";
import { ApiButton } from "./api-button";
import { LanguageSelector } from "./language-selector";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";

export function useSearchBarLogic() {
  // Use the new search context (returns undefined if outside provider)
  const search = useSearchOptional();
  const isOnResultsPage = !!search;
  
  // Store-based query (for home page / fallback)
  const storeQuery = useCurrentQueryStore((s) => s.currentQuery);
  const setStoreQuery = useCurrentQueryStore((s) => s.setCurrentQuery);
  
  // URL-based query (for results page)
  const urlQuery = search?.params?.q ?? '';
  
  // Local input state - tracks what user types before submitting
  // Initialize from URL on results page, store on home page
  const [localInputValue, setLocalInputValue] = React.useState(
    isOnResultsPage ? urlQuery : storeQuery
  );
  
  // Sync local input when URL query changes (e.g., navigating between history entries)
  React.useEffect(() => {
    if (isOnResultsPage) {
      setLocalInputValue(urlQuery);
    }
  }, [isOnResultsPage, urlQuery]);
  
  // Sync local input when store query changes (for home page)
  React.useEffect(() => {
    if (!isOnResultsPage) {
      setLocalInputValue(storeQuery);
    }
  }, [isOnResultsPage, storeQuery]);
  
  // The displayed query value (always from local state for responsiveness)
  const currentQuery = localInputValue;
  
  // Update query - updates local state, and store for cross-page sync
  const setCurrentQuery = React.useCallback((q: string) => {
    setLocalInputValue(q);
    // Also sync to store for home page / cross-page consistency
    setStoreQuery(q);
  }, [setStoreQuery]);
  
  const handleQueryChange = useQueryChangeHandler(setCurrentQuery);

  // Translation loading state
  const [isTranslating, setIsTranslating] = React.useState(false);

  // Get loading states from search context or default to false
  const isLoading = search?.isLoading ?? false;
  const isValidating = search?.isValidating ?? false;
  const apiUrl = search?.apiUrl ?? '';

  const isFormDisabled = isLoading || isValidating || isTranslating;

  // Language: URL params on results page (source of truth)
  const selectedLanguage = search?.params?.lang ?? '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Update query via the search context if available (updates URL)
    if (search) {
      search.setQuery(currentQuery);
    }
  };

  const handleLanguageChange = async (language: string) => {
    const previousValue = selectedLanguage;

    // On results page, update via URL params (source of truth)
    // Note: search.setLanguage now also syncs to store for history persistence
    if (search && language !== previousValue) {
      // Update URL params immediately (also syncs to store)
      search.setLanguage(language || null);

      // If there's a current query and language changed, translate it
      if (currentQuery.trim() && language) {
        const { provider, model, apiKey } = useAIConfigStore.getState();

        if (!apiKey) {
          toast.error("API Key Required", {
            description: "Please configure your AI API key to translate queries.",
          });
          return;
        }

        if (!provider) {
          toast.error("Provider Required", {
            description: "Please select an AI provider to translate queries.",
          });
          return;
        }

        // Set translation loading state
        setIsTranslating(true);

        // Show loading toast
        const loadingToast = toast.loading("Translating query...", {
          description: `Converting to ${language}`,
        });

        try {
          const { expandedQuery } = validateAndExpandKeywordsSilently(currentQuery);

          const translatedQuery = await translateQuery(expandedQuery, language, provider, apiKey, model);

          // Update local query state to show the translation
          setCurrentQuery(translatedQuery);

          setTimeout(() => {
            console.log("search-bar", document.getElementById("search-bar-submit"));
            document.getElementById("search-bar-submit")?.click();
          }, 100);

          // Dismiss loading toast and show success
          toast.dismiss(loadingToast);
          toast.success("Query Translated", {
            description: `Translated to ${language}: "${translatedQuery}"`,
          });
        } catch (translationError) {
          toast.dismiss(loadingToast);
          toast.error("Translation Failed", {
            description: "Could not translate query, but language preference was saved.",
          });
        } finally {
          // Always clear translation loading state
          setIsTranslating(false);
        }
      }
    }
  };

  return {
    handleSubmit,
    handleQueryChange,
    isFormDisabled,
    currentQuery,
    setCurrentQuery,
    apiUrl,
    selectedLanguage,
    handleLanguageChange,
    isTranslating
  };
}

export function SearchBar() {
    const {
      handleSubmit,
      handleQueryChange,
      isFormDisabled,
      currentQuery,
      setCurrentQuery,
      apiUrl,
      selectedLanguage,
      handleLanguageChange,
      isTranslating
    } = useSearchBarLogic();

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative flex flex-col md:flex-row md:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={currentQuery}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder={isTranslating ? "Translating query..." : "Search using keywords..."}
            className="pl-10 pr-10"
            disabled={isFormDisabled}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p>The language setting will be applied when using a research question or AI adjustment</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Mobile: Buttons flow to second row, Desktop: Inline */}
        <div className="flex items-center gap-2">
          {/* Language Selector */}
          <LanguageSelector
            value={selectedLanguage}
            onValueChange={handleLanguageChange}
            disabled={isFormDisabled}
          />

          {/* Search Button */}
          <Button
            type="submit"
            disabled={isFormDisabled}
            id="search-bar-submit"
          >
            <Search className="h-4 w-4" />
            Search
          </Button>

          {/* API Button */}
          <ApiButton apiUrl={apiUrl} disabled={isFormDisabled} />
        </div>
      </div>
    </form>
  );
}

export function ResearchQuestionBar() {
  const search = useSearchOptional();
  const { handleSubmit: handleSubmitSearch } = useSearchBarLogic();
  const { currentQuestion, setCurrentQuestion } = useCurrentQuestionStore();
  const { addQuestionToHistory, getSearchResult } = useSearchHistoryStore();
  const { provider, model, apiKey } = useAIConfigStore();
  const effectiveSearchId = useEffectiveSearchId();
  const [isEnhancing, setIsEnhancing] = React.useState(false);

  // Get loading states from search context
  const isLoading = search?.isLoading ?? false;
  const isValidating = search?.isValidating ?? false;

  const isFormDisabled = isLoading || isValidating || isEnhancing;

  // Get the latest question from questionHistory when search changes
  React.useEffect(() => {
    if (effectiveSearchId) {
      const currentSearch = getSearchResult(effectiveSearchId);
      if (currentSearch?.questionHistory && currentSearch.questionHistory.length > 0) {
        // Get the most recent question
        const latestQuestion = currentSearch.questionHistory[currentSearch.questionHistory.length - 1].question;
        setCurrentQuestion(latestQuestion);
      } else {
        // Clear the question if no history exists
        setCurrentQuestion('');
      }
    }
  }, [effectiveSearchId, getSearchResult, setCurrentQuestion]);

  const handleQuestionChange = (question: string) => {
    setCurrentQuestion(question);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!effectiveSearchId) {
      toast.error("No active search", {
        description: "Please perform a search first before asking questions."
      });
      return;
    }

    const questionToProcess = currentQuestion.trim();

    // Always add to question history if there's a question
    if (questionToProcess) {
      addQuestionToHistory(effectiveSearchId, questionToProcess);
    }

    // If question is empty, just add to history and return
    if (!questionToProcess) {
      return;
    }

    // If question is not empty, enhance it and set as current query
    try {
      setIsEnhancing(true);

      // Get current search result to access language setting
      const currentSearchResult = getSearchResult(effectiveSearchId);

      const result = await enhanceSearchQuery(questionToProcess, provider, apiKey, model, currentSearchResult?.language);

      // Set the enhanced query as the current search query
      const { setCurrentQuery } = useCurrentQueryStore.getState();
      setCurrentQuery(result.enhancedQuery);

      toast.success("Question Enhanced", {
        description: `Query set in search field: "${result.enhancedQuery}"`
      });

      setTimeout(() => {
        console.log("search-bar", document.getElementById("search-bar-submit"));
        document.getElementById("search-bar-submit")?.click();
      }, 100);

    } catch (error) {
      toast.error("Enhancement Failed", {
        description: error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative flex flex-col md:flex-row md:items-center gap-2 md:gap-0">
        <div className="relative flex-1">
          <HelpCircle className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={currentQuestion}
            onChange={(e) => handleQuestionChange(e.target.value)}
            placeholder="Ask a research question to get keywords..."
            className="pl-10 pr-4"
            disabled={isFormDisabled}
          />
        </div>

        <div className="flex md:ml-2">
          <Button
            type="submit"
            disabled={isFormDisabled || !currentQuestion.trim()}
            className="flex-shrink-0 w-full md:w-auto"
          >
            {isEnhancing ? (
              <>
                <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Enhancing...
              </>
            ) : (
              <>
                <HelpCircle className="h-4 w-4 mr-1" />
                Ask
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

interface ResultsActionBarProps {
  totalCount: number;
  currentQuery?: string;
  onDownloadAllJSON?: () => void;
  onDownloadAllCSV?: () => void;
  onDownloadAllEssentialJSON?: () => void;
  onDownloadAllEssentialCSV?: () => void;
  isAdjusting?: boolean;
  setIsAdjusting?: any;
  isScreening?: boolean;
  setIsScreening?: any
}

export function ResultsActionBar({
  totalCount,
  currentQuery = "",
  onDownloadAllJSON,
  onDownloadAllCSV,
  onDownloadAllEssentialJSON,
  onDownloadAllEssentialCSV,
  isAdjusting,
  setIsAdjusting,
  isScreening,
  setIsScreening,
}: ResultsActionBarProps) {
  const hasDownloadHandlers = onDownloadAllJSON || onDownloadAllCSV || onDownloadAllEssentialJSON || onDownloadAllEssentialCSV;

  // State for loading buttons
  const [isBroadening, setIsBroadening] = React.useState(false);
  const [isNarrowing, setIsNarrowing] = React.useState(false);
  const [isCopied, setIsCopied] = React.useState(false);

  // Get shareable URL from search context
  const search = useSearchOptional();
  const getShareableUrl = search?.getShareableUrl ?? (() => '');

  const { provider, model, apiKey } = useAIConfigStore();
  const { currentQuestion } = useCurrentQuestionStore();
  
  // Store access for updating query (cross-page sync)
  const setStoreQuery = useCurrentQueryStore((s) => s.setCurrentQuery);

  // Language and query from URL params (source of truth on results page)
  const currentLanguage = search?.params?.lang ?? '';
  // Use prop if provided, otherwise use URL params
  const effectiveQuery = currentQuery || search?.params?.q || '';

  // Conditional button visibility
  const showBroadenButton = totalCount < 10 && effectiveQuery.trim();
  const showNarrowButton = totalCount > 1000 && effectiveQuery.trim();

  const handleBroadenQuery = async () => {
    if (!effectiveQuery.trim() || !apiKey || !provider) return;

    const { expandedQuery } = validateAndExpandKeywordsSilently(effectiveQuery);

    setIsBroadening(true);
    const loadingToast = toast.loading("Broadening search query...", {
      description: "Making the search less restrictive",
    });

    try {
      const broadenPrompt = `Current query: "${expandedQuery}"
${currentQuestion ? `Research Question: "${currentQuestion}"` : ''}
${currentLanguage ? `Language Context: The user has specified a language preference of "${currentLanguage}". When broadening the query, consider that the search should focus on content in or related to this language.` : ''}

This query is returning fewer than 10 results. Please broaden the search by:

1. Expanding beyond overly restrictive search terms while staying relevant to the research question
2. Using more OR operators to include synonyms and related terms
3. Removing overly specific constraints that might be limiting results
4. Making the query more inclusive while maintaining the core research intent${currentQuestion ? ' and addressing the research question' : ''}
5. Consider using broader search terms and fewer exclusion criteria

Return a more inclusive version of this query that should return more results while preserving the main research focus${currentQuestion ? ' and directly addressing the research question' : ''}.`;

      const result = await enhanceSearchQuery(broadenPrompt, provider, apiKey, currentLanguage);
      // Update store for cross-page sync
      setStoreQuery(result.enhancedQuery);

      toast.dismiss(loadingToast);
      toast.success("Query Broadened", {
        description: `New query: "${result.enhancedQuery}"`,
      });

      // Auto-submit the broadened query
      setTimeout(() => {
        document.getElementById("search-bar-submit")?.click();
      }, 100);
    } catch (error) {
      toast.dismiss(loadingToast);
      toast.error("Failed to broaden query", {
        description: "Could not modify the search query",
      });
    } finally {
      setIsBroadening(false);
    }
  };

  const handleNarrowQuery = async () => {
    if (!effectiveQuery.trim() || !apiKey || !provider) return;

    const { expandedQuery } = validateAndExpandKeywordsSilently(effectiveQuery);

    setIsNarrowing(true);
    const loadingToast = toast.loading("Making search more specific...", {
      description: `Refining query for ${totalCount.toLocaleString()} results`,
    });

    try {
      const narrowPrompt = `Current query: "${expandedQuery}"
Current results: ${totalCount.toLocaleString()} papers found
${currentQuestion ? `Research Question: "${currentQuestion}"` : ''}
${currentLanguage ? `Language Context: The user has specified a language preference of "${currentLanguage}". When making the query more specific, maintain focus on content in or related to this language.` : ''}

This query is returning too many results (${totalCount.toLocaleString()} papers). Please make it more specific and targeted by:

1. Identifying and focusing on the core research question${currentQuestion ? '/topic' : ''} to reduce irrelevant results
2. Adding more specific keywords that narrow down the research area${currentQuestion ? ' and directly address the research question' : ''}
3. Using more precise technical terminology relevant to the field${currentQuestion ? ' and question context' : ''}
4. Incorporating specific methodologies, frameworks, or approaches${currentQuestion ? ' that are relevant to the research question' : ''}
5. Adding exclusion terms if certain subtopics should be filtered out${currentQuestion ? ' to focus on the specific research question' : ''}
6. Considering the specific context or application domain${currentQuestion ? ' mentioned in the research question' : ''}

Return a more targeted version of this query that will reduce the result count while maintaining the essential research focus${currentQuestion ? ' and directly addressing the research question' : ''}.`;

      const result = await enhanceSearchQuery(narrowPrompt, provider, apiKey, currentLanguage);
      // Update store for cross-page sync
      setStoreQuery(result.enhancedQuery);

      toast.dismiss(loadingToast);
      toast.success("Query Made More Specific", {
        description: `Refined query for better focus: "${result.enhancedQuery}"`,
      });

      // Auto-submit the narrowed query
      setTimeout(() => {
        document.getElementById("search-bar-submit")?.click();
      }, 100);
    } catch (error) {
      toast.dismiss(loadingToast);
      toast.error("Failed to narrow query", {
        description: "Could not modify the search query",
      });
    } finally {
      setIsNarrowing(false);
    }
  };

  const handleCopyShareLink = async () => {
    try {
      const shareableUrl = getShareableUrl();
      await navigator.clipboard.writeText(shareableUrl);
      setIsCopied(true);
      toast.success("Link copied!", {
        description: "Share this URL with others to share your search.",
      });
      // Reset the icon after 2 seconds
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy link", {
        description: "Could not copy the share link to clipboard.",
      });
    }
  };

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-0">
      {/* Results count and query adjustment buttons */}
      <div className="flex items-center justify-between gap-2 order-2 md:order-1">
        <p className="text-lg text-muted-foreground whitespace-nowrap truncate overflow-hidden">{totalCount.toLocaleString()} results</p>
        {(showBroadenButton || showNarrowButton) && (
          <div className="flex items-center gap-2 flex-1 md:flex-shrink-0">
            {showBroadenButton && (
              <Button
                variant="outline"
                onClick={handleBroadenQuery}
                disabled={isBroadening}
                className="text-xs flex-1 md:flex-shrink-0"
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
                variant="outline"
                onClick={handleNarrowQuery}
                disabled={isNarrowing}
                className="text-xs flex-1 md:flex-shrink-0"
              >
                {isNarrowing ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Minimize2 className="h-3 w-3 mr-1" />
                )}
                Make more specific
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Action buttons - Screen, Adjust, Download */}
      <div className="flex items-center gap-2 md:flex-shrink-0 order-1 md:order-2">
        {/* <Button variant="outline" size="sm" disabled>
          <Settings2 className="h-4 w-4 mr-1" />
          Configure
        </Button> */}
        <Button
          variant={isScreening ? "default" : "outline"}
          onClick={() => setIsScreening?.((prev: boolean) => { const newVal = !prev; console.log("newVal", newVal); if (newVal) { setIsAdjusting?.(false) } return newVal; })}
          className="flex-1 md:flex-shrink-0"
        >
          <Eye className="h-4 w-4 mr-1" />
          Screen
        </Button>
        <Button
          variant={isAdjusting ? "default" : "outline"}
          onClick={() => setIsAdjusting?.((prev: boolean) => { const newVal = !prev; console.log("newVal", newVal); if (newVal) { setIsScreening?.(false) } return newVal; })}
          className="flex-1 md:flex-shrink-0"
        >
          <Sparkles className="h-4 w-4 mr-1" />
          Adjust
        </Button>
        {hasDownloadHandlers && (
          <DownloadMenu
            variant="icon"
            onDownloadJSON={onDownloadAllJSON}
            onDownloadCSV={onDownloadAllCSV}
            onDownloadEssentialJSON={onDownloadAllEssentialJSON}
            onDownloadEssentialCSV={onDownloadAllEssentialCSV}
          />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopyShareLink}
              className="flex-shrink-0"
            >
              {isCopied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isCopied ? "Copied!" : "Copy shareable link"}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
