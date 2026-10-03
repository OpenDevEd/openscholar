"use client";

import { useConvex, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useFormatter, useNow } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  FileText,
  RefreshCw,
  Trash2,
  XCircle,
  Pause,
  Play,
  Download,
  MoreHorizontal,
  ListChecks,
  SearchX,
  DocumentIcon,
} from "@/components/icons";
import posthog from "posthog-js";
import { PageWrapper } from "@/components/PageWrapper";
import { ListEmpty, ListLoading } from "@/components/evidence-libraries/list-controls";
import { LibraryPageShell, PageFrameLoading } from "@/components/evidence-libraries/library-page-shell";
import { JobStatusIcon } from "@/components/extraction/job-status-icon";
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
} from "@/components/ui/alert-dialog";
import { useState, useMemo, useCallback } from "react";
import { useAppToast } from "@/lib/toast";
import { ResultsColumnsMenu, ResultsFilterMenu, ResultsFilters, ResultsViewSwitch, type ResultsSortBy } from "@/components/extraction/results-toolbar";
import { TableView, CardView, SplitView } from "@/components/extraction/results-views";
import { SmartPagination } from "@/components/extraction/smart-pagination";
import { BulkActionsBar } from "@/components/extraction/bulk-actions-bar";
import { ExportDialog } from "@/components/extraction/export-dialog";
import { readEveryResultsPage } from "@/lib/extraction/export";
import { RESULTS_PAGE_SIZE_MAX } from "@/lib/extraction/limits";
import { ExtractionResultsShell } from "@/components/extraction/extraction-results-shell";
import { ExtractionCitationSidebar } from "@/components/extraction/extraction-citation-sidebar";
import { ChatJobView } from "@/components/extraction/chat/chat-job-view";
import { CostBadge } from "@/components/extraction/cost-badge";
import { CreditsExhaustedBanner } from "@/components/extraction/credits-exhausted-banner";
import { JobStatusBanner } from "@/components/extraction/job-status-banner";
import { JobProgressBar } from "@/components/extraction/job-progress-bar";
import { NowProcessing } from "@/components/extraction/now-processing";
import { MixedSuccessSummary } from "@/components/extraction/mixed-success-summary";
import { RetrySummary } from "@/components/extraction/retry-summary";
import { useSelection } from "@/lib/hooks/use-selection";
import { useIsMobile } from "@/lib/hooks";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { openAnswerKey, type OpenAnswer } from "@/components/extraction/answer-panel";
import { useExtractionCitationPanelStore } from "@/lib/store";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import {
  useProtectedQuery,
} from "@/lib/auth/use-auth-query";
import {
  defaultFilters,
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
  const tErrors = useTranslations('errors');
  const tc = useTranslations('common');
  const tPdf = useTranslations('pdfViewer');
  const format = useFormatter();
  const now = useNow();
  
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const jobId = params.jobId as Id<"extractionJobs">;
  // Wizard hands off `?mode=chat` so the destination shows "Preparing chat…" copy from frame zero instead of the generic spinner that flips to the chat label once the shell resolves.
  const modeHint = searchParams.get("mode");

  const viewModeSerialize = useCallback((v: 'table' | 'cards' | 'split') => v, []);
  const viewModeDeserialize = useCallback((v: string) => v as 'table' | 'cards' | 'split', []);

  const [viewMode, setViewMode] = useUrlState<'table' | 'cards' | 'split'>(
    'view',
    'table',
    viewModeSerialize,
    viewModeDeserialize
  );

  // Plan-04: per-paper Credits column visibility. URL-backed so refresh
  // and deep-links preserve the user's chosen column set.
  const showCreditsSerialize = useCallback(
    (v: boolean) => (v ? "1" : "0"),
    [],
  );
  const showCreditsDeserialize = useCallback(
    (v: string) => v === "1",
    [],
  );
  const [showCreditsColumn, setShowCreditsColumn] = useUrlState<boolean>(
    "credits",
    false,
    showCreditsSerialize,
    showCreditsDeserialize,
  );

  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [searchQueryResetKey, setSearchQueryResetKey] = useState(0);
  const debouncedFilters = useDebouncedValue(filters, 150);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(200);

  const [resultsSortBy, setResultsSortBy] = useState<ResultsSortBy>('default');
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [confirming, setConfirming] = useState<"cancel" | "delete" | null>(null);
  const [exportMode, setExportMode] = useState<'all' | 'selected'>('all');
  const [openAnswer, setOpenAnswer] = useState<OpenAnswer | null>(null);
  const [mobilePane, setMobilePane] = useState<"results" | "citation">("results");
  const { expand: expandCitationPanel } = useExtractionCitationPanelStore();

  const cancelJob = useMutation(api.extraction.mutations.cancelExtraction);
  const deleteJob = useMutation(api.extraction.mutations.deleteExtraction);
  const duplicateJob = useMutation(
    api.extraction.mutations.duplicateJob,
  );
  const pauseJob = useMutation(api.extraction.mutations.pause.pauseExtraction);
  const resumeJob = useMutation(
    api.extraction.mutations.resume.resumeExtraction,
  );

  const jobShellQuery = useProtectedQuery(api.extraction.queries.getJobShell, {
    jobId,
  });
  const jobShell = jobShellQuery.data;
  const hasCurrentJobShell =
    jobShell?.status !== "ok" || jobShell.job._id === jobId;
  const shellJob = jobShell?.status === "ok" ? jobShell.job : undefined;
  const isExtractionJob =
    hasCurrentJobShell && shellJob?.mode === "extraction";
  const jobDetailsQuery = useProtectedQuery(
    api.extraction.queries.getJobDetails,
    isExtractionJob ? { jobId } : "skip",
  );
  const jobDetails = jobDetailsQuery.data;
  const hasCurrentJobDetails =
    jobDetails?.status !== "ok" || jobDetails.job._id === jobId;
  const jobProgressQuery = useProtectedQuery(
    api.extraction.queries.subscribeToJobProgress,
    isExtractionJob ? { jobId } : "skip",
  );
  const jobProgress = jobProgressQuery.data;

  const serializedResultsFilters = useMemo(
    () => ({
      searchQuery: debouncedFilters.searchQuery,
      confidenceRange: debouncedFilters.confidenceRange,
      statusFilters: Array.from(debouncedFilters.statusFilters),
      questionFilters: Array.from(
        debouncedFilters.questionFilters,
        ([questionKey, value]) => ({
          questionKey,
          value,
        }),
      ),
    }),
    [debouncedFilters],
  );

  const resultsPageArgs = useMemo(
    () =>
      isExtractionJob
        ? {
            jobId,
            page: currentPage,
            pageSize,
            filters: serializedResultsFilters,
            sortBy: resultsSortBy,
          }
        : "skip",
    [
      currentPage,
      isExtractionJob,
      jobId,
      pageSize,
      serializedResultsFilters,
      resultsSortBy,
    ],
  );
  const resultsPageQuery = useProtectedQuery(
    api.extraction.queries.getJobResultsPage,
    resultsPageArgs,
  );
  const resultsPage = resultsPageQuery.data;

  const convex = useConvex();
  const loadAllPapers = useCallback(
    () =>
      readEveryResultsPage((page) =>
        convex.query(api.extraction.queries.getJobResultsPage, {
          jobId,
          page,
          pageSize: RESULTS_PAGE_SIZE_MAX,
          filters: serializedResultsFilters,
          sortBy: resultsSortBy,
        }),
      ) as Promise<PaperWithResults[]>,
    [convex, jobId, serializedResultsFilters, resultsSortBy],
  );

  const questions: Question[] = useMemo(() => {
    if (jobDetails?.status !== "ok") return [];
    return jobDetails.questions.map((q: { key: string; question: string; type: string; description?: string }) => ({
      key: q.key,
      question: q.question,
      type: q.type as 'boolean' | 'string' | 'array' | 'number',
      description: q.description,
    }));
  }, [jobDetails]);

  const papersWithResults = useMemo(
    () =>
      resultsPage?.status === "ok"
        ? (resultsPage.items as PaperWithResults[])
        : [],
    [resultsPage]
  );

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
    settlement: resultsPageQuery.settlement,
    hasLoadedFirstPage: resultsPageQuery.isReady,
    visibleCount: papersWithResults.length,
    hasActiveFilter: hasActiveResultFilters,
  });

  const displayedPapers = papersWithResults;


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
  const loadSelectedPapers = useCallback(async () => selectedPapers, [selectedPapers]);

  const handleTableSelectionChange = useCallback((newIds: Set<string>) => {
    setSelection(newIds);
  }, [setSelection]);

  const handleCardSelectionChange = useCallback((newIds: Set<string>) => {
    setSelection(newIds);
  }, [setSelection]);

  // Clicking the answer that is already open closes the panel again.
  const openAnswerPanel = useCallback((answer: OpenAnswer) => {
    if (openAnswerKey(answer) === openAnswerKey(openAnswer)) {
      setOpenAnswer(null);
      setMobilePane("results");
      return;
    }
    setOpenAnswer(answer);
    expandCitationPanel();
    setMobilePane("citation");
  }, [expandCitationPanel, openAnswer]);

  const handleCancel = async () => {
    try {
      await cancelJob({ jobId });
    } catch (error) {
      toast.job.cancelFailed();
    }
  };

  const handlePause = async () => {
    const details =
      jobDetails?.status === "ok" ? jobDetails : undefined;
    try {
      const result = await pauseJob({ jobId });
      if (result.paused && details) {
        posthog.capture("extraction_job_paused", {
          jobId,
          duration_so_far_ms: Date.now() - details.job.createdAt,
          processed_papers:
            jobProgress?.status === "ok"
              ? jobProgress.processedPapers
              : undefined,
        });
      }
    } catch (error) {
      toast.job.pauseFailed();
    }
  };

  const handleResume = async () => {
    const job =
      jobDetails?.status === "ok" ? jobDetails.job : undefined;
    // Capture the source BEFORE calling the mutation — post-mutation the
    // status has already flipped away from creditsExhausted/paused.
    const source: "user" | "credits_topup" =
      job?.status === "creditsExhausted" ? "credits_topup" : "user";
    const pausedForMs =
      job?.pausedAt !== undefined ? Date.now() - job.pausedAt : 0;
    try {
      const result = await resumeJob({ jobId });
      if (result.resumed) {
        posthog.capture("extraction_job_resumed", {
          jobId,
          paused_for_ms: pausedForMs,
          source,
        });
      }
    } catch (error) {
      // resumeFailed carries through INSUFFICIENT_CREDITS context so the
      // user gets the "buy credits" CTA.
      toast.job.resumeFailed(error);
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

  if (
    jobShellQuery.isDeferred ||
    jobShell === undefined ||
    !hasCurrentJobShell ||
    (isExtractionJob &&
      (jobDetailsQuery.isDeferred ||
        jobDetails === undefined ||
        !hasCurrentJobDetails ||
        resultsPageQuery.isDeferred))
  ) {
    const showChatPreparingHint = modeHint === "chat" && jobShell === undefined;
    // A chat has its own full-height layout; everything else loads inside the
    // page frame it will end up in, so nothing jumps when the job arrives.
    if (!showChatPreparingHint) {
      return (
        <PageWrapper>
          <PageFrameLoading label={tJob("loadingExtractionResults")} />
        </PageWrapper>
      );
    }
    return (
      <PageWrapper>
        <AuthStatePanel
          variant="loading"
          layout="fullscreen"
          loadingStyle="spinner"
          title={showChatPreparingHint ? tExtraction("chatPreparing") : undefined}
        />
      </PageWrapper>
    );
  }

  if (jobShell.status === "unauthenticated") {
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

  if (jobShell.status === "no_access") {
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

  if (shellJob?.mode === "chat") {
    if (!shellJob.chatThreadId) {
      return (
        <PageWrapper>
          {shellJob.error ? (
            <div
              role="alert"
              className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-8 text-center text-destructive"
              data-chat-state="error"
              data-error-code={shellJob.error.code}
            >
              <strong>
                {tErrors(`title.${shellJob.error.code}` as never)}
              </strong>
              <span className="text-sm text-muted-foreground">
                {tErrors(`body.${shellJob.error.code}` as never)}
              </span>
            </div>
          ) : (
            <div data-chat-state="preparing">
              <AuthStatePanel
                variant="loading"
                layout="fullscreen"
                loadingStyle="spinner"
                title={tExtraction("chatPreparing")}
              />
            </div>
          )}
        </PageWrapper>
      );
    }
    return (
      <div
        // Fit the chat below whichever navigation the app shell is showing.
        className="flex h-[calc(100dvh-var(--app-navbar-height))] w-full flex-col overflow-hidden"
        data-job-mode="chat"
      >
        <ChatJobView job={shellJob} threadId={shellJob.chatThreadId} />
      </div>
    );
  }

  if (jobDetails?.status !== "ok" || !hasCurrentJobDetails) {
    return (
      <PageWrapper>
        <PageFrameLoading label={tJob("loadingExtractionResults")} />
      </PageWrapper>
    );
  }

  const { job } = jobDetails;
  const statusLabel =
    ({
      pending: tJob("statusPending"),
      downloading_pdfs: tJob("statusDownloadingPdfs"),
      extracting: tJob("statusExtracting"),
      completed: tJob("statusCompleted"),
      failed: tJob("statusFailed"),
      cancelled: tJob("statusCancelled"),
    } as Record<string, string>)[job.status ?? "pending"] ?? (job.status ?? "pending").replace(/_/g, " ");
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
    : {
        total: job.totalPapers ?? 0,
        processed: 0,
        failed: 0,
        percentage: 0,
      };
  const authoritativeTotalPapers =
    resultsPage?.status === "ok"
      ? resultsPage.totalAll
      : resolvedProgress.total;
  const authoritativeFilteredPapers =
    resultsPage?.status === "ok"
      ? resultsPage.totalFiltered
      : resolvedProgress.total;
  const resultsScope = "full";
  const totalPages =
    resultsPage?.status === "ok" ? resultsPage.totalPages : 0;

  const isProcessing =
    job.status === "pending" ||
    job.status === "downloading_pdfs" ||
    job.status === "extracting";

  return (
    <div
      className="flex w-full flex-1 flex-col overflow-x-clip"
      data-job-mode="extraction"
    >
      <TwoColumnLayout
        leftColumn={
          isMobile ? null : (
            <ExtractionCitationSidebar
              answer={openAnswer}
            />
          )
        }
        rightColumn={
          <PageWrapper>
            <LibraryPageShell
              icon={DocumentIcon}
              title={job.name}
              backHref="/extraction"
              backLabel={tError("backToJobs")}
              titleAside={
                <JobStatusIcon
                  status={job.status ?? "pending"}
                  label={statusLabel}
                />
              }
              tabs={<ResultsViewSwitch value={viewMode} onChange={setViewMode} />}
              filters={
                <ResultsFilters
                  filters={filters}
                  searchQueryResetKey={searchQueryResetKey}
                  onFiltersChange={(f) => {
                    setFilters(f);
                    setCurrentPage(1);
                  }}
                  sortBy={resultsSortBy}
                  onSortChange={setResultsSortBy}
                />
              }
              actions={<>
                <ResultsFilterMenu
                  filters={filters}
                  onFiltersChange={(f) => {
                    setFilters(f);
                    setCurrentPage(1);
                  }}
                />
                {viewMode === "table" && <ResultsColumnsMenu showCredits={showCreditsColumn} onShowCreditsChange={setShowCreditsColumn} />}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      aria-label={tc("export")}
                      disabled={authoritativeFilteredPapers === 0}
                      onClick={() => {
                        setExportMode('all');
                        setExportDialogOpen(true);
                      }}
                    >
                      <Download className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tc("export")}</TooltipContent>
                </Tooltip>
                {isProcessing && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-foreground"
                        data-action="pause"
                        onClick={handlePause}
                        aria-label={tExtraction('pause.button')}
                      >
                        <Pause className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{tExtraction('pause.button')}</TooltipContent>
                  </Tooltip>
                )}

                {job.status === "paused" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-foreground"
                        data-action="resume"
                        onClick={handleResume}
                        aria-label={tExtraction('paused.resume')}
                      >
                        <Play className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{tExtraction('paused.resume')}</TooltipContent>
                  </Tooltip>
                )}

                {/* Less frequent and destructive actions stay one click away, like the chat's menu. */}
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" aria-label={tExtraction("chatHeaderMore")}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>{tExtraction("chatHeaderMore")}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="min-w-44">
                    <DropdownMenuItem onSelect={handleDuplicate}>
                      <RefreshCw className="size-4" />
                      {tJob('restart')}
                    </DropdownMenuItem>
                    {isProcessing && (
                      <DropdownMenuItem variant="destructive" onSelect={() => setConfirming("cancel")}>
                        <XCircle className="size-4" />
                        {tc('cancel')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirming("delete")}>
                      <Trash2 className="size-4" />
                      {tc('delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <AlertDialog open={confirming === "cancel"} onOpenChange={(open) => !open && setConfirming(null)}>
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
                <AlertDialog open={confirming === "delete"} onOpenChange={(open) => !open && setConfirming(null)}>
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
              </>}
              intro={<>
          {/* What the job covers and how far it has got. Its name and state sit in the bar. */}
          <div className="space-y-3 border-b border-border-subtle px-4 py-4 md:px-6">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <FileText className="size-3.5" />
                {tJob('papersCount', { count: format.number(job.totalPapers ?? 0) })}
              </span>
              <span className="flex items-center gap-1.5">
                <ListChecks className="size-3.5" />
                {tJob('questionsCount', { count: questions.length })}
              </span>
              <span className="flex items-center gap-1.5">
                <RefreshCw className={cn("size-3.5", isProcessing && "animate-spin")} />
                {tJob('updated', { timeAgo: format.relativeTime(new Date(job.updatedAt), now) })}
              </span>
              <CostBadge
                jobId={jobId}
                compact
                href={`/settings/billing?jobId=${jobId}`}
              />
            </div>
            <JobProgressBar
              jobName={job.name}
              processed={resolvedProgress.processed}
              failed={resolvedProgress.failed}
              total={resolvedProgress.total}
              complete={job.status === "completed"}
            />
            {job.status === "completed" && (
              <MixedSuccessSummary
                jobId={jobId}
                papersRead={resolvedProgress.processed}
                onShowFailures={() => {
                  setFilters((prev) => ({ ...prev, statusFilters: new Set([...prev.statusFilters, "has-errors"]) }));
                  setCurrentPage(1);
                }}
              />
            )}
          </div>

          {/* Status banner stack. Each child self-hides (returns null)
              when it has nothing to show; `space-y-4` only emits gaps
              between real DOM siblings, and `empty:hidden` collapses
              the whole strip when every banner is null — so no phantom
              padding remains on clean completed / idle jobs. */}
          <div className="space-y-3 border-b border-border-subtle px-4 py-4 empty:hidden md:px-6">
            {job.status === "creditsExhausted" && (
              <CreditsExhaustedBanner
                onResume={handleResume}
                onCancelRemaining={handleCancel}
              />
            )}

            {job.status === "paused" && (
              <JobStatusBanner
                variant="paused"
                processedPapers={resolvedProgress.processed}
                totalPapers={job.totalPapers}
                onResume={handleResume}
                onCancelRemaining={handleCancel}
              />
            )}

            {(job.status === "completed" ||
              job.status === "failed" ||
              job.status === "creditsExhausted") && (
              <RetrySummary jobId={jobId} usePdfs={job.usePdfs ?? false} />
            )}


            <NowProcessing jobId={jobId} />
          </div>

              </>}
            >
          {/* Results */}
          <div className="min-w-0 overflow-x-hidden">
            <div className="min-w-0">
              <ExtractionResultsShell
                answer={openAnswer}
                mobilePane={mobilePane}
                onMobilePaneChange={setMobilePane}
                primaryLabel={tView('results')}
              >

                <div
                  className="min-h-[500px] min-w-0"
                  data-results-scope={resultsScope}
                  data-total-papers={authoritativeTotalPapers}
                  data-filtered-papers={authoritativeFilteredPapers}
                >
                  {resultsRenderState === "loading" ? (
                    <ListLoading label={tJob('loadingExtractionResults')} />
                  ) : resultsRenderState === "empty" ||
                    resultsRenderState === "filtered_empty" ? (
                    resultsRenderState === "filtered_empty" ? (
                      <ListEmpty
                        icon={SearchX}
                        description={tc('tryAdjustingSearch')}
                        action={
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setFilters(defaultFilters);
                              setCurrentPage(1);
                              setSearchQueryResetKey((k) => k + 1);
                            }}
                          >
                            {tJob('clearFilters')}
                          </Button>
                        }
                      >
                        {tJob('noMatches')}
                      </ListEmpty>
                    ) : (
                      <ListEmpty
                        icon={FileText}
                        description={papersWithResults.length === 0 && job.status === "completed" ? tPdf('noResultsDescription') : tPdf('resultsWillAppear')}
                      >
                        {tc('noResultsFound')}
                      </ListEmpty>
                    )
                  ) : (
                    <>
                      {viewMode === 'table' && (
                        <TableView
                          papers={displayedPapers}
                          questions={questions}
                          selectedIds={selectedIds}
                          onSelectionChange={handleTableSelectionChange}
                          searchQuery={filters.searchQuery}
                          onOpenAnswer={openAnswerPanel}
                          openAnswer={openAnswerKey(openAnswer)}
                          usePdfs={job.usePdfs ?? false}
                          showCredits={showCreditsColumn}
                        />
                      )}
                      {viewMode === 'cards' && (
                        <CardView
                          papers={displayedPapers}
                          questions={questions}
                          selectedIds={selectedIds}
                          onSelectionChange={handleCardSelectionChange}
                          onOpenAnswer={openAnswerPanel}
                          openAnswer={openAnswerKey(openAnswer)}
                        />
                      )}
                      {viewMode === 'split' && (
                        <SplitView
                          papers={displayedPapers}
                          questions={questions}
                          onOpenAnswer={openAnswerPanel}
                        />
                      )}
                    </>
                  )}
                </div>

                {authoritativeFilteredPapers > 0 && (
                  <SmartPagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={(nextPageSize) => {
                      setPageSize(nextPageSize);
                      setCurrentPage(1);
                    }}
                    totalCount={authoritativeTotalPapers}
                    filteredCount={authoritativeFilteredPapers}
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
                  loadPapers={exportMode === 'all' ? loadAllPapers : loadSelectedPapers}
                  paperCount={exportMode === 'all' ? authoritativeFilteredPapers : selectedPapers.length}
                  questions={questions}
                  label={
                    exportMode === 'all'
                      ? authoritativeFilteredPapers === 1
                        ? tView('filteredPapersCount', { count: authoritativeFilteredPapers })
                        : tView('filteredPapersCountPlural', { count: authoritativeFilteredPapers })
                      : selectedIds.size === 1
                        ? tView('selectedPapersCount', { count: selectedIds.size })
                        : tView('selectedPapersCountPlural', { count: selectedIds.size })
                  }
                />
              </ExtractionResultsShell>
            </div>
          </div>
            </LibraryPageShell>
          </PageWrapper>
        }
      />
    </div>
  );
}
