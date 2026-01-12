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
  
  const { currentQuery, setCurrentQuery } = useCurrentQueryStore();
  const handleQueryChange = useQueryChangeHandler(setCurrentQuery);

  // Translation loading state
  const [isTranslating, setIsTranslating] = React.useState(false);

  // Get loading states from search context or default to false
  const isLoading = search?.isLoading ?? false;
  const isValidating = search?.isValidating ?? false;
  const apiUrl = search?.apiUrl ?? '';

  const isFormDisabled = isLoading || isValidating || isTranslating;

  // Get current search ID and result for language persistence
  const effectiveSearchId = useEffectiveSearchId();
  const { updateSearchResult } = useSearchHistoryStore();

  // Get current language directly from store (single source of truth)
  const selectedLanguage = useSearchHistoryStore((state) => {
    const currentResult = effectiveSearchId ? state.searchHistory.find((item) => item.id === effectiveSearchId) : null;
    return currentResult?.language || "";
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Update query via the search context if available
    if (search) {
      search.setQuery(currentQuery);
    }
  };

  const handleLanguageChange = async (language: string) => {
    const previousValue = selectedLanguage;

    if (effectiveSearchId && language && previousValue !== language) {
      try {
        // If there's a current query and language changed, translate it
        if (currentQuery.trim()) {
          const { provider, apiKey } = useAIConfigStore.getState();

          if (!apiKey) {
            toast.error("API Key Required", {
              description: "Please configure your AI API key to translate queries.",
            });
            // Still save the language even if translation fails
            updateSearchResult(effectiveSearchId, { language: language || undefined });
            return;
          }

          if (!provider) {
            toast.error("Provider Required", {
              description: "Please select an AI provider to translate queries.",
            });
            // Still save the language even if translation fails
            updateSearchResult(effectiveSearchId, { language: language || undefined });
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

            const translatedQuery = await translateQuery(expandedQuery, language, provider, apiKey);

            // Update both language and translated query
            updateSearchResult(effectiveSearchId, {
              language: language || undefined,
            });

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
            // Still save the language even if translation fails
          } finally {
            // Always clear translation loading state
            setIsTranslating(false);
          }
        } else {
          // No query to translate, just save the language
          updateSearchResult(effectiveSearchId, { language: language || undefined });
        }
      } catch (error) {
        console.error("Language change error:", error);
        toast.error("Language Update Failed", {
          description: "Could not update language preference.",
        });
        // Make sure to clear loading state on any error
        setIsTranslating(false);
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
  const { provider, apiKey } = useAIConfigStore();
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

      const result = await enhanceSearchQuery(questionToProcess, provider, apiKey, currentSearchResult?.language);

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

  const { provider, apiKey } = useAIConfigStore();
  const { setCurrentQuery } = useCurrentQueryStore();
  const { currentQuestion } = useCurrentQuestionStore();

  // Get current search result language
  const effectiveSearchId = useEffectiveSearchId();
  const currentLanguage = useSearchHistoryStore((state) => {
    const currentResult = effectiveSearchId ? state.searchHistory.find((item) => item.id === effectiveSearchId) : null;
    return currentResult?.language || "";
  });

  // Conditional button visibility
  const showBroadenButton = totalCount < 10 && currentQuery.trim();
  const showNarrowButton = totalCount > 1000 && currentQuery.trim();

  const handleBroadenQuery = async () => {
    if (!currentQuery.trim() || !apiKey || !provider) return;

    const { expandedQuery } = validateAndExpandKeywordsSilently(currentQuery);

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
      setCurrentQuery(result.enhancedQuery);

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
    if (!currentQuery.trim() || !apiKey || !provider) return;

    const { expandedQuery } = validateAndExpandKeywordsSilently(currentQuery);

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
      setCurrentQuery(result.enhancedQuery);

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

interface NavbarProps {
  loadingResultIndex?: number | null;
}

interface NavButtonProps {
  href: string;
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  badge?: number;
  asChild?: boolean;
  onClick?: () => void;
}

const NavButton: React.FC<NavButtonProps> = ({
  href,
  icon: Icon,
  label,
  isActive,
  badge,
  asChild = true,
  onClick,
}) => {
  const buttonContent = (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {badge && badge > 0 && (
        <span
          className={cn(
            "text-xs px-1.5 py-0.5 rounded-full",
            isActive
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {badge}
        </span>
      )}
    </div>
  );

  const buttonProps = {
    variant: (isActive ? "default" : "ghost") as "default" | "ghost",
    size: "sm" as const,
    className: cn(
      "flex-shrink-0 h-8 px-3",
      isActive && "bg-primary text-primary-foreground"
    ),
  };

  if (asChild) {
    return (
      <Button {...buttonProps} asChild>
        <Link href={href} onClick={onClick}>
          {buttonContent}
        </Link>
      </Button>
    );
  }

  return (
    <Button {...buttonProps} onClick={onClick}>
      {buttonContent}
    </Button>
  );
};

export function Navbar({ loadingResultIndex = null }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { searchHistory } = useSearchHistoryStore();
  const isMobile = useIsMobile();
  const effectiveSearchId = useEffectiveSearchId();
  
  // Get search field from context or default
  const search = useSearchOptional();
  const currentSearchField = (search?.params?.field ?? 'title_and_abstract') as any;

  // Use shared current query state for navbar/home page synchronization
  const { currentQuery, setCurrentQuery } = useCurrentQueryStore();

  // Get query directly from search history for syncing
  const searchState = effectiveSearchId
    ? searchHistory.find((item) => item.id === effectiveSearchId)
    : null;
  const historyQuery = searchState?.query || "";

  // Sync current query with search history when navigating to different search results
  React.useEffect(() => {
    if (effectiveSearchId) {
      setCurrentQuery(historyQuery);
    }
  }, [historyQuery, effectiveSearchId, setCurrentQuery]);

  // State for mobile menu interactions
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Check if we're on a results page
  const isOnResultsPage = pathname?.startsWith("/results");

  // Determine current page for navigation indicators
  const getCurrentPage = () => {
    if (!pathname) return null;
    if (pathname === "/") return "home";
    if (
      pathname.startsWith("/results") &&
      !pathname.includes("/bookmarks") &&
      !pathname.includes("/ai-enhancement") &&
      !pathname.includes("/history") &&
      !pathname.includes("/filters") &&
      !pathname.includes("/screening")
    )
      return "results";
    if (pathname.includes("/bookmarks")) return "bookmarks";
    if (pathname.includes("/ai-enhancement")) return "ai-enhancement";
    if (pathname.includes("/history")) return "history";
    if (pathname.includes("/filters")) return "filters";
    if (pathname.includes("/screening")) return "screening";
    return null;
  };

  const currentPage = getCurrentPage();

  // Note: All query initialization and synchronization is now handled centrally by QuerySyncProvider
  // No local useEffect needed - the provider handles everything

  // Function to close the mobile sheet when navigation items are clicked
  const closeSheet = () => {
    setSheetOpen(false);
  };

  const handleSearchHistoryClick = async (
    query: string,
    searchField: any,
    dateRange?: any,
    sortBy?: string,
    yearRange?: [number, number],
    filterType?: "date" | "year",
    index?: number
  ) => {
    // With SWR, we just need to navigate to the search result
    // The data will be automatically loaded by the SWR hook
    const { searchHistory } = useSearchHistoryStore.getState();
    const searchResult = searchHistory[index || 0];

    if (searchResult?.id) {
      router.push(`/results/${searchResult.id}`);
    } else {
      toast.error("Search not found", {
        description: "The requested search could not be found in your history.",
      });
    }
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6">
        {/* Desktop: Single row layout (lg and above) */}
        <div className="hidden lg:flex h-16 items-center justify-between gap-4">
          {/* Left side - Logo and Search */}
          <div className="flex items-center space-x-2 sm:space-x-4 flex-1 min-w-0">
            <Logo size="sm" className="flex-shrink-0" context="navbar" />
          </div>

          {/* Right side - Navigation and Actions */}
          <div className="flex items-center space-x-1 lg:space-x-2 flex-shrink-0">
            {/* Results Button - Show when we have search results or are on results page */}
            {(isOnResultsPage || effectiveSearchId) && (
              <NavButton
                href={
                  effectiveSearchId
                    ? `/results/${effectiveSearchId}`
                    : "/results"
                }
                icon={FileText}
                label="Results"
                isActive={currentPage === "results"}
              />
            )}

            {/* AI Enhancement Button */}
            {/* <NavButton
              href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/ai-enhancement` : "/ai-enhancement"}
              icon={Sparkles}
              label="AI Enhance"
              isActive={currentPage === 'ai-enhancement'}
            /> */}

            {/* Keywords Button with Preview Tooltip */}
            <KeywordExpansionTooltip
              query={currentQuery}
              side="bottom"
              variant={currentPage === "bookmarks" ? "default" : "ghost"}
              buttonClassName="h-8 px-3"
              asLink
              href={
                isOnResultsPage && effectiveSearchId
                  ? `/results/${effectiveSearchId}/bookmarks`
                  : "/bookmarks"
              }
            />

            {/* Screening Button */}
            {/* <NavButton
              href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/screening` : "/screening"}
              icon={ClipboardCheck}
              label="Screening"
              isActive={currentPage === 'screening'}
            /> */}

            {/* Search History Button */}
            {isOnResultsPage ? (
              effectiveSearchId ? (
                <NavButton
                  href={`/results/${effectiveSearchId}/history`}
                  icon={Clock}
                  label="History"
                  isActive={currentPage === "history"}
                  badge={searchHistory.length}
                />
              ) : (
                <NavButton
                  href="/history"
                  icon={Clock}
                  label="History"
                  isActive={currentPage === "history"}
                  badge={searchHistory.length}
                />
              )
            ) : (
              <Sheet>
                <SheetTrigger asChild>
                  <NavButton
                    href="/history"
                    icon={Clock}
                    label="History"
                    isActive={currentPage === "history"}
                    badge={searchHistory.length}
                  />
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="w-[400px] sm:w-[500px] flex flex-col"
                >
                  <SheetHeader className="flex-shrink-0">
                    <SheetTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      Search History
                    </SheetTitle>
                  </SheetHeader>
                  <div className="flex-1 overflow-y-auto px-6 pb-6">
                    <SearchHistory
                      onSearchResults={handleSearchHistoryClick}
                      loadingResultIndex={loadingResultIndex}
                      currentSearchField="title_and_abstract"
                      compact={true}
                      currentSearchId={effectiveSearchId}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            )}

            {/* Theme Toggle */}
            <ThemeToggle />
          </div>
        </div>

        {/* Mobile: Single row with hamburger menu */}
        <div className="lg:hidden">
          <div className="flex h-16 items-center justify-between gap-2">
            {/* Hamburger Menu */}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="flex-shrink-0">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] p-0">
                <div className="flex flex-col h-full">
                  <SheetHeader className="p-6 pb-4 border-b">
                    <SheetTitle className="flex items-center gap-2">
                      <Logo size="md" context="general" />
                      <span className="sr-only">Navigation Menu</span>
                    </SheetTitle>
                  </SheetHeader>

                  <div className="flex-1 overflow-y-auto p-6">
                    <div className="space-y-1">
                      {/* Home */}
                      <Button
                        variant={currentPage === "home" ? "default" : "ghost"}
                        className="w-full justify-start"
                        asChild
                        onClick={closeSheet}
                      >
                        <Link href="/">
                          <Home className="mr-3 h-4 w-4" />
                          Home
                        </Link>
                      </Button>

                      {/* Results - Show when we have search results or are on results page */}
                      {(isOnResultsPage || effectiveSearchId) && (
                        <Button
                          variant={
                            currentPage === "results" ? "default" : "ghost"
                          }
                          className="w-full justify-start"
                          asChild
                          onClick={closeSheet}
                        >
                          <Link
                            href={
                              effectiveSearchId
                                ? `/results/${effectiveSearchId}`
                                : "/results"
                            }
                          >
                            <FileText className="mr-3 h-4 w-4" />
                            Results
                          </Link>
                        </Button>
                      )}

                      {/* Filters */}
                      {isOnResultsPage && effectiveSearchId && (
                        <Button
                          variant={
                            currentPage === "filters" ? "default" : "ghost"
                          }
                          className="w-full justify-start"
                          asChild
                          onClick={closeSheet}
                        >
                          <Link href={`/results/${effectiveSearchId}/filters`}>
                            <Filter className="mr-3 h-4 w-4" />
                            Filters
                          </Link>
                        </Button>
                      )}

                      {/* AI Enhancement */}
                      {/* <Button
                        variant={currentPage === 'ai-enhancement' ? "default" : "ghost"}
                        className="w-full justify-start"
                        asChild
                        onClick={closeSheet}
                      >
                        <Link href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/ai-enhancement` : "/ai-enhancement"}>
                          <Sparkles className="mr-3 h-4 w-4" />
                          AI Enhancement
                        </Link>
                      </Button> */}

                      {/* Screening */}
                      {/* <Button
                        variant={currentPage === 'screening' ? "default" : "ghost"}
                        className="w-full justify-start"
                        asChild
                        onClick={closeSheet}
                      >
                        <Link href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/screening` : "/screening"}>
                          <ClipboardCheck className="mr-3 h-4 w-4" />
                          Screening
                        </Link>
                      </Button> */}

                      {/* Translate (disabled) */}
                      <Button
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground"
                        disabled
                      >
                        <Languages className="mr-3 h-4 w-4" />
                        Translate
                      </Button>
                    </div>

                    <Separator className="my-4" />

                    <div className="space-y-1">
                      {/* Bookmarks */}
                      <Button
                        variant={
                          currentPage === "bookmarks" ? "default" : "ghost"
                        }
                        className="w-full justify-start"
                        asChild
                        onClick={closeSheet}
                      >
                        <Link
                          href={
                            isOnResultsPage && effectiveSearchId
                              ? `/results/${effectiveSearchId}/bookmarks`
                              : "/bookmarks"
                          }
                        >
                          <BookOpen className="mr-3 h-4 w-4" />
                          Bookmarks
                        </Link>
                      </Button>

                      {/* History */}
                      <Button
                        variant={
                          currentPage === "history" ? "default" : "ghost"
                        }
                        className="w-full justify-start"
                        asChild
                        onClick={closeSheet}
                      >
                        <Link
                          href={
                            isOnResultsPage && effectiveSearchId
                              ? `/results/${effectiveSearchId}/history`
                              : "/history"
                          }
                        >
                          <Clock className="mr-3 h-4 w-4" />
                          History
                          {searchHistory.length > 0 && (
                            <span
                              className={`ml-auto text-xs rounded-full px-2 py-0.5 ${
                                currentPage === "history"
                                  ? "bg-primary-foreground/20 text-primary-foreground"
                                  : "bg-primary text-primary-foreground"
                              }`}
                            >
                              {searchHistory.length}
                            </span>
                          )}
                        </Link>
                      </Button>
                    </div>

                    <Separator className="my-4" />

                    <div className="space-y-1">
                      <div className="px-3 py-2 text-sm font-medium text-muted-foreground">
                        View Options
                      </div>

                      {/* List View (disabled for now) */}
                      <Button
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground"
                        disabled
                      >
                        <List className="mr-3 h-4 w-4" />
                        List View
                      </Button>

                      {/* Table View (disabled for now) */}
                      <Button
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground"
                        disabled
                      >
                        <Table className="mr-3 h-4 w-4" />
                        Table View
                      </Button>

                      {/* Screening Results (disabled for now) */}
                      <Button
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground"
                        disabled
                      >
                        <Shield className="mr-3 h-4 w-4" />
                        Screening Results
                      </Button>
                    </div>

                    <Separator className="my-4" />

                    <div className="space-y-1">
                      {/* Preferences (disabled for now) */}
                      <Button
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground"
                        disabled
                      >
                        <Settings className="mr-3 h-4 w-4" />
                        Preferences
                      </Button>

                      {/* Login (disabled for now) */}
                      <Button
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground"
                        disabled
                      >
                        <LogIn className="mr-3 h-4 w-4" />
                        Login
                      </Button>
                    </div>
                  </div>

                  {/* Theme Toggle at bottom */}
                  <div className="p-6 pt-4 border-t">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Theme</span>
                      <ThemeToggle />
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
}
