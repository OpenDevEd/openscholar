"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import Link from "next/link";
import { useConvex } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Download,
  MessageSquareText,
  FolderOpen,
  ArrowUpRight,
  Loader2,
  Sparkles,
  Ban,
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

function getStatusConfig(status: ScreeningStatus) {
  switch (status) {
    case "pending":
      return {
        icon: Clock,
        label: "Pending",
        iconClass: "text-muted-foreground",
        badgeVariant: "default" as const,
        accentClass: "border-l-muted-foreground",
      };
    case "processing":
      return {
        icon: Loader2,
        label: "Processing",
        iconClass: "text-orange-500 animate-spin",
        badgeVariant: "default" as const,
        accentClass: "border-l-orange-500",
      };
    case "completed":
      return {
        icon: CheckCircle2,
        label: "Completed",
        iconClass: "text-green-500",
        badgeVariant: "secondary" as const,
        accentClass: "border-l-green-500",
      };
    case "cancelled":
      return {
        icon: Ban,
        label: "Cancelled",
        iconClass: "text-muted-foreground",
        badgeVariant: "outline" as const,
        accentClass: "border-l-muted-foreground",
      };
    case "failed":
      return {
        icon: XCircle,
        label: "Failed",
        iconClass: "text-destructive",
        badgeVariant: "destructive" as const,
        accentClass: "border-l-destructive",
      };
    case "creditsExhausted":
      return {
        icon: AlertCircle,
        label: "Credits Exhausted",
        iconClass: "text-destructive",
        badgeVariant: "destructive" as const,
        accentClass: "border-l-destructive",
      };
  }
}

interface ScreeningJobHistoryProps {
  onSelectJob?: (jobId: Id<"screeningJobs">) => void;
  onClose?: () => void;
}

export function ScreeningJobHistory({
  onSelectJob,
  onClose,
}: ScreeningJobHistoryProps) {
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
    format: "csv" | "json" | "xlsx"
  ) {
    setExportingJobId(jobId);
    try {
      const data = await convex.query(
        api.screening.queries.getScreeningResultsForExport,
        { jobId }
      );
      if (!data) return;
      switch (format) {
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
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted/50 p-4">
          <FileText className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <p className="mt-4 text-sm font-medium text-muted-foreground">
          {t("noJobsYet")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => {
        const config = getStatusConfig(job.status);
        const StatusIcon = config.icon;
        const isInProgress =
          job.status === "pending" || job.status === "processing";
        const isClickable = !!onSelectJob;
        const percentage =
          job.totalPapers > 0
            ? Math.round((job.processedPapers / job.totalPapers) * 100)
            : 0;

        return (
          <div
            key={job._id}
            className={`group relative overflow-hidden rounded-xl border border-border/60 bg-background/95 shadow-sm transition-all duration-200 ${
              isClickable
                ? "cursor-pointer hover:border-primary/20 hover:shadow-md hover:-translate-y-0.5"
                : ""
            } border-l-[3px] ${config.accentClass}`}
            onClick={() => isClickable && onSelectJob?.(job._id)}
            role={isClickable ? "button" : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={(e) => {
              if (isClickable && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onSelectJob?.(job._id);
              }
            }}
          >
            {/* Header Row */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div className="flex items-center gap-2.5">
                <StatusIcon className={`h-4.5 w-4.5 ${config.iconClass}`} />
                <Badge variant={config.badgeVariant} className="text-xs">
                  {t(`jobStatus.${job.status}`)}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <time className="text-xs font-medium text-muted-foreground/80">
                  {format.dateTime(new Date(job.createdAt), {
                    dateStyle: "medium",
                  })}
                </time>
                {!isInProgress && (() => {
                  const isIncompleteJob = job.status !== "completed";
                  const isExportingThis = exportingJobId === job._id;
                  return (
                    <div onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={isExportingThis}
                            title={t("exportButton")}
                          >
                            {isExportingThis ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {isIncompleteJob && (
                            <div className="px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 border-b border-border/40 mb-1">
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
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Stats Row */}
            <div className="flex items-center gap-3 px-4 pb-3">
              {/* Total Papers */}
              <div className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span className="text-xs font-semibold text-foreground">
                  {job.totalPapers}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("papersLabel")}
                </span>
              </div>

              {/* Qualified Papers */}
              <div className="flex items-center gap-1.5 rounded-md bg-green-50 px-2.5 py-1.5 dark:bg-green-950/30">
                <Sparkles className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                <span className="text-xs font-semibold text-green-700 dark:text-green-300">
                  {job.qualifiedPapers}
                </span>
                <span className="text-xs text-green-600/80 dark:text-green-400/80">
                  {t("qualifiedLabel")}
                </span>
              </div>

              {/* Progress (only for in-progress jobs) */}
              {isInProgress && (
                <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="font-medium tabular-nums">{percentage}%</span>
                </div>
              )}
            </div>

            {/* Expandable Details */}
            {(job.questions.length > 0 || job.targetCollectionId) && (
              <div
                className="border-t border-border/40"
                onClick={(e) => e.stopPropagation()}
              >
                <Accordion type="single" collapsible>
                  {/* Questions Accordion */}
                  {job.questions.length > 0 && (
                    <AccordionItem value="questions" className="border-b-0">
                      <AccordionTrigger className="px-4 py-2.5 text-xs hover:no-underline">
                        <div className="flex items-center gap-2">
                          <MessageSquareText className="h-3.5 w-3.5 text-primary/60" />
                          <span className="font-medium text-muted-foreground">
                            {t("questionsUsed")}
                          </span>
                          <Badge
                            variant="outline"
                            className="h-5 px-1.5 text-[10px] font-semibold"
                          >
                            {job.questions.length}
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-3">
                        <ul className="space-y-1.5">
                          {job.questions.map((q, i) => (
                            <li
                              key={q.key}
                              className="flex items-start gap-2 rounded-md bg-muted/30 px-3 py-2 text-xs"
                            >
                              <span className="mt-px flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                                {i + 1}
                              </span>
                              <span className="text-foreground/80 leading-relaxed">
                                {q.question}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* Collection Section (non-accordion, always visible) */}
                </Accordion>
                {job.targetCollectionId && (
                  <div className="flex items-center gap-2 border-t border-border/30 px-4 py-2.5">
                    <FolderOpen className="h-3.5 w-3.5 text-primary/60" />
                    <span className="text-xs text-muted-foreground">
                      {t("targetCollection")}
                    </span>
                    <span className="text-xs font-medium text-foreground">
                      {job.targetCollectionName ?? t("collectionDeleted")}
                    </span>
                    {job.targetCollectionName && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="ml-auto"
                        asChild
                      >
                        <Link
                          href={`/library?col=${job.targetCollectionId}`}
                          title={t("viewCollection")}
                          onClick={() => onClose?.()}
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
