"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useParams, useRouter } from "next/navigation";
import { useTranslations, useLocale, useFormatter, useNow } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  FileText,
  RefreshCw,
  Trash2,
  XCircle,
  ChevronLeft,
} from "lucide-react";
import Link from "next/link";
import { motion } from "motion/react";
import { PageWrapper } from "@/components/PageWrapper";
import { CommandCenterContainer } from "@/components/command-center";
import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAppToast } from "@/lib/toast";
import { ResultsToolbar, type ResultsSortBy } from "@/components/extraction/results-toolbar";
import { TableView, CardView, SplitView } from "@/components/extraction/results-views";
import { SmartPagination } from "@/components/extraction/smart-pagination";
import { BulkActionsBar } from "@/components/extraction/bulk-actions-bar";
import { ExportDialog } from "@/components/extraction/export-dialog";
import { InsightsOverview } from "@/components/extraction/insights-overview";
import { InsightsQuestionPanel } from "@/components/extraction/insights-question-panel";
import { ReviewQueue } from "@/components/extraction/review-queue";
import { ReportBuilder } from "@/components/extraction/report-builder";
import { ExtractionResultsShell } from "@/components/extraction/extraction-results-shell";
import { ExtractionCitationSidebar } from "@/components/extraction/extraction-citation-sidebar";
import { useSelection } from "@/lib/hooks/use-selection";
import { useIsMobile } from "@/lib/hooks";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import type { Infer } from "convex/values";
import type { extractionSavedViewValidator } from "@/convex/extraction/validators";
import type { CitationPanelPayload } from "@/lib/extraction/citation-panel";
import { useExtractionCitationPanelStore } from "@/lib/store";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import {
  useProtectedPaginatedQuery,
  useProtectedQuery,
} from "@/lib/auth/use-auth-query";
import {
  defaultFilters,
  filterPapers,
  preprocessPapers,
  type FilterState,
  type PaperWithResults,
  type Question,
} from "@/lib/extraction/filtering";
import { getAuthSensitiveListRenderState } from "@/lib/auth/list-render-state";

export default function JobDetailPage() {
  const toast = useAppToast();
  const tError = useTranslations('errorPages');
  const tJob = useTranslations('jobStatus');
  const tConfirm = useTranslations('confirmations');
  const tView = useTranslations('extractionView');
  const tExtraction = useTranslations('extraction');
  const tc = useTranslations('common');
  const tPdf = useTranslations('pdfViewer');
  const locale = useLocale();
  const format = useFormatter();
  const now = useNow();
  
  const params = useParams();
  const router = useRouter();
  const isMobile = useIsMobile();
  const jobId = params.jobId as Id<"extractionJobs">;

  const pdfEnabled = useFeatureFlag("extraction.pdf");
  const insightsEnabled = useFeatureFlag("extraction.insights");
  const reviewQueueEnabled = useFeatureFlag("extraction.reviewQueue");
  const reportBuilderEnabled = useFeatureFlag("extraction.reportBuilder");
  const templatesEnabled = useFeatureFlag("extraction.templates");

  const viewModeSerialize = useCallback((v: 'table' | 'cards' | 'split') => v, []);
  const viewModeDeserialize = useCallback((v: string) => v as 'table' | 'cards' | 'split', []);

  const [viewMode, setViewMode] = useUrlState<'table' | 'cards' | 'split'>(
    'view',
    'table',
    viewModeSerialize,
    viewModeDeserialize
  );

  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [searchQueryResetKey, setSearchQueryResetKey] = useState(0);
  const debouncedFilters = useDebouncedValue(filters, 150);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [activeTab, setActiveTab] = useState<
    "results" | "insights" | "review" | "report" | "overview"
  >("results");
  const [selectedInsightsQuestion, setSelectedInsightsQuestion] = useState<string | undefined>(undefined);
  const [resultsSortBy, setResultsSortBy] = useState<ResultsSortBy>('default');
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'all' | 'selected'>('all');
  const [citationPanelPayload, setCitationPanelPayload] = useState<CitationPanelPayload | null>(null);
  const [mobilePane, setMobilePane] = useState<"results" | "citation">("results");
  const { expand: expandCitationPanel } = useExtractionCitationPanelStore();

  const questionTypeLabels = useMemo(() => ({
    boolean: tExtraction('typeYesNo'),
    string: tExtraction('typeText'),
    number: tExtraction('typeNumber'),
    array: tExtraction('typeList'),
  }), [tExtraction]);

  const cancelJob = useMutation(api.extraction.mutations.cancelExtraction);
  const deleteJob = useMutation(api.extraction.mutations.deleteExtraction);
  const duplicateJob = useMutation(
    api.extraction.mutations.duplicateJob,
  );

  const jobDetailsQuery = useProtectedQuery(api.extraction.queries.getJobDetails, {
    jobId,
  });
  const jobDetails = jobDetailsQuery.data;
  const canReadJob = jobDetails?.status === "ok";
  const jobProgressQuery = useProtectedQuery(
    api.extraction.queries.subscribeToJobProgress,
    canReadJob ? { jobId } : "skip",
  );
  const jobProgress = jobProgressQuery.data;

  const {
    results: allPapers,
    status: paginationStatus,
    loadMore,
    isDeferred: isResultsDeferred,
    settlement: resultsSettlement,
    hasLoadedFirstPage,
  } = useProtectedPaginatedQuery(
    api.extraction.queries.getJobResultsPaginated,
    canReadJob ? { jobId } : "skip",
    { initialNumItems: 200 },
  );

  const isLoadingRef = useRef(false);
  const hasAttemptedLoadRef = useRef(false);
  useEffect(() => {
    if (paginationStatus !== "LoadingMore") {
      isLoadingRef.current = false;
    }
  }, [paginationStatus]);

  useEffect(() => {
    if (!canReadJob) return;
    if (paginationStatus !== "CanLoadMore") return;
    if (allPapers.length >= 200) return;
    if (isLoadingRef.current || hasAttemptedLoadRef.current) return;

    isLoadingRef.current = true;
    hasAttemptedLoadRef.current = true;
    loadMore(200);
  }, [canReadJob, paginationStatus, allPapers.length, loadMore]);

  const questions: Question[] = useMemo(() => {
    if (jobDetails?.status !== "ok") return [];
    return jobDetails.questions.map((q: { key: string; question: string; type: string; description?: string }) => ({
      key: q.key,
      question: q.question,
      type: q.type as 'boolean' | 'string' | 'array' | 'number',
      description: q.description,
    }));
  }, [jobDetails]);

  const effectiveSelectedInsightsQuestion =
    selectedInsightsQuestion && questions.some((q) => q.key === selectedInsightsQuestion)
      ? selectedInsightsQuestion
      : questions[0]?.key;

  const papersWithResults = useMemo(
    () => allPapers as PaperWithResults[],
    [allPapers]
  );

  const preprocessedData = useMemo(
    () => preprocessPapers(papersWithResults),
    [papersWithResults]
  );

  const filteredPapers = useMemo(
    () => filterPapers(papersWithResults, debouncedFilters, questions, preprocessedData, pdfEnabled),
    [papersWithResults, debouncedFilters, questions, preprocessedData, pdfEnabled]
  );

  const sortedPapers = useMemo(() => {
    if (resultsSortBy === 'default') return filteredPapers;
    const sorted = [...filteredPapers];
    switch (resultsSortBy) {
      case 'title-asc':
        return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      case 'title-desc':
        return sorted.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
      case 'confidence-high': {
        const avgConf = (p: PaperWithResults) => {
          if (!p.results.length) return 0;
          return p.results.reduce((sum, r) => sum + (r.confidence || 0), 0) / p.results.length;
        };
        return sorted.sort((a, b) => avgConf(b) - avgConf(a));
      }
      case 'confidence-low': {
        const avgConf = (p: PaperWithResults) => {
          if (!p.results.length) return 0;
          return p.results.reduce((sum, r) => sum + (r.confidence || 0), 0) / p.results.length;
        };
        return sorted.sort((a, b) => avgConf(a) - avgConf(b));
      }
      default:
        return sorted;
    }
  }, [filteredPapers, resultsSortBy]);

  const hasActiveResultFilters = useMemo(
    () =>
      debouncedFilters.searchQuery.trim().length > 0 ||
      debouncedFilters.confidenceRange[0] > 0 ||
      debouncedFilters.confidenceRange[1] < 100 ||
      debouncedFilters.statusFilters.size > 0 ||
      debouncedFilters.questionFilters.size > 0,
    [
      debouncedFilters.confidenceRange,
      debouncedFilters.questionFilters,
      debouncedFilters.searchQuery,
      debouncedFilters.statusFilters,
    ],
  );
  const resultsRenderState = getAuthSensitiveListRenderState({
    settlement: resultsSettlement,
    hasLoadedFirstPage,
    visibleCount: sortedPapers.length,
    hasActiveFilter: hasActiveResultFilters,
  });

  const totalPages = Math.ceil(sortedPapers.length / pageSize);
  const displayedPapers = useMemo(
    () => sortedPapers.slice(
      (currentPage - 1) * pageSize,
      currentPage * pageSize
    ),
    [sortedPapers, currentPage, pageSize]
  );


  const paperIds = useMemo(
    () => papersWithResults.map(p => p._id),
    [papersWithResults]
  );

  const {
    selectedIds,
    clearSelection,
    setSelection,
  } = useSelection<string>(paperIds);

  const selectedPapers = useMemo(
    () => papersWithResults.filter(p => selectedIds.has(p._id)),
    [papersWithResults, selectedIds]
  );

  const handleTableSelectionChange = useCallback((newIds: Set<string>) => {
    setSelection(newIds);
  }, [setSelection]);

  const handleCardSelectionChange = useCallback((newIds: Set<string>) => {
    setSelection(newIds);
  }, [setSelection]);

  const openCitationPanel = useCallback((payload: CitationPanelPayload) => {
    setCitationPanelPayload(payload);
    expandCitationPanel();
    setMobilePane("citation");
  }, [expandCitationPanel]);

  const handleCancel = async () => {
    try {
      await cancelJob({ jobId });
    } catch (error) {
      toast.job.cancelFailed();
    }
  };

  const handleDelete = async () => {
    try {
      await deleteJob({ jobId });
      router.push("/extraction");
    } catch (error) {
      toast.job.deleteFailed();
    }
  };

  const handleDuplicate = async () => {
    try {
      const result = await duplicateJob({ jobId });
      router.push(`/extraction/${result.jobId}`);
    } catch (error) {
      toast.job.createFailed(error);
    }
  };

  const handleApplySavedView = useCallback(
    (view: Infer<typeof extractionSavedViewValidator>) => {
      setFilters({
        searchQuery: view?.filters?.searchQuery || "",
        confidenceRange: Array.isArray(view?.filters?.confidenceRange)
          ? (view.filters.confidenceRange as [number, number])
          : [0, 100],
        statusFilters: new Set(view?.filters?.statusFilters || []),
        questionFilters: new Map(),
      });
      if (view?.sortBy) {
        setResultsSortBy(view.sortBy as ResultsSortBy);
      }
      if (view?.viewMode && ["table", "cards", "split"].includes(view.viewMode)) {
        setViewMode(view.viewMode as "table" | "cards" | "split");
      }
      setCurrentPage(1);
      setActiveTab("results");
      setSearchQueryResetKey((k) => k + 1);
    },
    [setViewMode, setFilters, setResultsSortBy, toast, tJob, tc]
  );

  if (jobDetailsQuery.isDeferred || isResultsDeferred || jobDetails === undefined) {
    return (
      <PageWrapper>
        <AuthStatePanel variant="loading" layout="fullscreen" />
      </PageWrapper>
    );
  }

  if (jobDetails.status === "unauthenticated") {
    return (
      <PageWrapper>
        <div className="container mx-auto max-w-4xl p-6">
          <AuthStatePanel
            variant="sign_in_required"
            description={tError('signInToView')}
            primaryHref="/sign-in"
            primaryLabel={tc('signIn')}
            secondaryHref="/extraction"
            secondaryLabel={tError('backToJobs')}
          />
        </div>
      </PageWrapper>
    );
  }

  if (jobDetails.status === "no_access") {
    return (
      <PageWrapper>
        <div className="container mx-auto max-w-4xl p-6">
          <AuthStatePanel
            variant="no_access"
            description={tError('noAccess')}
            primaryHref="/extraction"
            primaryLabel={tError('backToJobs')}
          />
        </div>
      </PageWrapper>
    );
  }

  const { job, progress } = jobDetails;
  const jobProgressSafe = jobProgress?.status === "ok" ? jobProgress : null;
  const resolvedProgress = jobProgressSafe
    ? {
        total: jobProgressSafe.totalPapers,
        processed: jobProgressSafe.processedPapers,
        failed: jobProgressSafe.failedPapers,
        percentage:
          jobProgressSafe.totalPapers > 0
            ? Math.round(
                ((jobProgressSafe.processedPapers +
                  jobProgressSafe.failedPapers) /
                  jobProgressSafe.totalPapers) *
                  100,
              )
            : 0,
      }
    : progress;

  const isProcessing =
    job.status === "pending" ||
    job.status === "downloading_pdfs" ||
    job.status === "extracting";
  return (
    <div className="flex w-full flex-1 flex-col overflow-x-clip">
      <TwoColumnLayout
        leftColumn={
          isMobile ? null : (
            <ExtractionCitationSidebar
              panelPayload={citationPanelPayload}
            />
          )
        }
        rightColumn={
          <PageWrapper>
            <div className="container mx-auto max-w-6xl p-4 sm:p-6">
              <CommandCenterContainer>
          {/* Header Section */}
          <div className="px-4 md:px-6 py-5 border-b border-border/40">
            {/* Breadcrumb */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="flex items-center gap-2 text-muted-foreground text-sm mb-4"
            >
              <Link
                href="/extraction"
                className="hover:text-foreground transition-colors flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                {tc('extraction')}
              </Link>
              <span>/</span>
              <span className="text-foreground truncate max-w-[200px]">{job.name}</span>
            </motion.div>

            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 w-full overflow-hidden">
              <div className="flex items-center gap-3 truncate">
                {/* Gradient icon */}
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 flex items-center justify-center shadow-sm shrink-0">
                  <FileText className="h-5 w-5 text-primary" />
                </div>

                <div className="min-w-0">
                  <motion.h1
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="text-xl md:text-2xl font-bold tracking-tight text-foreground truncate"
                  >
                    {job.name}
                  </motion.h1>

                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-1"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full",
                          job.status === "completed"
                            ? "bg-emerald-500"
                            : job.status === "failed"
                            ? "bg-destructive"
                            : "bg-primary animate-pulse"
                        )}
                      />
                      <span>
                        {(
                          {
                            pending: tJob("statusPending"),
                            downloading_pdfs: tJob("statusDownloadingPdfs"),
                            extracting: tJob("statusExtracting"),
                            completed: tJob("statusCompleted"),
                            failed: tJob("statusFailed"),
                            cancelled: tJob("statusCancelled"),
                          } as Record<string, string>
                        )[job.status ?? "pending"] ?? (job.status ?? "pending").replace(/_/g, " ")}
                      </span>
                    </div>

                    <span className="w-1 h-1 rounded-full bg-border" />

                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      <span>{tJob('papersCount', { count: format.number(job.totalPapers ?? 0) })}</span>
                    </div>

                    <span className="w-1 h-1 rounded-full bg-border" />

                    <div className="flex items-center gap-1.5">
                      <RefreshCw className={cn("w-3.5 h-3.5", isProcessing && "animate-spin")} />
                      <span>{tJob('updated', { timeAgo: format.relativeTime(new Date(job.updatedAt), now) })}</span>
                    </div>
                  </motion.div>
                </div>
              </div>

              {/* Action Buttons */}
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.15 }}
                className="flex items-center gap-2 shrink-0"
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDuplicate}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {tJob('restart')}
                </Button>

                {isProcessing && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        {tc('cancel')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{tConfirm('cancelJob')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {tConfirm('cancelJobDescription')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tConfirm('keepRunning')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleCancel}
                          className="bg-destructive hover:bg-destructive/90"
                        >
                          {tConfirm('yesCancel')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      {tc('delete')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{tConfirm('deleteJob')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {tConfirm('deleteJobDescription')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        {tConfirm('yesDelete')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </motion.div>
            </div>
          </div>

          {/* Stats Section */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="px-4 md:px-6 py-5 border-b border-border/40"
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  {tJob('totalPapers')}
                </p>
                <p className="text-2xl lg:text-3xl font-bold text-foreground">
                  {format.number(job.totalPapers ?? 0)}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  {tJob('processed')}
                </p>
                <p className="text-2xl lg:text-3xl font-bold text-foreground">
                  {format.number(resolvedProgress.processed)}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  {tJob('successRate')}
                </p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl lg:text-3xl font-bold text-primary">
                    {resolvedProgress.percentage}%
                  </p>
                  {isProcessing && (
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  {tJob('questions')}
                </p>
                <p className="text-2xl lg:text-3xl font-bold text-foreground">
                  {questions.length}
                </p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">{tJob('extractionProgress')}</span>
                <span className="font-medium text-foreground">
                  {tJob('progressOfPapers', {
                    processed: resolvedProgress.processed + resolvedProgress.failed,
                    total: resolvedProgress.total,
                  })}
                </span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${resolvedProgress.percentage}%` }}
                  transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full bg-primary rounded-full"
                />
              </div>
            </div>
          </motion.div>

          {/* Tab Navigation */}
          <div className="px-4 md:px-6 border-b border-border/40">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('results')}
                className={cn(
                  "px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                  activeTab === 'results'
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tView('extractionResults')}
              </button>
              {insightsEnabled && (
                <button
                  onClick={() => setActiveTab("insights")}
                  className={cn(
                    "px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                    activeTab === "insights"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tView('insights')}
                </button>
              )}
              {reviewQueueEnabled && (
                <button
                  onClick={() => setActiveTab("review")}
                  className={cn(
                    "px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                    activeTab === "review"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tView('reviewQueue')}
                </button>
              )}
              {reportBuilderEnabled && (
                <button
                  onClick={() => setActiveTab("report")}
                  className={cn(
                    "px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                    activeTab === "report"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tView('reportBuilder')}
                </button>
              )}
              <button
                onClick={() => setActiveTab('overview')}
                className={cn(
                  "px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                  activeTab === 'overview'
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tView('overviewQuestions')}
              </button>
            </div>
          </div>

          {/* Content Section */}
          <div className="overflow-x-hidden p-4 md:p-6">
          {activeTab === 'results' ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="min-w-0 overflow-x-hidden"
            >
              <ExtractionResultsShell
                panelPayload={citationPanelPayload}
                mobilePane={mobilePane}
                onMobilePaneChange={setMobilePane}
                primaryLabel={tView('results')}
              >
                <ResultsToolbar
                  filters={filters}
                  searchQueryResetKey={searchQueryResetKey}
                  onFiltersChange={(f) => {
                    setFilters(f);
                    setCurrentPage(1);
                  }}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  totalCount={papersWithResults.length}
                  filteredCount={sortedPapers.length}
                  questions={questions}
                  sortBy={resultsSortBy}
                  onSortChange={setResultsSortBy}
                  onExportAll={() => {
                    setExportMode('all');
                    setExportDialogOpen(true);
                  }}
                />

                <div className="min-h-[600px] min-w-0">
                  {resultsRenderState === "loading" ? (
                    <div className="my-6 flex min-h-[420px] items-center justify-center rounded-xl border border-border bg-muted/30 py-24 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-primary/80" />
                        <p className="text-sm text-muted-foreground">
                          {tJob('loadingExtractionResults')}
                        </p>
                      </div>
                    </div>
                  ) : resultsRenderState === "empty" ||
                    resultsRenderState === "filtered_empty" ? (
                    <div className="my-6 flex flex-col items-center justify-center rounded-xl border border-border bg-muted py-24 text-center">
                      <FileText className="mb-4 h-16 w-16 text-muted-foreground/50" />
                       <h3 className="mb-2 text-xl font-semibold text-foreground">
                        {resultsRenderState === "filtered_empty"
                          ? tJob('noMatches')
                          : tc('noResultsFound')}
                      </h3>
                      <p className="max-w-md text-muted-foreground">
                        {resultsRenderState === "filtered_empty"
                          ? tc('tryAdjustingSearch')
                          :                           papersWithResults.length === 0
                          ? job.status === "completed"
                            ? tPdf('noResultsDescription')
                            : tPdf('resultsWillAppear')
                          : tPdf('resultsWillAppear')}
                      </p>
                      {resultsRenderState === "filtered_empty" && (
                        <Button
                          variant="outline"
                          className="mt-6"
                          onClick={() => {
                          setFilters(defaultFilters);
                          setCurrentPage(1);
                          setSearchQueryResetKey((k) => k + 1);
                        }}
                        >
                          {tJob('clearFilters')}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <>
                      {viewMode === 'table' && (
                        <TableView
                          papers={displayedPapers}
                          questions={questions}
                          selectedIds={selectedIds}
                          onSelectionChange={handleTableSelectionChange}
                          searchQuery={filters.searchQuery}
                          onOpenCitationPanel={openCitationPanel}
                          usePdfs={job.usePdfs ?? false}
                        />
                      )}
                      {viewMode === 'cards' && (
                        <CardView
                          papers={displayedPapers}
                          questions={questions}
                          selectedIds={selectedIds}
                          onSelectionChange={handleCardSelectionChange}
                          onOpenCitationPanel={openCitationPanel}
                        />
                      )}
                      {viewMode === 'split' && (
                        <SplitView
                          papers={sortedPapers}
                          questions={questions}
                          onOpenCitationPanel={openCitationPanel}
                        />
                      )}
                    </>
                  )}
                </div>

                {sortedPapers.length > 0 && viewMode !== 'split' && (
                  <SmartPagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={setPageSize}
                    totalCount={papersWithResults.length}
                    filteredCount={sortedPapers.length}
                    displayedCount={displayedPapers.length}
                  />
                )}

                {viewMode !== 'split' && (
                  <BulkActionsBar
                    selectedIds={selectedIds}
                    papers={selectedPapers}
                    questions={questions}
                    onClearSelection={clearSelection}
                  />
                )}

                <ExportDialog
                  open={exportDialogOpen}
                  onOpenChange={setExportDialogOpen}
                  papers={exportMode === 'all' ? sortedPapers : selectedPapers}
                  questions={questions}
                  label={
                    exportMode === 'all'
                      ? sortedPapers.length === 1
                        ? tView('filteredPapersCount', { count: sortedPapers.length })
                        : tView('filteredPapersCountPlural', { count: sortedPapers.length })
                      : selectedIds.size === 1
                        ? tView('selectedPapersCount', { count: selectedIds.size })
                        : tView('selectedPapersCountPlural', { count: selectedIds.size })
                  }
                />
              </ExtractionResultsShell>
            </motion.div>
          ) : activeTab === "insights" ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-6"
            >
              <InsightsOverview
                jobId={jobId}
                selectedQuestionKey={effectiveSelectedInsightsQuestion}
                onSelectQuestion={setSelectedInsightsQuestion}
                onRerun={handleDuplicate}
                enabled={canReadJob}
              />
              <InsightsQuestionPanel
                key={effectiveSelectedInsightsQuestion}
                jobId={jobId}
                questionKey={effectiveSelectedInsightsQuestion}
                enabled={canReadJob}
                onJumpToPaper={(paperId) => {
                  const target = papersWithResults.find((paper) => paper._id === paperId);
                  if (!target) return;
                  setFilters((prev) => ({
                    ...prev,
                    searchQuery: target.title,
                  }));
                  setActiveTab("results");
                  setCurrentPage(1);
                }}
              />
            </motion.div>
          ) : activeTab === "review" ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="min-w-0 overflow-x-hidden"
            >
              <ExtractionResultsShell
                panelPayload={citationPanelPayload}
                mobilePane={mobilePane}
                onMobilePaneChange={setMobilePane}
                primaryLabel={tView('review')}
              >
                <ReviewQueue
                  jobId={jobId}
                  enabled={canReadJob}
                  onOpenCitationPanel={openCitationPanel}
                />
              </ExtractionResultsShell>
            </motion.div>
          ) : activeTab === "report" ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <ReportBuilder
                jobId={jobId}
                filters={filters}
                sortBy={resultsSortBy}
                viewMode={viewMode}
                questions={questions}
                onApplySavedView={handleApplySavedView}
                canUseTemplates={templatesEnabled}
                canUseRunDiff={reportBuilderEnabled}
              />
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-8"
            >
              {/* Questions Section */}
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/50">
                  <h3 className="text-lg font-semibold text-foreground">
                    {tView('extractionQuestions')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {tView('schemaDefinedDescription')}
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {questions.map((q, idx) => (
                    <motion.div
                      key={q.key}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: idx * 0.05 }}
                      className="px-6 py-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="font-medium text-foreground">{q.question}</p>
                          {q.description && (
                            <p className="text-sm text-muted-foreground mt-1">{q.description}</p>
                          )}
                        </div>
                        <span className="px-3 py-1 bg-muted text-muted-foreground text-xs font-medium uppercase rounded-full">
                          {questionTypeLabels[q.type] ?? q.type}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
              </div>
                </CommandCenterContainer>
            </div>
          </PageWrapper>
        }
      />
    </div>
  );
}
