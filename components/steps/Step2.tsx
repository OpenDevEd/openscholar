"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, RefreshCw, Search, Target, Database, CheckCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { motion } from "motion/react";
import { parseBooleanQuery, type BooleanQueryPart } from "@/lib/utils";
import { StepLayout } from "./StepLayout";
import { StepHeader } from "./StepHeader";
import { ResearchQuestionDisplay } from "./ResearchQuestionDisplay";
import { LoadingState } from "./LoadingState";
import { ResultsHeader } from "./ResultsHeader";
import { NavigationButtons } from "./NavigationButtons";
import { useReview } from "@/components/review/ReviewProvider";
import { saveBooleanSearchTerms } from "../../app/actions/review";
import { normalizeSearchTerms, SearchTerm, createSearchTerm } from "../../lib/repo";

// Component to display boolean queries with syntax highlighting
function BooleanQueryDisplay({ query }: { query: string }) {
  const parts = parseBooleanQuery(query);

  // Color schemes for different nesting levels
  const getParenthesisColors = (level: number) => {
    const colors = [
      // Level 0 (outermost)
      {
        parenthesis: "text-purple-700 dark:text-purple-300 bg-gradient-to-r from-purple-100 to-purple-200 dark:from-purple-900/50 dark:to-purple-800/50 border-purple-300 dark:border-purple-600",
        content: "text-purple-800 dark:text-purple-200 bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 border-purple-200 dark:border-purple-700"
      },
      // Level 1
      {
        parenthesis: "text-emerald-700 dark:text-emerald-300 bg-gradient-to-r from-emerald-100 to-emerald-200 dark:from-emerald-900/50 dark:to-emerald-800/50 border-emerald-300 dark:border-emerald-600",
        content: "text-emerald-800 dark:text-emerald-200 bg-gradient-to-r from-emerald-50 to-emerald-100 dark:from-emerald-900/30 dark:to-emerald-800/30 border-emerald-200 dark:border-emerald-700"
      },
      // Level 2
      {
        parenthesis: "text-orange-700 dark:text-orange-300 bg-gradient-to-r from-orange-100 to-orange-200 dark:from-orange-900/50 dark:to-orange-800/50 border-orange-300 dark:border-orange-600",
        content: "text-orange-800 dark:text-orange-200 bg-gradient-to-r from-orange-50 to-orange-100 dark:from-orange-900/30 dark:to-orange-800/30 border-orange-200 dark:border-orange-700"
      },
      // Level 3+
      {
        parenthesis: "text-rose-700 dark:text-rose-300 bg-gradient-to-r from-rose-100 to-rose-200 dark:from-rose-900/50 dark:to-rose-800/50 border-rose-300 dark:border-rose-600",
        content: "text-rose-800 dark:text-rose-200 bg-gradient-to-r from-rose-50 to-rose-100 dark:from-rose-900/30 dark:to-rose-800/30 border-rose-200 dark:border-rose-700"
      }
    ];
    return colors[Math.min(level, colors.length - 1)];
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-1 font-mono text-sm bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
      {parts.map((part, index) => {
        switch (part.type) {
          case 'operator':
            return (
              <span
                key={index}
                className="inline-flex items-center px-2 py-1 text-xs font-bold text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-md shadow-sm hover:shadow-md transition-shadow duration-200 border border-blue-400"
              >
                {part.text}
              </span>
            );
          case 'parenthesis': {
            const level = part.nestingLevel || 0;
            const colors = getParenthesisColors(level);
            return (
              <span
                key={index}
                className={`inline-flex items-center px-1.5 py-0.5 text-sm font-semibold rounded-md shadow-sm ${colors.parenthesis}`}
              >
                {part.text}
              </span>
            );
          }
          case 'parenthesis_content': {
            const level = part.nestingLevel || 0;
            const colors = getParenthesisColors(level);
            return (
              <span
                key={index}
                className={`inline-flex items-center px-2 py-1 text-sm rounded border font-medium ${colors.content}`}
              >
                {part.text}
              </span>
            );
          }
          default:
            return (
              <span
                key={index}
                className="inline-flex items-center px-2 py-1 text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-600 shadow-sm font-medium"
              >
                {part.text}
              </span>
            );
        }
      })}
    </div>
  );
}

interface Step2Props {
  researchQuestion?: string;
  onContinue?: () => void;
  onBack?: () => void;
}

export function Step2({ researchQuestion: propResearchQuestion, onContinue, onBack }: Step2Props) {
  const { review, isSaving, generateAndSaveSearchTerms, goToPreviousStep, goToNextStep } = useReview();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [optimisticSearchTerms, setOptimisticSearchTerms] = useState<any[]>([]);

  // Use search terms from review context (normalized for consistency)
  const serverSearchTerms = normalizeSearchTerms(review?.searchTerms);

  // Use optimistic state if available, otherwise use server state
  const searchTerms = optimisticSearchTerms.length > 0 ? optimisticSearchTerms : serverSearchTerms;

  // Sync optimistic state with server state when server data changes
  useEffect(() => {
    if (serverSearchTerms.length > 0 && optimisticSearchTerms.length === 0) {
      setOptimisticSearchTerms(serverSearchTerms);
    }
  }, [serverSearchTerms, optimisticSearchTerms.length]);

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleGenerate = async () => {
    if (!review) return;

    setIsGenerating(true);
    setGenerationProgress(0);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setGenerationProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + Math.random() * 15;
      });
    }, 200);

    try {
      await generateAndSaveSearchTerms();
      setGenerationProgress(100);
      // Clear optimistic state so it syncs with server state
      setOptimisticSearchTerms([]);
    } catch (error) {
      console.error('Failed to generate search terms:', error);
    } finally {
      clearInterval(progressInterval);
      setIsGenerating(false);
    }
  };

  const toggleTerm = async (index: number) => {
    if (!review) {
      console.error('No review available for toggleTerm');
      return;
    }

    try {
      // Create updated search terms with toggled enabled state
      const updatedTerms = searchTerms.map((termObj, i) =>
        i === index
          ? createSearchTerm(termObj.term, !termObj.enabled)
          : createSearchTerm(termObj.term, termObj.enabled)
      );

      // Optimistically update the local terms immediately for better UX
      setOptimisticSearchTerms(updatedTerms);

      // Save the updated terms back to the database
      await saveBooleanSearchTerms(review.id, updatedTerms);

    } catch (error) {
      console.error('Failed to update search term state:', error);
      // Revert optimistic update on error
      setOptimisticSearchTerms(serverSearchTerms);
    }
  };

  useEffect(() => {
    if (searchTerms.length === 0 && review && !isGenerating) {
      handleGenerate();
    }
  }, [review, searchTerms.length, isGenerating]);

  return (
    <StepLayout>
      <StepHeader
        stepNumber={2}
        totalSteps={4}
        title="Boolean Search Terms"
        description="AI-generated search terms to help you find relevant literature"
      />

      {/* Main Content */}
      <Card className="max-w-4xl mx-auto shadow-xl border-0 bg-card/80 backdrop-blur-sm">
        <CardContent className="pt-6 space-y-6">
          <ResearchQuestionDisplay
            researchQuestion={review?.researchQuestion || propResearchQuestion || ""}
          />

          {isGenerating ? (
            <LoadingState
              icon={Search}
              title="Analyzing and generating search terms..."
              description="Analyzing your research question and generating optimized boolean search terms"
              colorScheme="blue"
              skeletonCount={3}
              autoProgress={false}
              progress={generationProgress}
            />
            ) : (
              <div className="space-y-6">
                <ResultsHeader
                  icon={Database}
                  title="Search Terms Ready"
                  subtitle={`${searchTerms.length} boolean expressions generated`}
                  count={searchTerms.length}
                  countLabel="terms"
                  onRegenerate={handleGenerate}
                  colorScheme="blue"
                />

                {/* Search Terms */}
                <div className="space-y-4">
                  {searchTerms.map((termObj, index) => {
                    const isEnabled = termObj.enabled;
                    return (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.3,
                          delay: index * 0.05,
                          ease: "easeOut"
                        }}
                        className={`group relative border border-border/50 transition-all rounded-lg ${
                        isEnabled
                          ? 'bg-muted/20 hover:bg-muted/40'
                          : 'bg-muted/10 opacity-60'
                      }`}>
                        {/* Card Header */}
                        <div className="flex items-center justify-between p-3 pb-2">
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={isEnabled}
                              onCheckedChange={() => toggleTerm(index)}
                              className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                            />
                            <div className={`p-1 rounded-full transition-colors ${
                              isEnabled
                                ? 'bg-blue-100 dark:bg-blue-900/20'
                                : 'bg-gray-100 dark:bg-gray-900/20'
                            }`}>
                              <Search className={`h-3 w-3 transition-colors ${
                                isEnabled
                                  ? 'text-blue-600 dark:text-blue-400'
                                  : 'text-gray-400 dark:text-gray-600'
                              }`} />
                            </div>
                            <Badge variant="outline" className={`text-xs transition-colors ${
                              isEnabled
                                ? ''
                                : 'text-muted-foreground border-muted-foreground/30'
                            }`}>
                              Search Term #{index + 1}
                            </Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(termObj.term, index)}
                            disabled={!isEnabled}
                            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 h-7 w-7 p-0 disabled:opacity-30"
                          >
                            {copiedIndex === index ? (
                              <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                        {/* Card Content */}
                        <div className={`px-3 pb-3 transition-opacity ${
                            isEnabled ? 'opacity-100' : 'opacity-50'
                          }`}>
                            <BooleanQueryDisplay query={termObj.term} />
                          </div>
                        </motion.div>
                      );
                    })}
                </div>
              </div>
            )}
          </CardContent>

        <CardFooter>
          <NavigationButtons
            onBack={goToPreviousStep}
            onContinue={goToNextStep}
            backText="Back to Step 1"
            continueText="Continue to Step 3"
            continueDisabled={isGenerating || searchTerms.length === 0 || isSaving}
            isLoading={isGenerating || isSaving}
          />
        </CardFooter>
      </Card>
    </StepLayout>
  );
}
