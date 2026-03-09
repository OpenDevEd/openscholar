"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import Link from "next/link";
import { useConvex } from "convex/react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  exportScreeningToCSV,
  exportScreeningToJSON,
  exportScreeningToXLSX,
} from "@/lib/screening/export";

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
      return "bg-orange-500 animate-pulse";
    case "completed":
      return "bg-green-500";
    case "cancelled":
      return "bg-muted-foreground/50";
    case "failed":
    case "creditsExhausted":
      return "bg-destructive";
  }
}

interface ScreeningJobHistoryProps {
  onClose?: () => void;
}

export function ScreeningJobHistory({ onClose }: ScreeningJobHistoryProps) {
  const t = useTranslations("screeningDialog");
  const format = useFormatter();
  const convex = useConvex();
  const [exportingJobId, setExportingJobId] = useState<string | null>(null);
  const { data: jobs } = useProtectedQuery(
    api.screening.queries.listUserScreeningJobs,
    { limit: 10 }
  );

  async function handleExport(
    jobId: Id<"screeningJobs">,
    fmt: "csv" | "json" | "xlsx"
  ) {
    setExportingJobId(jobId);
    try {
      const data = await convex.query(
        api.screening.queries.getScreeningResultsForExport,
        { jobId }
      );
      if (!data) return;
      switch (fmt) {
        case "csv":
          exportScreeningToCSV(data);
          break;
        case "json":
          exportScreeningToJSON(data);
          break;
        case "xlsx":
          await exportScreeningToXLSX(data);
          break;
      }
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExportingJobId(null);
    }
  }

  if (!jobs || jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted/50 p-3 mb-3">
          <FileText className="h-6 w-6 text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("noJobsYet")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 pb-2">
      {jobs.map((job) => {
        const isActive =
          job.status === "pending" || job.status === "processing";
        const percentage =
          job.totalPapers > 0
            ? Math.round((job.processedPapers / job.totalPapers) * 100)
            : 0;
        const isExporting = exportingJobId === job._id;
        const isIncomplete = job.status !== "completed";

        return (
          <div
            key={job._id}
            className="rounded-lg border border-border/50 bg-card px-3.5 py-3 transition-colors hover:bg-accent/30"
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
                <span className="text-xs text-muted-foreground/60">
                  &middot;
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
                      <ol className="space-y-1 text-[11px] list-decimal list-inside opacity-90">
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
                        <div className="px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 border-b border-border/40 mb-1">
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

              <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
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
                  <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
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
  );
}
