"use client";

import { useTranslations, useFormatter } from "next-intl";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  HelpCircle,
  FolderOpen,
  ExternalLink,
  Loader2,
} from "lucide-react";

type ScreeningStatus =
  | "pending"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed"
  | "creditsExhausted";

function getStatusBadgeVariant(
  status: ScreeningStatus
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "pending":
    case "processing":
      return "default";
    case "completed":
      return "secondary";
    case "cancelled":
      return "outline";
    case "failed":
    case "creditsExhausted":
      return "destructive";
  }
}

function getStatusIcon(status: ScreeningStatus) {
  switch (status) {
    case "pending":
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    case "processing":
      return <Loader2 className="h-4 w-4 animate-spin text-orange-500" />;
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "cancelled":
      return <XCircle className="h-4 w-4 text-muted-foreground" />;
    case "failed":
    case "creditsExhausted":
      return <AlertCircle className="h-4 w-4 text-destructive" />;
  }
}

interface ScreeningJobHistoryProps {
  onSelectJob?: (jobId: Id<"screeningJobs">) => void;
}

export function ScreeningJobHistory({
  onSelectJob,
}: ScreeningJobHistoryProps) {
  const t = useTranslations("screeningDialog");
  const format = useFormatter();
  const { data: jobs } = useProtectedQuery(
    api.screening.queries.listUserScreeningJobs,
    { limit: 10 }
  );

  if (!jobs || jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("noJobsYet")}</p>
    );
  }

  return (
    <ul className="space-y-2">
      {jobs.map((job) => {
        const isClickable = !!onSelectJob;
        const isInProgress =
          job.status === "pending" || job.status === "processing";

        const visibleQuestions = job.questions.slice(0, 2);
        const extraQuestionCount = job.questions.length - 2;

        return (
          <li key={job._id}>
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => onSelectJob?.(job._id)}
              className={`flex w-full flex-col gap-2 rounded-lg border border-border/50 bg-muted/30 p-4 text-left text-sm transition-colors ${
                isClickable
                  ? "cursor-pointer hover:bg-muted/50"
                  : "cursor-default"
              }`}
            >
              {/* Row 1: Status icon + badge + date */}
              <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusIcon(job.status)}
                  <Badge variant={getStatusBadgeVariant(job.status)}>
                    {t(`jobStatus.${job.status}`)}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {format.dateTime(new Date(job.createdAt), {
                    dateStyle: "medium",
                  })}
                </span>
              </div>

              {/* Row 2: Papers screened + qualified */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                <span>
                  {t("papersCount", { count: job.totalPapers })}
                  {isInProgress && (
                    <> ({job.processedPapers}/{job.totalPapers})</>
                  )}
                  {" \u00B7 "}
                  {t("qualifiedCount", { count: job.qualifiedPapers })}
                </span>
              </div>

              {/* Row 3: Questions used */}
              {job.questions.length > 0 && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {t("questionsUsed")}:{" "}
                    {visibleQuestions
                      .map((q) => `"${q.question}"`)
                      .join(", ")}
                    {extraQuestionCount > 0 && (
                      <span className="ml-1 text-muted-foreground/70">
                        {t("questionsMore", { count: extraQuestionCount })}
                      </span>
                    )}
                  </span>
                </div>
              )}

              {/* Row 4: Target collection */}
              {job.targetCollectionId && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {t("targetCollection")}:{" "}
                    {job.targetCollectionName ?? t("collectionDeleted")}
                  </span>
                  {job.targetCollectionName && (
                    <Link
                      href={`/library?col=${job.targetCollectionId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      title={t("viewCollection")}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
