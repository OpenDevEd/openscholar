"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  useUIStore,
  useSearchHistoryStore,
  useCurrentQueryStore,
} from "@/lib/store";
import { toast } from "sonner";
import {
  useQueryChangeHandler,
  useCreateSearchFilters,
} from "@/lib/hooks";
import { submitNewSearch } from "@/lib/search";
import { selectQueryFromHistory } from "@/lib/search-actions";
import { serializeSearchParams, type ParsedSearchParams } from "@/lib/search-params";
import { Logo } from "@/components/logo";
import { Search, Loader2, BookOpen } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { KeywordExpansionTooltip } from "@/components/keyword-expansion-tooltip";
import React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { enhanceSearchQuery } from "@/app/actions/ai-enhance";
import { useAIConfigStore } from "@/lib/store";

function PageContent() {
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
  const { provider, model, apiKey } = useAIConfigStore();

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
        // Check if AI configuration is available
        if (!apiKey) {
          toast.error("Configuration Required", {
            description: "Please configure your AI API key in the settings first.",
          });
          return;
        }

        if (!provider) {
          toast.error("Configuration Required", {
            description: "Please select an AI provider in the settings first.",
          });
          return;
        }

        // Start AI enhancement loading state
        setIsEnhancingQuestion(true);

        // Convert research question to search query using AI
        const result = await enhanceSearchQuery(originalQuery, provider, apiKey, model);

        // Use the enhanced query for searching
        searchQuery = result.enhancedQuery;

        toast.success("Research Question Processed", {
          description: `Converted to search query: "${searchQuery}"`,
        });

      } catch (error) {
        console.error("Failed to convert research question:", error);
        toast.error("Question Conversion Failed", {
          description: "Failed to convert research question to search query. Please check your AI configuration.",
        });
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
    <div className="flex flex-col items-center justify-center px-4 py-12 md:py-20 flex-1">
      <div className="w-full max-w-2xl space-y-8">
        {/* Logo & Tagline */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <Logo
              size="xl"
              className="hidden sm:flex"
              context="home"
              clickable={false}
            />
            <Logo
              size="lg"
              className="sm:hidden"
              context="home"
              clickable={false}
            />
          </div>
          <p className="text-muted-foreground text-base sm:text-lg max-w-md mx-auto">
            Search millions of academic papers and research articles
          </p>
        </div>

        {/* AI Enhancement Loading */}
        <AnimatePresence>
          {isEnhancingQuestion && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="text-center"
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-50 border border-orange-200 dark:bg-orange-950/30 dark:border-orange-800">
                <Loader2 className="h-4 w-4 animate-spin text-orange-600 dark:text-orange-400" />
                <span className="text-sm text-orange-700 dark:text-orange-300">
                  Converting research question to search query...
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Search Form - Glass Card */}
        <form onSubmit={handleSubmit} className="w-full">
          <div className="glass-card rounded-2xl p-4 md:p-6 space-y-4">
            {/* Search Input */}
            <div className="relative">
              <Textarea
                name="query"
                value={currentQuery}
                placeholder="Search for papers, topics... or ask a research question ending with ?"
                className="w-full border-0 bg-transparent resize-none min-h-[80px] max-h-40 focus-visible:ring-0 focus-visible:ring-offset-0 text-base md:text-lg placeholder:text-muted-foreground/60"
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
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/50">
              <div className="flex items-center gap-2">
                <KeywordExpansionTooltip
                  query={currentQuery}
                  side="top"
                  variant="ghost"
                  buttonClassName="h-10 px-3"
                  asLink
                  href="/bookmarks"
                />
              </div>

              <Button
                type="submit"
                disabled={isFormDisabled || !currentQuery.trim()}
                size="lg"
                className="rounded-full px-6 gap-2 btn-hover"
              >
                {isEnhancingQuestion ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    <span>Search</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>

        {/* Keyboard Shortcut Hint */}
        <p className="text-center text-xs text-muted-foreground">
          Press <kbd className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs font-mono">Enter</kbd> to search,
          <kbd className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs font-mono ml-1">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(PageContent), { ssr: false });
