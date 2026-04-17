"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import Link from "next/link";
import { useConvex, useMutation } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  FlaskConical,
  Download,
  Loader2,
  AlertTriangle,
  X,
  ArrowUpRight,
} from "lucide-react";
import {
  exportExtractionToCSV,
  exportExtractionToJSON,
  exportExtractionToXLSX,
} from "@/lib/extraction/export";
import type { ExtractionExportData } from "@/lib/extraction/export";
import { showStyledToast } from "@/components/ui/sonner";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { toast } from "sonner";

type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed";

function statusDotClass(status: string) {
  switch (status) {
    case "pending":
      return "bg-muted-foreground";
    case "processing":
      return "bg-[oklch(0.55_0.15_293)] animate-pulse";
    case "completed":
      return "bg-[oklch(0.55_0.15_145)]";
    case "failed":
      return "bg-[oklch(0.6_0.15_27)]";
    case "cancelled":
      return "bg-muted-foreground/50";
    default:
      return "bg-muted-foreground";
  }
}

type JobRow = {
  _id: Id<"extractionJobs">;
  status: JobStatus;
  totalPapers: number;
  processedPapers: number;
  failedPapers: number;
  createdAt: number;
  completedAt?: number;
  questionCount?: number;
  firstQuestion?: string;
};

interface ExtractionJobHistoryProps {
  onClose?: () => void;
  /** If provided, renders these jobs instead of fetching internally. Enables outer filtering/pagination. */
  jobs?: JobRow[];
  /** Custom empty-state node (used when outer filter yields nothing). */
  emptyState?: React.ReactNode;
}

/**
 * Sub-component that fetches and displays progress for an active job.
 * Uses a separate query subscription so only active jobs trigger re-renders.
 */
function ActiveJobProgress({ jobId }: { jobId: Id<"extractionJobs"> }) {
  const t = useTranslations("extraction");
  const { data: progress } = useProtectedQuery(
    api.extraction.queries.getExtractionProgress,
    { jobId },
  );

  const percentComplete = progress?.percentComplete ?? 0;

  return (
    <div className="mt-2 space-y-1">
      <Progress value={percentComplete} className="h-1.5" />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t("progress.papersCounter", {
            processed: progress?.processedPapers ?? 0,
            total: progress?.totalPapers ?? 0,
          })}
        </span>
        <span className="tabular-nums font-medium">{percentComplete}%</span>
      </div>
      {(progress?.failedPapers ?? 0) > 0 && (
        <span className="text-destructive text-xs">
          {t("progress.failedCounter", { count: progress?.failedPapers ?? 0 })}
        </span>
      )}
    </div>
  );
}

export function ExtractionJobHistory({
  onClose,
  jobs: externalJobs,
  emptyState,
}: ExtractionJobHistoryProps) {
  const t = useTranslations("extraction");
  const tListPage = useTranslations("extraction.listPage");
  const tc = useTranslations("common");
  const format = useFormatter();
  const convex = useConvex();
  const [exportingJobId, setExportingJobId] = useState<string | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [cancelConfirmJobId, setCancelConfirmJobId] = useState<string | null>(
    null,
  );

  const { data: fetchedJobs } = useProtectedQuery(
    api.extraction.queries.listUserExtractionJobs,
    externalJobs !== undefined ? "skip" : { limit: 10 },
  );
  const jobs: JobRow[] | undefined = externalJobs ?? fetchedJobs;

  const cancelJob = useMutation(api.extraction.mutations.cancelExtractionJob);

  async function handleExport(
    jobId: Id<"extractionJobs">,
    fmt: "csv" | "json" | "xlsx",
  ) {
    setExportingJobId(jobId);
    try {
      const data = await convex.query(
        api.extraction.queries.getExtractionResultsForExport,
        { jobId },
      );
      if (!data) return;
      switch (fmt) {
        case "csv":
          exportExtractionToCSV(data as ExtractionExportData);
          break;
        case "json":
          exportExtractionToJSON(data as ExtractionExportData);
          break;
        case "xlsx":
          await exportExtractionToXLSX(data as ExtractionExportData);
          break;
      }
    } catch (err) {
      console.error("Export failed:", err);
      showStyledToast("error", t("export.incompleteWarning"));
    } finally {
      setExportingJobId(null);
    }
  }

  async function handleCancel(jobId: Id<"extractionJobs">) {
    setCancellingJobId(jobId);
    try {
      await cancelJob({ jobId });
      toast.success(t("progress.statusCancelled"));
    } catch (err) {
      showStyledToast("error", getErrorMessage(err, "Cancel failed"));
    } finally {
      setCancellingJobId(null);
      setCancelConfirmJobId(null);
    }
  }

  // Loading state
  if (jobs === undefined) {
    return (
      <div className="space-y-1.5 pb-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border/50 bg-card px-3.5 py-3 animate-pulse"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="h-2 w-2 rounded-full bg-muted" />
              <div className="h-3 w-20 rounded bg-muted" />
              <div className="h-3 w-16 rounded bg-muted ml-auto" />
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  // Empty state
  if (jobs.length === 0) {
    if (emptyState) return <>{emptyState}</>;
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted/50 p-3 mb-3">
          <FlaskConical className="h-6 w-6 text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("results.emptyHeading")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 pb-2">
      {jobs.map((job) => {
        const isActive =
          job.status === "pending" || job.status === "processing";
        const isExporting = exportingJobId === job._id;
        const isCancelling = cancellingJobId === job._id;
        const isIncomplete = job.status !== "completed";
        const title = job.firstQuestion?.trim() || tListPage("untitledJob");

        return (
          <div
            key={job._id}
            className="rounded-lg border border-border/50 bg-card px-3.5 py-3 transition-colors hover:bg-accent/30"
          >
            {/* Row 0: Title (firstQuestion) */}
            {job.firstQuestion !== undefined && (
              <div className="mb-2 text-sm font-medium text-foreground line-clamp-2">
                {title}
              </div>
            )}

            {/* Row 1: Status + date + actions */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(job.status)}`}
                />
                <span className="text-xs font-medium text-foreground truncate">
                  {t(
                    `progress.status${job.status.charAt(0).toUpperCase()}${job.status.slice(1)}` as
                      | "progress.statusPending"
                      | "progress.statusProcessing"
                      | "progress.statusCompleted"
                      | "progress.statusCancelled"
                      | "progress.statusFailed",
                  )}
                </span>
                <span className="text-xs text-muted-foreground/60">
                  &middot;
                </span>
                <time className="text-xs text-muted-foreground shrink-0">
                  {format.dateTime(new Date(job.createdAt), {
                    dateStyle: "medium",
                  })}
                </time>
                <span className="text-xs text-muted-foreground/60">
                  &middot;
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {job.totalPapers} {tListPage("papersUnit")}
                </span>
                {typeof job.questionCount === "number" && (
                  <>
                    <span className="text-xs text-muted-foreground/60">
                      &middot;
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {job.questionCount} {tListPage("questionsUnit")}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {/* Cancel button for active jobs */}
                {isActive && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setCancelConfirmJobId(job._id)}
                    disabled={isCancelling}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={t("progress.cancelButton")}
                  >
                    {isCancelling ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}

                {/* Export dropdown for non-active jobs */}
                {!isActive && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={isExporting}
                        className="text-muted-foreground"
                      >
                        {isExporting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isIncomplete && (
                        <div className="px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 border-b border-border/40 mb-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          {t("export.incompleteWarning")}
                        </div>
                      )}
                      <DropdownMenuItem
                        onClick={() => handleExport(job._id, "csv")}
                      >
                        {t("export.csv")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleExport(job._id, "json")}
                      >
                        {t("export.json")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleExport(job._id, "xlsx")}
                      >
                        {t("export.xlsx")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Results link for completed/cancelled/failed jobs */}
                {!isActive && (
                  <Link
                    href={`/extraction/${job._id}`}
                    onClick={() => onClose?.()}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span className="truncate">
                      {t("progress.viewResults")}
                    </span>
                    <ArrowUpRight className="h-3 w-3 shrink-0" />
                  </Link>
                )}
              </div>
            </div>

            {/* Row 2: Progress bar for active jobs */}
            {isActive && <ActiveJobProgress jobId={job._id} />}

            {/* Failed counter for non-active jobs */}
            {!isActive && job.failedPapers > 0 && (
              <span className="text-destructive text-xs">
                {t("progress.failedCounter", { count: job.failedPapers })}
              </span>
            )}
          </div>
        );
      })}

      {/* Cancel confirmation AlertDialog */}
      <AlertDialog
        open={cancelConfirmJobId !== null}
        onOpenChange={(open) => {
          if (!open) setCancelConfirmJobId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("progress.cancelConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("progress.cancelConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {tc("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (cancelConfirmJobId) {
                  handleCancel(cancelConfirmJobId as Id<"extractionJobs">);
                }
              }}
            >
              {t("progress.cancelConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
