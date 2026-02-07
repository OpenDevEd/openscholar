"use client";

import { useQuery, usePaginatedQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useParams, useRouter } from "next/navigation";
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
import { formatTimeAgo } from "@/lib/format";
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
import { toast } from "sonner";
import { ResultsToolbar } from "@/components/extraction/results-toolbar";
import { TableView, CardView, SplitView } from "@/components/extraction/results-views";
import { SmartPagination } from "@/components/extraction/smart-pagination";
import { BulkActionsBar } from "@/components/extraction/bulk-actions-bar";
import { useSelection } from "@/lib/hooks/use-selection";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  defaultFilters,
  filterPapers,
  preprocessPapers,
  type FilterState,
  type PaperWithResults,
  type Question,
} from "@/lib/extraction/filtering";

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as any;

  const viewModeSerialize = useCallback((v: 'table' | 'cards' | 'split') => v, []);
  const viewModeDeserialize = useCallback((v: string) => v as 'table' | 'cards' | 'split', []);

  const [viewMode, setViewMode] = useUrlState<'table' | 'cards' | 'split'>(
    'view',
    'table',
    viewModeSerialize,
    viewModeDeserialize
  );

  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const debouncedFilters = useDebouncedValue(filters, 150);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [activeTab, setActiveTab] = useState<'results' | 'overview'>('results');

  const cancelJob = useMutation(api.extraction.mutations.cancelExtraction);
  const deleteJob = useMutation(api.extraction.mutations.deleteExtraction);
  const duplicateJob = useMutation(
    api.extraction.mutations.duplicateExtraction,
  );

  const jobDetails = useQuery(api.extraction.queries.getJobDetails, {
    jobId: jobId,
  });
  const jobProgress = useQuery(api.extraction.queries.subscribeToJobProgress, {
    jobId: jobId,
  });

  const {
    results: allPapers,
    status: paginationStatus,
    loadMore,
  } = usePaginatedQuery(
    api.extraction.queries.getJobResultsPaginated,
    { jobId },
    { initialNumItems: 200 },
  );

  const isLoadingRef = useRef(false);
  const hasAttemptedLoadRef = useRef(false);
  useEffect(() => {
    if (paginationStatus !== 'Exhausted' && allPapers.length < 200 && !isLoadingRef.current && !hasAttemptedLoadRef.current) {
      isLoadingRef.current = true;
      hasAttemptedLoadRef.current = true;
      loadMore(200);
      const timeout = setTimeout(() => {
        isLoadingRef.current = false;
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, [paginationStatus, allPapers.length, loadMore]);

  const questions: Question[] = useMemo(() => {
    if (!jobDetails?.questions) return [];
    return jobDetails.questions.map(q => ({
      key: q.key,
      question: q.question,
      type: q.type as 'boolean' | 'string' | 'array' | 'number',
      description: q.description,
    }));
  }, [jobDetails?.questions]);

  const papersWithResults = useMemo(
    () => allPapers as PaperWithResults[],
    [allPapers]
  );

  const preprocessedData = useMemo(
    () => preprocessPapers(papersWithResults),
    [papersWithResults]
  );

  const filteredPapers = useMemo(
    () => filterPapers(papersWithResults, debouncedFilters, questions, preprocessedData),
    [papersWithResults, debouncedFilters, questions, preprocessedData]
  );

  const totalPages = Math.ceil(filteredPapers.length / pageSize);
  const displayedPapers = useMemo(
    () => filteredPapers.slice(
      (currentPage - 1) * pageSize,
      currentPage * pageSize
    ),
    [filteredPapers, currentPage, pageSize]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

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

  const handleCancel = async () => {
    try {
      await cancelJob({ jobId });
      toast.success("Job cancelled");
    } catch (error) {
      toast.error("Failed to cancel job");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteJob({ jobId });
      toast.success("Job deleted");
      router.push("/extraction");
    } catch (error) {
      toast.error("Failed to delete job");
    }
  };

  const handleDuplicate = async () => {
    try {
      const result = await duplicateJob({ jobId });
      toast.success("New job created");
      router.push(`/extraction/${result.jobId}`);
    } catch (error) {
      toast.error("Failed to create new job");
    }
  };

  if (!jobDetails) {
    return (
      <PageWrapper>
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </PageWrapper>
    );
  }

  const { job, progress } = jobDetails;
  const resolvedProgress = jobProgress
    ? {
        total: job.totalPapers,
        processed: jobProgress.statusCounts.completed,
        failed:
          jobProgress.statusCounts.failed +
          jobProgress.statusCounts.download_failed +
          jobProgress.statusCounts.indexing_failed,
        percentage:
          job.totalPapers > 0
            ? Math.round(
                ((jobProgress.statusCounts.completed +
                  jobProgress.statusCounts.failed +
                  jobProgress.statusCounts.download_failed +
                  jobProgress.statusCounts.indexing_failed) /
                  job.totalPapers) *
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
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
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
                Extraction Jobs
              </Link>
              <span>/</span>
              <span className="text-foreground truncate max-w-[200px]">{job.name}</span>
            </motion.div>

            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 w-full overflow-hidden">
              <div className="flex items-center gap-3 truncate">
                {/* Gradient icon */}
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 flex items-center justify-center shadow-sm">
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
                      <span className="capitalize">
                        {job.status.replace(/_/g, " ")}
                      </span>
                    </div>

                    <span className="w-1 h-1 rounded-full bg-border" />

                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      <span>{job.totalPapers.toLocaleString()} papers</span>
                    </div>

                    <span className="w-1 h-1 rounded-full bg-border" />

                    <div className="flex items-center gap-1.5">
                      <RefreshCw className={cn("w-3.5 h-3.5", isProcessing && "animate-spin")} />
                      <span>Updated {formatTimeAgo(new Date(job.updatedAt))}</span>
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
                  Restart
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
                        Cancel
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel this job?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will stop processing remaining papers. Partial
                          results will be saved.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep Running</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleCancel}
                          className="bg-destructive hover:bg-destructive/90"
                        >
                          Yes, Cancel
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
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this job?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete the job and all extracted data.
                        This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        Delete Permanently
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
                  Total Papers
                </p>
                <p className="text-2xl lg:text-3xl font-bold text-foreground">
                  {job.totalPapers.toLocaleString()}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Processed
                </p>
                <p className="text-2xl lg:text-3xl font-bold text-foreground">
                  {resolvedProgress.processed.toLocaleString()}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Success Rate
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
                  Questions
                </p>
                <p className="text-2xl lg:text-3xl font-bold text-foreground">
                  {questions.length}
                </p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Extraction Progress</span>
                <span className="font-medium text-foreground">
                  {resolvedProgress.processed + resolvedProgress.failed} of{" "}
                  {resolvedProgress.total} papers
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
                Extraction Results
              </button>
              <button
                onClick={() => setActiveTab('overview')}
                className={cn(
                  "px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                  activeTab === 'overview'
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                Overview & Questions
              </button>
            </div>
          </div>

          {/* Content Section */}
          <div className="p-4 md:p-6">
          {activeTab === 'results' ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-6"
            >
              <ResultsToolbar
                filters={filters}
                onFiltersChange={setFilters}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                totalCount={papersWithResults.length}
                filteredCount={filteredPapers.length}
                questions={questions}
              />

              <div className="min-h-[600px]">
                {filteredPapers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 text-center bg-muted rounded-xl border border-border">
                    <FileText className="w-16 h-16 text-muted-foreground/50 mb-4" />
                    <h3 className="text-xl font-semibold text-foreground mb-2">
                      No results found
                    </h3>
                    <p className="text-muted-foreground max-w-md">
                      {papersWithResults.length === 0
                        ? job.status === "completed"
                          ? "No papers matched your criteria or extraction failed."
                          : "Results will appear here as they are processed."
                        : "Try adjusting your filters to see results."}
                    </p>
                    {filteredPapers.length === 0 && papersWithResults.length > 0 && (
                      <Button
                        variant="outline"
                        className="mt-6"
                        onClick={() => setFilters(defaultFilters)}
                      >
                        Clear Filters
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
                      />
                    )}
                    {viewMode === 'cards' && (
                      <CardView
                        papers={displayedPapers}
                        questions={questions}
                        selectedIds={selectedIds}
                        onSelectionChange={handleCardSelectionChange}
                      />
                    )}
                    {viewMode === 'split' && (
                      <SplitView
                        papers={filteredPapers}
                        questions={questions}
                      />
                    )}
                  </>
                )}
              </div>

              {filteredPapers.length > 0 && viewMode !== 'split' && (
                <SmartPagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={setPageSize}
                  totalCount={papersWithResults.length}
                  filteredCount={filteredPapers.length}
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
                    Extraction Questions
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Schema defined for this extraction job
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
                          {q.type}
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
  );
}
