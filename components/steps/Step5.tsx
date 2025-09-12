"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Play,
  Pause,
  Square,
  Database,
  Search,
  CheckCircle,
  AlertCircle,
  Clock,
  TrendingUp,
  FileText,
  ExternalLink
} from "lucide-react";
import { motion } from "motion/react";
import { StepLayout } from "./StepLayout";
import { StepHeader } from "./StepHeader";
import { ResearchQuestionDisplay } from "./ResearchQuestionDisplay";
import { NavigationButtons } from "./NavigationButtons";
import { useReview } from "@/components/review/ReviewProvider";
import { startSearchExecution, getSearchExecutionStatus, cancelSearchExecution, restartReview } from "../../app/actions/review";
import { TOTAL_STEPS } from "../../lib/repo";
import { AIConfig } from "@/components/ai-config";
import { useAIConfigStore } from "@/lib/store";

interface Step5Props {
  researchQuestion?: string;
  onContinue?: () => void;
  onBack?: () => void;
}

interface SearchExecutionStatus {
  jobId: string;
  status: string; // Allow any string status from BullMQ
  progress: number;
  results?: any[];
  resultsCount: number;
  estimatedTimeRemaining?: number;
  currentStep?: number;
  steps?: Array<{
    name: string;
    index: number;
    status: 'pending' | 'active' | 'completed';
    startedAt?: string;
    completedAt?: string;
  }>;
  progressWithinStep?: number;
  errorMessage?: string;
  completedAt?: string;
}

export function Step5({ researchQuestion: propResearchQuestion, onContinue, onBack }: Step5Props) {
  const { review, isSaving, goToPreviousStep, goToNextStep, loadReview } = useReview();
  const { provider, apiKey } = useAIConfigStore();
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<SearchExecutionStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Polling for status updates
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (review?.jobId && !executionStatus?.completedAt) {
      setIsPolling(true);
      interval = setInterval(async () => {
        try {
          const status = await getSearchExecutionStatus(review.id);
          if (status) {
            setExecutionStatus(status);
            setError(null);

            // Stop polling if job is completed, failed, or cancelled
            if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
              setIsPolling(false);
            }
          }
        } catch (err) {
          console.error('Failed to get execution status:', err);
          setError('Failed to get execution status');
        }
      }, 2000); // Poll every 2 seconds
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [review?.jobId, review?.id, executionStatus?.completedAt]);

  // Check if search execution is already running on component mount
  useEffect(() => {
    if (review?.jobId && !executionStatus) {
      getSearchExecutionStatus(review.id).then(status => {
        if (status) {
          setExecutionStatus(status);
        }
      }).catch(err => {
        console.error('Failed to get initial execution status:', err);
      });
    }
  }, [review?.jobId, review?.id, executionStatus]);

  const handleStartSearch = async () => {
    if (!review) return;

    // Validate AI configuration
    if (!apiKey) {
      setError('Please configure your AI API key in the AI Configuration section above before starting the search execution.');
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      // Prepare AI configuration
      const aiConfig = { provider, apiKey };

      const result = await startSearchExecution(review.id, aiConfig);
      if (result.success) {
        // Refresh review data to get the new jobId
        await loadReview(review.id);

        // Immediately fetch initial status to start progress tracking
        try {
          const initialStatus = await getSearchExecutionStatus(review.id);
          if (initialStatus) {
            setExecutionStatus(initialStatus);
          }
        } catch (statusErr) {
          console.warn('Failed to get initial status after starting job:', statusErr);
        }

        console.log('Search execution started:', result);
      } else {
        setError(result.error || 'Failed to start search execution');
      }
    } catch (err) {
      console.error('Failed to start search execution:', err);
      setError('Failed to start search execution');
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancelSearch = async () => {
    if (!review?.jobId) return;

    try {
      const result = await cancelSearchExecution(review.id);
      if (result.success) {
        // Refresh review data to get updated status
        await loadReview(review.id);

        // Clear local state
        setExecutionStatus(null);
        setIsPolling(false);
        setError(null);
      } else {
        setError(result.error || 'Failed to cancel search execution');
      }
    } catch (err) {
      console.error('Failed to cancel search execution:', err);
      setError('Failed to cancel search execution');
    }
  };

  const handleRestartReview = async () => {
    if (!review) return;

    try {
      setError(null);
      const result = await restartReview(review.id);
      if (result.success) {
        // Refresh review data to get updated state
        await loadReview(review.id);

        // Clear local state to show the start button again
        setExecutionStatus(null);
        setIsPolling(false);
      } else {
        setError(result.error || 'Failed to restart review');
      }
    } catch (err) {
      console.error('Failed to restart review:', err);
      setError('Failed to restart review');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      case 'cancelled': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400';
      case 'paused': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400';
      case 'waiting': return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <TrendingUp className="h-4 w-4" />;
      case 'completed': return <CheckCircle className="h-4 w-4" />;
      case 'failed': return <AlertCircle className="h-4 w-4" />;
      case 'cancelled': return <Square className="h-4 w-4" />;
      case 'paused': return <Pause className="h-4 w-4" />;
      case 'waiting': return <Clock className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const formatTimeRemaining = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const hasSearchTerms = review?.searchTerms && Array.isArray(review.searchTerms) && review.searchTerms.length > 0;

  return (
    <StepLayout>
      <StepHeader
        stepNumber={5}
        totalSteps={TOTAL_STEPS}
        title="Systematic Review Process"
        description="Execute the complete systematic review: search, screening, and data extraction"
      />

      {/* Main Content */}
      <Card className="max-w-4xl mx-auto shadow-xl border-0 bg-card/80 backdrop-blur-sm">
        <CardContent className="pt-6 space-y-6">
          <ResearchQuestionDisplay
            researchQuestion={review?.researchQuestion || propResearchQuestion || ""}
          />

          {/* Search Terms Summary */}
          {hasSearchTerms && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-muted/50 rounded-lg p-4 border"
            >
              <div className="flex items-center gap-2 mb-3">
                <Database className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold">Search Configuration</h3>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Active search terms:</span>
                  <Badge variant="secondary">
                    {Array.isArray(review.searchTerms)
                      ? review.searchTerms.filter((term: any) =>
                          typeof term === 'string' || term.enabled !== false
                        ).length
                      : 0
                    }
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total terms configured:</span>
                  <Badge variant="outline">
                    {Array.isArray(review.searchTerms) ? review.searchTerms.length : 0}
                  </Badge>
                </div>
              </div>
            </motion.div>
          )}

          {/* AI Configuration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <AIConfig />
          </motion.div>

          {/* Error Display */}
          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Execution Status */}
          {executionStatus ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {/* Warning about no going back once started */}
              {review?.jobId && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6"
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-amber-800 dark:text-amber-200 mb-1">
                        Systematic Review in Progress
                      </p>
                      <p className="text-amber-700 dark:text-amber-300">
                        Once started, you cannot modify previous steps (research questions, search terms, etc.).
                        The back button will take you to the reviews list.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold">Search Execution</h3>
                  <Badge className={getStatusColor(executionStatus.status)}>
                    {getStatusIcon(executionStatus.status)}
                    <span className="ml-1 capitalize">{executionStatus.status}</span>
                  </Badge>
                </div>

                <div className="flex gap-2">
                  {(executionStatus.status === 'active' || executionStatus.status === 'waiting') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancelSearch}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Square className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  )}

                  {(executionStatus.status === 'cancelled' || executionStatus.status === 'completed') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRestartReview}
                      className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Restart Review
                    </Button>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Progress</span>
                  <span>{executionStatus.progress}%</span>
                </div>
                <Progress value={executionStatus.progress} className="w-full" />
              </div>

              {/* Status Details */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {executionStatus.resultsCount?.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">Results Found</div>
                </div>

                {executionStatus.currentStep !== undefined && executionStatus.steps && (
                  <div className="text-center">
                    <div className="text-lg font-semibold text-purple-600">
                      Step {executionStatus.currentStep + 1}
                    </div>
                    <div className="text-sm text-muted-foreground">Current Step</div>
                  </div>
                )}

                {executionStatus.progressWithinStep !== undefined && (
                  <div className="text-center">
                    <div className="text-lg font-semibold text-orange-600">
                      {executionStatus.progressWithinStep}%
                    </div>
                    <div className="text-sm text-muted-foreground">Step Progress</div>
                  </div>
                )}

                {executionStatus.estimatedTimeRemaining && (
                  <div className="text-center">
                    <div className="text-lg font-semibold text-green-600">
                      {formatTimeRemaining(executionStatus.estimatedTimeRemaining)}
                    </div>
                    <div className="text-sm text-muted-foreground">Time Remaining</div>
                  </div>
                )}
              </div>

              {/* Detailed Steps Progress */}
              {executionStatus.steps && executionStatus.steps.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 space-y-3"
                >
                  <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                    Execution Steps
                  </h4>
                  <div className="space-y-2">
                    {executionStatus.steps.map((step) => {
                      // Check if review is actively running
                      const isReviewActive = executionStatus && (executionStatus.status === 'active' || executionStatus.status === 'waiting');
                      const isActiveStep = step.status === 'active' && isReviewActive;

                      return (
                        <div
                          key={step.index}
                          className={isActiveStep ? 'active-step-border' : ''}
                        >
                          <div
                            className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                              step.status === 'completed'
                                ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                                : step.status === 'active'
                                ? 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800'
                                : 'bg-gray-50 dark:bg-gray-900/10 border-gray-200 dark:border-gray-800'
                            }`}
                          >
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${
                              step.status === 'completed'
                                ? 'bg-green-500'
                                : step.status === 'active'
                                ? 'bg-blue-500 animate-pulse'
                                : 'bg-gray-400'
                            }`} />
                            <div>
                              <div className="font-medium text-sm">
                                {step.name}
                              </div>
                              {step.startedAt && (
                                <div className="text-xs text-muted-foreground">
                                  Started: {new Date(step.startedAt).toLocaleTimeString()}
                                  {step.completedAt && (
                                    <> • Completed: {new Date(step.completedAt).toLocaleTimeString()}</>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="text-xs font-medium">
                            {step.status === 'completed' && (
                              <span className="text-green-600 dark:text-green-400">✓ Done</span>
                            )}
                            {step.status === 'active' && (
                              <span className="text-blue-600 dark:text-blue-400">⟳ Active</span>
                            )}
                            {step.status === 'pending' && (
                              <span className="text-gray-500 dark:text-gray-400">○ Pending</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </motion.div>
              )}

              {/* Polling Indicator */}
              {isPolling && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  Monitoring progress...
                </div>
              )}

              {/* Error Message */}
              {executionStatus.errorMessage && (
                <Alert className="border-red-200 bg-red-50">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800">
                    {executionStatus.errorMessage}
                  </AlertDescription>
                </Alert>
              )}

              {/* Results Preview */}
              {executionStatus.status === 'completed' && executionStatus.results && executionStatus.results.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-green-50 dark:bg-green-900/10 rounded-lg p-4 border border-green-200 dark:border-green-800"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <h4 className="font-semibold text-green-800 dark:text-green-400">Search Completed Successfully!</h4>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-green-700 dark:text-green-300">Total results found:</span>
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
                        {executionStatus.resultsCount?.toLocaleString()}
                      </Badge>
                    </div>

                    <div className="text-sm text-green-700 dark:text-green-300">
                      Systematic review completed! Results are ready for the final summary phase.
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          ) : (
            /* Start Search Section */
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center space-y-6"
            >
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/10 dark:to-purple-900/10 rounded-lg p-8 border border-blue-200 dark:border-blue-800">
                <Search className="h-16 w-16 text-blue-600 mx-auto mb-4" />

                <h3 className="text-xl font-semibold mb-2">
                  Ready to Execute Systematic Review
                </h3>

                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  The complete systematic review process will be executed: searching databases,
                  screening results, and extracting data from included studies. This comprehensive
                  process may take several minutes to complete.
                </p>

                {!hasSearchTerms && (
                  <Alert className="mb-6 border-yellow-200 bg-yellow-50">
                    <AlertCircle className="h-4 w-4 text-yellow-600" />
                    <AlertDescription className="text-yellow-800">
                      No active search terms found. Please configure search terms in Step 2 before proceeding.
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  onClick={handleStartSearch}
                  disabled={isStarting || !hasSearchTerms}
                  size="lg"
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  {isStarting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Starting Systematic Review...
                    </>
                  ) : (
                    <>
                      <Play className="h-5 w-5 mr-2" />
                      Start Systematic Review Process
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}
        </CardContent>

        <CardFooter>
          <NavigationButtons
            onBack={() => {
              // If a job has been started, go back to reviews list
              // Otherwise, go to previous step
              if (review?.jobId) {
                router.push('/review');
              } else {
                goToPreviousStep();
              }
            }}
            onContinue={executionStatus?.status === 'completed' ? () => {
              goToNextStep().catch(err => console.error('Failed to go to next step:', err));
            } : undefined}
            backText={review?.jobId ? "Back to Reviews" : "Back to Data Extraction Questions"}
            continueText="View Final Results"
            continueDisabled={executionStatus?.status !== 'completed' || isSaving}
            isLoading={isStarting || isSaving}
          />
        </CardFooter>
      </Card>
    </StepLayout>
  );
}
