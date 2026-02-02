"use client";

import { useQuery, usePaginatedQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  FileText,
  AlertCircle,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { motion } from "motion/react";
import { PageWrapper } from "@/components/PageWrapper";
import { JobStatCard } from "@/components/extraction/job-stat-card";
import { ResultsTable } from "@/components/extraction/results-table";
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
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as any;
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 200;

  // Mutations
  const cancelJob = useMutation(api.extraction.mutations.cancelExtraction);
  const deleteJob = useMutation(api.extraction.mutations.deleteExtraction);
  const duplicateJob = useMutation(
    api.extraction.mutations.duplicateExtraction,
  );

  // Metadata query (fast, no heavy results)
  const jobDetails = useQuery(api.extraction.queries.getJobDetails, {
    jobId: jobId,
  });
  const jobProgress = useQuery(api.extraction.queries.subscribeToJobProgress, {
    jobId: jobId,
  });

  // Paginated results query
  const {
    results: paginatedPapers,
    status: paginationStatus,
    loadMore,
  } = usePaginatedQuery(
    api.extraction.queries.getJobResultsPaginated,
    { jobId },
    { initialNumItems: ITEMS_PER_PAGE },
  );

  const handleCancel = async () => {
    try {
      await cancelJob({ jobId });
      toast.success("Job actions cancelled");
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

  // Client-side windowing for pagination
  // paginatedPapers grows as we loadMore. We slice it to show "pages".
  const displayedPapers = paginatedPapers.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );
  const totalLoaded = paginatedPapers.length;
  // If we are on the last loaded page, and there might be more (paginationStatus !== "Exhausted"),
  // we let the user click Next, which triggers loadMore.
  const hasNextPage =
    paginationStatus !== "Exhausted" ||
    currentPage * ITEMS_PER_PAGE < totalLoaded;
  const hasPrevPage = currentPage > 1;

  const handleNextPage = () => {
    // If we need more data to show the next page, fetch it
    if (
      currentPage * ITEMS_PER_PAGE >= totalLoaded &&
      paginationStatus !== "Exhausted"
    ) {
      loadMore(ITEMS_PER_PAGE);
    }
    setCurrentPage((p) => p + 1);
  };

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage((p) => p - 1);
  };

  if (!jobDetails) {
    return (
      <PageWrapper>
        <div className="container mx-auto p-4 sm:p-6 max-w-7xl flex items-center justify-center min-h-[50vh]">
          <Loader2 className="w-10 h-10 animate-spin text-primary/30" />
        </div>
      </PageWrapper>
    );
  }

  const { job, questions, progress } = jobDetails;
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

  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-7xl space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Link
                href="/extraction"
                className="hover:text-primary transition-colors flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" />
                Extraction Jobs
              </Link>
              <span>/</span>
              <span className="truncate max-w-[200px]">{job.name}</span>
            </div>

            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl md:text-4xl font-bold tracking-tight text-foreground"
            >
              {job.name}
            </motion.h1>

            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={cn(
                  "capitalize px-2 py-0.5",
                  job.status === "completed"
                    ? "text-green-600 border-green-200"
                    : "text-muted-foreground",
                )}
              >
                {job.status.replace("_", " ")}
              </Badge>
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                {job.totalPapers} papers
              </span>
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <RefreshCw className="w-3.5 h-3.5" />
                Updated {formatTimeAgo(new Date(job.updatedAt))}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleDuplicate}
              className="text-primary hover:bg-primary/5"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Restart Job
            </Button>

            {(job.status === "pending" ||
              job.status === "downloading_pdfs" ||
              job.status === "extracting") && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Cancel Job
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
                      className="bg-red-500 hover:bg-red-600"
                    >
                      Yes, Cancel
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Job
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
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Delete Permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-4">
          <JobStatCard
            title="Total Papers"
            value={job.totalPapers}
            icon={FileText}
            delay={1}
          />
          <JobStatCard
            title="Processed"
            value={resolvedProgress.processed}
            icon={Sparkles}
            delay={2}
          />
            <JobStatCard
              title="Success Rate"
              value={`${resolvedProgress.percentage}%`}
              icon={resolvedProgress.percentage === 100 ? Sparkles : Loader2}
              delay={3}
              loading={
                job.status === "extracting" || job.status === "downloading_pdfs"
              }
            />
          <JobStatCard
            title="Questions"
            value={questions.length}
            icon={AlertCircle}
            delay={4}
          />
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="results" className="space-y-6">
          <TabsList className="h-12 w-full justify-start rounded-lg bg-muted/50 p-1 md:w-auto">
            <TabsTrigger
              value="results"
              className="h-10 rounded-md px-6 text-sm font-medium"
            >
              Extraction Results
            </TabsTrigger>
            <TabsTrigger
              value="overview"
              className="h-10 rounded-md px-6 text-sm font-medium"
            >
              Overview & Progress
            </TabsTrigger>
          </TabsList>

          <TabsContent value="results" className="space-y-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <ResultsTable
                papers={displayedPapers as any}
                questions={questions}
                isLoading={paginationStatus === "LoadingMore"}
                status={job.status}
                // Hide internal loadMore since we use external pagination
                loadMore={undefined}
              />

              {/* Pagination Controls */}
              <div className="mt-6 flex justify-center">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          if (hasPrevPage) handlePrevPage();
                        }}
                        className={cn(
                          !hasPrevPage && "pointer-events-none opacity-50",
                        )}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <Button variant="ghost" disabled className="w-20">
                        Page {currentPage}
                      </Button>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          if (hasNextPage) handleNextPage();
                        }}
                        className={cn(
                          !hasNextPage && "pointer-events-none opacity-50",
                        )}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </motion.div>
          </TabsContent>

          <TabsContent value="overview">
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Extraction Progress</CardTitle>
                  <CardDescription>
                    Real-time status of document processing
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">
                        {resolvedProgress.percentage}% Complete
                      </span>
                      <span className="text-muted-foreground">
                        {resolvedProgress.processed} of {resolvedProgress.total}
                      </span>
                    </div>
                    <Progress value={resolvedProgress.percentage} className="h-3" />
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <div className="font-medium text-green-700 dark:text-green-400">
                        Processed
                      </div>
                      <div className="text-2xl font-bold text-green-800 dark:text-green-300">
                        {resolvedProgress.processed}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                      <div className="font-medium text-red-700 dark:text-red-400">
                        Failed
                      </div>
                      <div className="text-2xl font-bold text-red-800 dark:text-red-300">
                        {resolvedProgress.failed}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Extraction Questions</CardTitle>
                  <CardDescription>Schema defined for this job</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {questions.map((q: any) => (
                      <div
                        key={q.key}
                        className="flex items-start justify-between p-3 rounded-lg border bg-card/50"
                      >
                        <div className="space-y-1">
                          <div className="font-medium text-sm">
                            {q.question}
                          </div>
                          {q.description && (
                            <div className="text-xs text-muted-foreground">
                              {q.description}
                            </div>
                          )}
                        </div>
                        <Badge
                          variant="secondary"
                          className="text-[10px] uppercase"
                        >
                          {q.type}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PageWrapper>
  );
}
