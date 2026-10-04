"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import Link from "next/link";
import { useConvex } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
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
  Download,
  FolderOpen,
  ArrowUpRight,
  Loader2,
  Sparkles,
  AlertTriangle,
  MessageSquareText,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { PageStepper } from "@/components/shared/page-stepper";
import { downloadExport } from "@/lib/export";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { exportScreeningToXLSX } from "@/lib/screening/export";
import { cn } from "@/lib/utils";

/** Jobs a page of the history lists. */
const PAGE_SIZE = 10;
/**
 * The list's height with `rows` jobs: 74px a row, 6px between rows, 8px under the last, and
 * a pixel over, since a job in progress is half a pixel taller. The list keeps a full page's
 * height while it has pages, so the pager stays put on a short last page, and takes its first
 * page's height from the job count before the jobs arrive.
 */
const listPx = (rows: number) => rows * 80 + 3;

type ScreeningStatus =
  | "pending"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed"
  | "creditsExhausted";

function statusDot(status: ScreeningStatus) {
  switch (status) {
    case "pending":
      return "bg-muted-foreground";
    case "processing":
      return "bg-primary animate-pulse";
    case "completed":
      return "bg-success";
    case "cancelled":
      return "bg-muted-foreground/50";
    case "failed":
    case "creditsExhausted":
      return "bg-destructive";
  }
}

interface ScreeningJobHistoryProps {
  /** How many jobs the person has, read before the history opens. */
  total: number;
  onClose?: () => void;
}

export function ScreeningJobHistory({ total, onClose }: ScreeningJobHistoryProps) {
  const t = useTranslations("screeningDialog");
  const format = useFormatter();
  const convex = useConvex();
  const [exportingJobId, setExportingJobId] = useState<string | null>(null);
  const jobs = useCursorPage(api.screening.queries.listUserScreeningJobs, {}, PAGE_SIZE);

  async function handleExport(
    jobId: Id<"screeningJobs">,
    fmt: "csv" | "json" | "xlsx"
  ) {
    setExportingJobId(jobId);
    try {
      // The server writes CSV and JSON a page of results at a time; a workbook is built here.
      if (fmt === "xlsx") await exportScreeningToXLSX(convex, jobId);
      else await downloadExport(convex, { kind: "screening", jobId }, fmt);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExportingJobId(null);
    }
  }

  // Until the jobs arrive the count sizes the list, so the dialog opens at its final size.
  const hasPages = jobs.isLoading ? total > PAGE_SIZE : jobs.hasPages;
  if (jobs.isLoading ? total === 0 : jobs.items.length === 0 && !jobs.hasPages) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-inset p-3 mb-3">
          <FileText className="h-6 w-6 text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("noJobsYet")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto -mx-6 px-6">
    <div
      className={cn("space-y-1.5 pb-2", jobs.isStale && "pointer-events-none opacity-60")}
      style={{ minHeight: listPx(hasPages ? PAGE_SIZE : jobs.isLoading ? total : jobs.items.length) }}
    >
      {jobs.items.map((job) => {
        const isActive = job.status === "processing";
        const percentage =
          job.totalPapers > 0
            ? Math.round((job.processedPapers / job.totalPapers) * 100)
            : 0;
        const isExporting = exportingJobId === job._id;
        const isIncomplete = job.status !== "completed";

        return (
          <div
            key={job._id}
            className="rounded-lg border border-border-subtle bg-card px-3.5 py-3 transition-colors hover:bg-card-hover"
          >
            {/* Row 1: Status + date + actions */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${statusDot(job.status)}`}
                />
                <span className="text-xs font-medium text-foreground truncate">
                  {t(`jobStatus.${job.status}`)}
                </span>
                <time className="text-xs text-muted-foreground shrink-0">
                  {format.dateTime(new Date(job.createdAt), {
                    dateStyle: "medium",
                  })}
                </time>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {/* Questions tooltip */}
                {job.questions.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
                        <MessageSquareText className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-72">
                      <p className="font-medium mb-1.5">
                        {job.questions.length} {t("questionsUsed")}
                      </p>
                      <ol className="space-y-1 text-2xs list-decimal list-inside opacity-90">
                        {job.questions.map((q) => (
                          <li key={q.key} className="leading-snug">{q.question}</li>
                        ))}
                      </ol>
                    </TooltipContent>
                  </Tooltip>
                )}

                {/* Export dropdown */}
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
                        <div className="px-2 py-1.5 text-2xs ink-warning flex items-center gap-1.5 border-b border-border-subtle mb-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          {t("exportIncompleteWarning")}
                        </div>
                      )}
                      <DropdownMenuItem
                        onClick={() => handleExport(job._id, "csv")}
                      >
                        {t("exportCSV")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleExport(job._id, "json")}
                      >
                        {t("exportJSON")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleExport(job._id, "xlsx")}
                      >
                        {t("exportXLSX")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {/* Row 2: Stats + progress */}
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="h-3 w-3" />
                <span className="tabular-nums font-medium text-foreground">{job.totalPapers}</span>
                {t("papersLabel")}
              </span>

              <span className="inline-flex items-center gap-1.5 text-xs ink-success">
                <Sparkles className="h-3 w-3" />
                <span className="tabular-nums font-medium">{job.qualifiedPapers}</span>
                {t("qualifiedLabel")}
              </span>

              {/* Progress for active jobs */}
              {isActive && (
                <div className="ml-auto flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="text-2xs font-medium tabular-nums text-muted-foreground">
                    {percentage}%
                  </span>
                </div>
              )}

              {/* Collection link for completed jobs */}
              {!isActive && job.targetCollectionId && job.targetCollectionName && (
                <Link
                  href={`/library?col=${job.targetCollectionId}`}
                  onClick={() => onClose?.()}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <FolderOpen className="h-3 w-3" />
                  <span className="truncate max-w-[120px]">{job.targetCollectionName}</span>
                  <ArrowUpRight className="h-3 w-3 shrink-0" />
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
    </div>
      {hasPages && (
        <PageStepper
          className="shrink-0 pt-3"
          page={jobs.page}
          pageCount={Math.ceil(total / PAGE_SIZE)}
          canPrevious={jobs.canPrevious}
          canNext={jobs.canNext}
          onPrevious={jobs.previous}
          onNext={jobs.next}
        />
      )}
    </div>
  );
}
