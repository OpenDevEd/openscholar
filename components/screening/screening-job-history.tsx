"use client";

import { useTranslations, useFormatter } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("jobHistoryTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {!jobs || jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noJobsYet")}</p>
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => {
              const isClickable = !!onSelectJob;
              const isInProgress =
                job.status === "pending" || job.status === "processing";

              return (
                <li key={job._id}>
                  <button
                    type="button"
                    disabled={!isClickable}
                    onClick={() => onSelectJob?.(job._id)}
                    className={`flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors ${
                      isClickable
                        ? "cursor-pointer hover:bg-accent"
                        : "cursor-default"
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={getStatusBadgeVariant(job.status)}>
                          {t(`jobStatus.${job.status}`)}
                        </Badge>
                        <span className="text-muted-foreground">
                          {t("papersCount", { count: job.totalPapers })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {t("qualifiedCount", {
                            count: job.qualifiedPapers,
                          })}
                        </span>
                        {isInProgress && (
                          <span>
                            {job.processedPapers}/{job.totalPapers}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {format.dateTime(new Date(job.createdAt), {
                        dateStyle: "medium",
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
